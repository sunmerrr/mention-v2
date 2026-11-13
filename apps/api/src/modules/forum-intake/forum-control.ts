import { randomUUID } from 'node:crypto';
import { controlAckRecord, controlEnqueueRecord, controlPollRecord } from '@app/shared';
import { and, eq, inArray, lt, sql } from 'drizzle-orm';
import { collectorCommands, collectorPrincipals, collectorState } from '../../db/schema.js';
import { stableJson } from '../connection/stable-json.js';
import type { CollectorPrincipal } from './forum-auth.js';
import { ForumStore } from './forum-store.js';
export class ForumControl {
  constructor(private readonly store: ForumStore) {}
  async enqueue(principal: CollectorPrincipal, input: unknown) {
    const clean = controlEnqueueRecord(input),
      now = new Date();
    return this.store.db.transaction(async (tx) => {
      await tx
        .select({ pk: collectorPrincipals.pk })
        .from(collectorPrincipals)
        .where(eq(collectorPrincipals.pk, principal.pk))
        .for('update');
      if (clean.action === 'stop')
        await tx
          .update(collectorCommands)
          .set({ status: 'cancelled', finishedAt: now })
          .where(
            and(
              eq(collectorCommands.collectorPk, principal.pk),
              eq(collectorCommands.status, 'queued'),
              inArray(collectorCommands.action, ['start', 'resume', 'reload']),
            ),
          );
      const [existing] = await tx
        .select()
        .from(collectorCommands)
        .where(
          and(
            eq(collectorCommands.collectorPk, principal.pk),
            eq(collectorCommands.action, clean.action),
            inArray(collectorCommands.status, ['queued', 'leased']),
          ),
        )
        .orderBy(collectorCommands.createdAt)
        .limit(1);
      if (existing) return existing;
      const [created] = await tx
        .insert(collectorCommands)
        .values({
          collectorPk: principal.pk,
          id: randomUUID(),
          action: clean.action,
          targetVersion: clean.targetVersion,
        })
        .returning();
      return created;
    });
  }
  async poll(principal: CollectorPrincipal, input: unknown) {
    const clean = controlPollRecord(input, principal.extensionId),
      now = new Date();
    return this.store.db.transaction(async (tx) => {
      await tx
        .select({ pk: collectorPrincipals.pk })
        .from(collectorPrincipals)
        .where(eq(collectorPrincipals.pk, principal.pk))
        .for('update');
      const put = async (key: string, value: Record<string, unknown>) =>
        tx
          .insert(collectorState)
          .values({ collectorPk: principal.pk, key, value, updatedAt: now })
          .onConflictDoUpdate({
            target: [collectorState.collectorPk, collectorState.key],
            set: { value, updatedAt: now },
          });
      await put(`heartbeat:${clean.owner}`, { ...clean, at: now.toISOString() });
      await tx
        .update(collectorCommands)
        .set({ status: 'unknown', finishedAt: now })
        .where(
          and(
            eq(collectorCommands.collectorPk, principal.pk),
            eq(collectorCommands.status, 'leased'),
            lt(collectorCommands.expiresAt, now),
          ),
        );
      const [active] = await tx
        .select()
        .from(collectorState)
        .where(
          and(
            eq(collectorState.collectorPk, principal.pk),
            eq(collectorState.key, 'control-owner'),
          ),
        );
      if (
        active &&
        typeof active.value.expiresAt === 'number' &&
        active.value.expiresAt > now.getTime() &&
        active.value.owner !== clean.owner
      )
        return { command: null, state: 'ANOTHER_CLIENT_CONNECTED' };
      if (clean.enabled && clean.permission)
        await put('control-owner', { owner: clean.owner, expiresAt: now.getTime() + 90000 });
      const [leased] = await tx
        .select({ id: collectorCommands.id })
        .from(collectorCommands)
        .where(
          and(
            eq(collectorCommands.collectorPk, principal.pk),
            eq(collectorCommands.status, 'leased'),
          ),
        )
        .limit(1);
      if (leased) return { command: null, state: 'COMMAND_IN_FLIGHT' };
      const [command] = await tx
        .select()
        .from(collectorCommands)
        .where(
          and(
            eq(collectorCommands.collectorPk, principal.pk),
            eq(collectorCommands.status, 'queued'),
          ),
        )
        .orderBy(
          sql`case when ${collectorCommands.action}='stop' then 0 else 1 end`,
          collectorCommands.createdAt,
        )
        .limit(1);
      if (!command) return { command: null, state: 'IDLE' };
      if (!clean.enabled || (!clean.permission && ['start', 'resume'].includes(command.action)))
        return { command: null, state: 'WAITING_FOR_PERMISSION' };
      const expires = new Date(now.getTime() + 120000);
      await tx
        .update(collectorCommands)
        .set({ status: 'leased', owner: clean.owner, expiresAt: expires })
        .where(eq(collectorCommands.pk, command.pk));
      return {
        command: {
          id: command.id,
          action: command.action,
          targetVersion: command.targetVersion,
          createdAt: command.createdAt.getTime(),
          expiresAt: expires.getTime(),
        },
        state: 'LEASED',
      };
    });
  }
  async ack(principal: CollectorPrincipal, input: unknown) {
    const clean = controlAckRecord(input, principal.extensionId);
    return this.store.db.transaction(async (tx) => {
      await tx
        .select({ pk: collectorPrincipals.pk })
        .from(collectorPrincipals)
        .where(eq(collectorPrincipals.pk, principal.pk))
        .for('update');
      const [command] = await tx
        .select()
        .from(collectorCommands)
        .where(
          and(eq(collectorCommands.collectorPk, principal.pk), eq(collectorCommands.id, clean.id)),
        );
      if (!command || command.owner !== clean.owner) throw new Error('INVALID_CONTROL_OWNER');
      if (['succeeded', 'failed'].includes(command.status)) {
        if (stableJson(command.result) !== stableJson(clean.result))
          throw new Error('COLLECTOR_RECEIPT_CONFLICT');
        return { acknowledged: true };
      }
      if (!['leased', 'unknown'].includes(command.status)) throw new Error('INVALID_CONTROL_STATE');
      await tx
        .update(collectorCommands)
        .set({
          status: clean.result.ok ? 'succeeded' : 'failed',
          result: clean.result,
          finishedAt: new Date(),
        })
        .where(eq(collectorCommands.pk, command.pk));
      return { acknowledged: true };
    });
  }
}
