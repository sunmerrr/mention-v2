import { createHash, randomUUID } from 'node:crypto';
import {
  type MonitorEvent,
  type MonitorSnapshot,
  monitorEventTransition,
  monitorRecord,
  monitorTransition,
  monitorUrl,
  type PokergosuContentCapture,
  pokergosuContentCaptureSchema,
  type TrialSnapshot,
  trialRecord,
  trialTransition,
} from '@app/shared';
import { and, count, desc, eq, gte, inArray, isNotNull, isNull, lt, or, sql } from 'drizzle-orm';
import { z } from 'zod';
import { createDatabase } from '../../db/client.js';
import {
  collectorInbox,
  collectorPrincipals,
  collectorState,
  forumDiscoveries,
  forumThreads,
} from '../../db/schema.js';
import { config } from '../../shared/config/index.js';
import { stableJson } from '../connection/stable-json.js';
import { type CollectorPrincipal, collectorCredentials, collectorTokenHash } from './forum-auth.js';
export class ForumStore {
  private connection?: ReturnType<typeof createDatabase>;
  get db() {
    if (!this.connection) {
      if (!config.DATABASE_URL) throw new Error('COLLECTOR_DATABASE_REQUIRED');
      this.connection = createDatabase(config.DATABASE_URL);
    }
    return this.connection.db;
  }
  async onModuleDestroy() {
    await this.close();
  }
  async close() {
    await this.connection?.pool.end();
    this.connection = undefined;
  }
  async authenticate(
    headers: Record<string, string | string[] | undefined>,
  ): Promise<CollectorPrincipal> {
    const { hash, extension } = collectorCredentials(headers);
    const [principal] = await this.db
      .select()
      .from(collectorPrincipals)
      .where(
        and(
          eq(collectorPrincipals.tokenHash, hash),
          eq(collectorPrincipals.extensionId, extension),
          eq(collectorPrincipals.disabled, false),
        ),
      );
    if (!principal) throw new Error('COLLECTOR_FORBIDDEN');
    return { pk: principal.pk, id: principal.id, extensionId: principal.extensionId };
  }
  async register(id: string, extensionId: string, token: string) {
    if (!/^[A-Za-z0-9_-]{1,128}$/.test(id) || !/^[a-p]{32}$/.test(extensionId))
      throw new Error('INVALID_COLLECTOR_REGISTRATION');
    await this.db
      .insert(collectorPrincipals)
      .values({ id, extensionId, tokenHash: collectorTokenHash(token) });
  }
  async status(principal: CollectorPrincipal) {
    const [stats] = await this.db
      .select({
        threads: sql<number>`count(*) filter (where ${forumThreads.capturedAt} is not null)::int`,
        matched: sql<number>`count(*) filter (where ${forumThreads.matched}=true)::int`,
        pendingMatching: sql<number>`count(*) filter (where ${forumThreads.capturedAt} is not null and ${forumThreads.matched} is null)::int`,
      })
      .from(forumThreads)
      .where(eq(forumThreads.collectorPk, principal.pk));
    return {
      protocolVersion: 1,
      collectorId: principal.id,
      threads: stats?.threads ?? 0,
      matched: stats?.matched ?? 0,
      pendingMatching: stats?.pendingMatching ?? 0,
    };
  }
  async plan(principal: CollectorPrincipal) {
    const scope = and(
      eq(forumThreads.collectorPk, principal.pk),
      gte(forumThreads.discoveredAt, new Date(Date.now() - 72 * 3600000)),
      isNull(forumThreads.readError),
    );
    const pending = await this.db
      .select({ id: forumThreads.nativeId, url: forumThreads.url })
      .from(forumThreads)
      .where(and(scope, isNull(forumThreads.capturedAt)))
      .orderBy(sql`length(${forumThreads.nativeId}) desc`, desc(forumThreads.nativeId))
      .limit(6);
    const recent = await this.db
      .select({ id: forumThreads.nativeId, url: forumThreads.url })
      .from(forumThreads)
      .where(and(scope, isNotNull(forumThreads.capturedAt)))
      .orderBy(
        forumThreads.capturedAt,
        sql`length(${forumThreads.nativeId})`,
        forumThreads.nativeId,
      )
      .limit(6 - pending.length);
    const [total] = await this.db
      .select({ n: count() })
      .from(forumThreads)
      .where(and(scope, isNull(forumThreads.capturedAt)));
    return {
      queue: [...pending, ...recent],
      pending_threads: total?.n ?? 0,
      comment_window_hours: 72,
      max_threads: 6,
    };
  }
  async strategy(principal: CollectorPrincipal, cycle: number) {
    const [registration] = await this.db
      .select({ discovery: collectorPrincipals.discovery })
      .from(collectorPrincipals)
      .where(eq(collectorPrincipals.pk, principal.pk));
    const raw = registration?.discovery;
    if (raw?.enabled !== true) return { mode: 'board' };
    const policy = z
      .object({
        enabled: z.literal(true),
        startsAt: z.number().finite(),
        expiresAt: z.number().finite(),
        terms: z
          .array(
            z
              .string()
              .min(2)
              .max(20)
              .refine(
                (v) => v === v.trim() && ![...v].some((char) => (char.codePointAt(0) ?? 0) < 32),
              ),
          )
          .min(1)
          .max(30),
        startCycle: z.number().int().positive(),
      })
      .parse(raw);
    if (
      policy.expiresAt <= policy.startsAt ||
      policy.expiresAt - policy.startsAt > 86400000 ||
      new Set(policy.terms).size !== policy.terms.length
    )
      throw new Error('INVALID_DISCOVERY_POLICY');
    if (Date.now() < policy.startsAt || Date.now() >= policy.expiresAt || cycle < policy.startCycle)
      return { mode: 'board' };
    const offset = cycle - policy.startCycle,
      term = policy.terms[offset % policy.terms.length];
    if (!term) throw new Error('INVALID_DISCOVERY_TERM');
    const scope = Math.floor(offset / policy.terms.length) % 2 === 0 ? '1' : '4';
    return {
      mode: 'search',
      term,
      scope,
      url:
        'https://www.pokergosu.com/free/search?' +
        new URLSearchParams({ s: scope, v: encodeURIComponent(term) }),
      expiresAt: policy.expiresAt,
    };
  }
  async searchPlan(principal: CollectorPrincipal, raw: unknown) {
    const input = z
      .object({ url: z.string(), ids: z.array(z.string().regex(/^[1-9][0-9]{0,18}$/)).max(300) })
      .parse(raw);
    if (new Set(input.ids).size !== input.ids.length) throw new Error('INVALID_SEARCH_IDS');
    const checked = pokergosuContentCaptureSchema.parse({
      operation: 'list',
      page_url: input.url,
      data: input.ids.map((id) => ({ id, url: `https://www.pokergosu.com/free/${id}` })),
    });
    if (checked.page_url === 'https://www.pokergosu.com/free')
      throw new Error('INVALID_SEARCH_URL');
    if (!input.ids.length) return { queue: [], pending_threads: 0 };
    const matching = and(
      eq(forumDiscoveries.collectorPk, principal.pk),
      eq(forumDiscoveries.sourceUrl, input.url),
      inArray(forumDiscoveries.nativeId, input.ids),
      isNull(forumThreads.readError),
    );
    const rows = await this.db
      .select({
        id: forumThreads.nativeId,
        url: forumThreads.url,
        capturedAt: forumThreads.capturedAt,
      })
      .from(forumDiscoveries)
      .innerJoin(
        forumThreads,
        and(
          eq(forumThreads.collectorPk, forumDiscoveries.collectorPk),
          eq(forumThreads.nativeId, forumDiscoveries.nativeId),
        ),
      )
      .where(matching)
      .orderBy(
        sql`${forumThreads.capturedAt} asc nulls first`,
        sql`length(${forumThreads.nativeId}) desc`,
        desc(forumThreads.nativeId),
      );
    return {
      queue: rows.slice(0, 6).map(({ id, url }) => ({ id, url })),
      pending_threads: rows.filter((row) => !row.capturedAt).length,
    };
  }
  async capture(principal: CollectorPrincipal, raw: unknown) {
    if (
      raw &&
      typeof raw === 'object' &&
      !Array.isArray(raw) &&
      ['monitor', 'trial', 'diagnostic'].includes(
        String((raw as Record<string, unknown>).operation),
      )
    )
      return this.acceptState(principal, raw);
    const capture = pokergosuContentCaptureSchema.parse(raw);
    return this.acceptContent(principal, capture, raw as Record<string, unknown>);
  }
  private async acceptState(principal: CollectorPrincipal, raw: unknown) {
    const envelope = z
      .object({
        operation: z.enum(['monitor', 'trial', 'diagnostic']),
        eventId: z.uuid().optional(),
        capturedAt: z.iso.datetime().optional(),
        page_url: z.string(),
        data: z.unknown().optional(),
        reason: z.string().max(80).optional(),
        structure: z.unknown().optional(),
      })
      .parse(raw);
    const url = monitorUrl(envelope.page_url),
      path = new URL(url).pathname.replace(/\/$/, '');
    if (envelope.operation !== 'diagnostic' && path !== '/free')
      throw new Error('INVALID_CAPTURE_PAGE');
    const eventId = envelope.eventId ?? randomUUID(),
      receiptId = randomUUID(),
      receivedAt = new Date();
    const cleaned: Record<string, unknown> =
      envelope.operation === 'monitor'
        ? (monitorRecord(envelope.data) as unknown as Record<string, unknown>)
        : envelope.operation === 'trial'
          ? (trialRecord(envelope.data) as unknown as Record<string, unknown>)
          : (() => {
              const structure = z
                .object({
                  url: z.literal(envelope.page_url),
                  headings: z.array(z.string().max(160)).max(12),
                  nodes: z
                    .array(
                      z.object({
                        tag: z.string().max(20),
                        id: z.string().max(160),
                        classes: z.string().max(240),
                        parent: z.string().max(20),
                      }),
                    )
                    .max(350),
                })
                .parse(envelope.structure);
              return { reason: z.string().max(80).parse(envelope.reason), structure };
            })();
    const payload = {
      operation: envelope.operation,
      eventId,
      page_url: envelope.page_url,
      ...(envelope.capturedAt ? { capturedAt: envelope.capturedAt } : {}),
      data: cleaned,
    };
    const payloadHash = createHash('sha256').update(stableJson(payload)).digest('hex');
    return this.db.transaction(async (tx) => {
      await tx
        .select({ pk: collectorPrincipals.pk })
        .from(collectorPrincipals)
        .where(eq(collectorPrincipals.pk, principal.pk))
        .for('update');
      const [existing] = await tx
        .select()
        .from(collectorInbox)
        .where(
          and(eq(collectorInbox.collectorPk, principal.pk), eq(collectorInbox.eventId, eventId)),
        );
      if (existing) {
        if (existing.payloadHash !== payloadHash) throw new Error('COLLECTOR_RECEIPT_CONFLICT');
        return existing.acknowledgement;
      }
      const put = async (key: string, value: Record<string, unknown>) =>
        tx
          .insert(collectorState)
          .values({ collectorPk: principal.pk, key, value, updatedAt: receivedAt })
          .onConflictDoUpdate({
            target: [collectorState.collectorPk, collectorState.key],
            set: { value, updatedAt: receivedAt },
          });
      const get = async (key: string) => {
        const [row] = await tx
          .select()
          .from(collectorState)
          .where(and(eq(collectorState.collectorPk, principal.pk), eq(collectorState.key, key)));
        return row?.value ?? null;
      };
      let acknowledgement: Record<string, unknown>;
      if (envelope.operation === 'monitor') {
        const current = cleaned as unknown as MonitorSnapshot;
        monitorTransition(
          (await get(`monitor:${current.id}`)) as unknown as MonitorSnapshot | null,
          current,
        );
        for (const event of current.history) {
          const key = `monitor-event:${current.id}:${event.sequence}`;
          monitorEventTransition((await get(key)) as unknown as MonitorEvent | null, event);
          await put(key, event as unknown as Record<string, unknown>);
          if (
            event.outcome === 'skipped' &&
            event.reason === 'THREAD_MARKUP_UNKNOWN' &&
            event.finishedAt
          ) {
            const postId = /\/free\/([1-9][0-9]{0,18})$/.exec(event.url)?.[1];
            if (postId)
              await tx
                .update(forumThreads)
                .set({ readError: 'THREAD_MARKUP_UNKNOWN' })
                .where(
                  and(
                    eq(forumThreads.collectorPk, principal.pk),
                    eq(forumThreads.nativeId, postId),
                    or(
                      isNull(forumThreads.capturedAt),
                      lt(forumThreads.capturedAt, new Date(event.finishedAt)),
                    ),
                  ),
                );
          }
        }
        await put(`monitor:${current.id}`, cleaned);
        await put('extension_monitor', cleaned);
        acknowledgement = {
          monitor_saved: true,
          status: current.status,
          navigations: current.navigations,
        };
      } else if (envelope.operation === 'trial') {
        const current = cleaned as unknown as TrialSnapshot;
        trialTransition(
          (await get(`trial:${current.id}`)) as unknown as TrialSnapshot | null,
          current,
        );
        await put(`trial:${current.id}`, cleaned);
        await put('extension_trial', cleaned);
        acknowledgement = {
          trial_saved: true,
          status: current.status,
          attempted: current.attempted,
        };
      } else {
        await put('extension_diagnostic', cleaned);
        acknowledgement = { diagnostic_saved: true, reason: cleaned.reason };
      }
      const ack = {
        ...acknowledgement,
        accepted: true,
        receiptId,
        receivedAt: receivedAt.toISOString(),
      };
      await tx.insert(collectorInbox).values({
        collectorPk: principal.pk,
        eventId,
        receiptId,
        payloadHash,
        operation: envelope.operation,
        capturedAt: envelope.capturedAt ? new Date(envelope.capturedAt) : null,
        receivedAt,
        payload,
        acknowledgement: ack,
        processedAt: receivedAt,
      });
      return ack;
    });
  }
  private async acceptContent(
    principal: CollectorPrincipal,
    capture: PokergosuContentCapture,
    original: Record<string, unknown>,
  ) {
    const eventId = capture.eventId ?? randomUUID(),
      receiptId = randomUUID(),
      receivedAt = new Date();
    const payloadHash = createHash('sha256').update(stableJson(original)).digest('hex');
    return this.db.transaction(async (tx) => {
      // Serialize intake and command changes for this collector, never globally.
      await tx
        .select({ pk: collectorPrincipals.pk })
        .from(collectorPrincipals)
        .where(eq(collectorPrincipals.pk, principal.pk))
        .for('update');
      const [existing] = await tx
        .select()
        .from(collectorInbox)
        .where(
          and(eq(collectorInbox.collectorPk, principal.pk), eq(collectorInbox.eventId, eventId)),
        );
      if (existing) {
        if (existing.payloadHash !== payloadHash) throw new Error('COLLECTOR_RECEIPT_CONFLICT');
        return existing.acknowledgement;
      }
      const acknowledgement: Record<string, unknown> =
        capture.operation === 'thread'
          ? {
              saved: true,
              accepted: true,
              receiptId,
              receivedAt: receivedAt.toISOString(),
              matchStatus: 'pending',
              comments: capture.data.comments.length,
              comment_summary: {
                saved: capture.data.comments.length,
                media_only: capture.data.comments.filter((c) => c.content_kind === 'media_only')
                  .length,
                skipped: capture.data.skipped_comments.length,
                unavailable: capture.data.unavailable_comments,
                coverage: capture.data.comment_coverage,
              },
              metadata_missing:
                !capture.data.author ||
                !capture.data.published_at ||
                capture.data.comments.some((c) => !c.author || !c.published_at),
            }
          : {
              saved: true,
              accepted: true,
              receiptId,
              receivedAt: receivedAt.toISOString(),
              discovered: capture.data.length,
            };
      const [inbox] = await tx
        .insert(collectorInbox)
        .values({
          collectorPk: principal.pk,
          eventId,
          receiptId,
          payloadHash,
          operation: capture.operation,
          capturedAt: capture.capturedAt ? new Date(capture.capturedAt) : null,
          receivedAt,
          payload: original,
          acknowledgement,
        })
        .returning({ pk: collectorInbox.pk });
      if (!inbox) throw new Error('COLLECTOR_DURABLE_ACCEPT_FAILED');
      if (capture.operation === 'thread') {
        await tx
          .insert(forumThreads)
          .values({
            collectorPk: principal.pk,
            nativeId: capture.data.id,
            url: capture.data.url,
            capturedAt: receivedAt,
            latestInboxPk: inbox.pk,
            matched: null,
          })
          .onConflictDoUpdate({
            target: [forumThreads.collectorPk, forumThreads.nativeId],
            set: {
              capturedAt: receivedAt,
              latestInboxPk: inbox.pk,
              matched: null,
              readError: null,
            },
          });
      } else {
        for (const post of capture.data) {
          await tx
            .insert(forumThreads)
            .values({
              collectorPk: principal.pk,
              nativeId: post.id,
              url: post.url,
              pinned: post.pinned ?? false,
            })
            .onConflictDoNothing();
          await tx
            .insert(forumDiscoveries)
            .values({
              collectorPk: principal.pk,
              nativeId: post.id,
              sourceUrl: capture.page_url,
              seenAt: receivedAt,
            })
            .onConflictDoUpdate({
              target: [
                forumDiscoveries.collectorPk,
                forumDiscoveries.nativeId,
                forumDiscoveries.sourceUrl,
              ],
              set: { seenAt: receivedAt },
            });
        }
      }
      return acknowledgement;
    });
  }
}
