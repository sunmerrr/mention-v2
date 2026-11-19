import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { eq } from 'drizzle-orm';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createDatabase } from '../../src/db/client.js';
import {
  intakeEvents,
  kakaoMessages,
  monitoringRooms,
  monitoringSettings,
  nativeWorkerOffsets,
} from '../../src/db/schema.js';
import { IntakeStore } from '../../src/modules/connection/intake-store.js';
import type { OwnerReply } from '../../src/modules/connection/owner-client.js';
import { importNativeMessages } from '../../src/modules/context/import-native-messages.js';
import { NativeContextPublisher } from '../../src/modules/context/native-context-publisher.service.js';
import { NativeNormalizer } from '../../src/modules/context/native-normalizer.service.js';
import { StoredContextSource } from '../../src/modules/context/stored-context-source.js';
import { collectUsefulContext } from '../../src/modules/context/useful-context.js';
import { EvidenceRepository } from '../../src/modules/evidence/evidence.repository.js';
import { BookmarksRepository } from '../../src/modules/monitoring/bookmarks.repository.js';
import { config } from '../../src/shared/config/index.js';

describe('native intake on disposable PostgreSQL', () => {
  let container: StartedPostgreSqlContainer, store: IntakeStore;
  const prior = config.DATABASE_URL;
  const reply = (cursor = 'synthetic:owner:2'): OwnerReply => ({
    ok: true,
    state: {
      connected: true,
      instance_id: 'synthetic',
      event_cursor: cursor,
      initial_cursor: 'synthetic:owner:0',
      event_capacity: 20000,
      stream_error: null,
    },
    result: {
      events: [
        {
          chat_id: '18497500347065223',
          log_id: '3970073012646000642',
          author_id: '7175652408034127965',
          type: 1,
          text: '합성 원문',
        },
      ],
      next_cursor: cursor,
      gap: false,
    },
    cache: {
      rooms: [{ chat_id: '18497500347065223', kind: 'OM' }],
      logs: [
        [
          '18497500347065223',
          '3970073012646000642',
          { logId: '3970073012646000642', message: '합성 원문', type: 1, sendAt: 1794556800 },
        ],
      ],
    },
  });
  beforeAll(async () => {
    container = await new PostgreSqlContainer('postgres:16-alpine').start();
    config.DATABASE_URL = container.getConnectionUri();
    const c = createDatabase(config.DATABASE_URL, true);
    try {
      await migrate(c.db, { migrationsFolder: path.resolve('drizzle') });
    } finally {
      await c.pool.end();
    }
    store = new IntakeStore();
    await store.acquire('synthetic-ingest');
    await store.initialize('synthetic', 'synthetic:owner:0');
  }, 120000);
  afterAll(async () => {
    await store?.close();
    config.DATABASE_URL = prior;
    await container?.stop();
  });
  it('atomically stores original event, wire evidence and committed cursor', async () => {
    await store.accept('synthetic:owner:0', reply());
    expect((await store.cursor())?.cursor).toBe('synthetic:owner:2');
    const c = createDatabase(config.DATABASE_URL ?? '');
    try {
      const rows = await c.pool.query('SELECT room_id,log_id,payload FROM intake_events');
      expect(rows.rows).toHaveLength(1);
      expect(rows.rows[0].log_id).toBe('3970073012646000642');
      expect(rows.rows[0].payload.event.text).toBe('합성 원문');
    } finally {
      await c.pool.end();
    }
  });
  it('rejects stale commits, owner changes and backwards cursors without advancing state', async () => {
    await expect(store.accept('synthetic:owner:0', reply('synthetic:owner:3'))).rejects.toThrow(
      'CONFLICT',
    );
    await expect(store.accept('synthetic:owner:2', reply('synthetic:owner:1'))).rejects.toThrow(
      'REGRESSION',
    );
    const changed = reply('new:owner:3');
    changed.state.instance_id = 'new';
    await expect(store.accept('synthetic:owner:2', changed)).rejects.toThrow('CURSOR');
    expect((await store.cursor())?.cursor).toBe('synthetic:owner:2');
  });
  it('deduplicates a replayed raw record while retaining explicit coverage gaps', async () => {
    const batch = reply('synthetic:owner:4');
    batch.result = { ...(batch.result as object), gap: true };
    await store.accept('synthetic:owner:2', batch);
    const c = createDatabase(config.DATABASE_URL ?? '');
    try {
      expect((await c.pool.query('SELECT count(*) n FROM intake_events')).rows[0].n).toBe('1');
      expect((await c.pool.query('SELECT reason FROM intake_gaps')).rows[0].reason).toBe(
        'owner_event_gap',
      );
    } finally {
      await c.pool.end();
    }
  });
  it('fences a second consumer process with the same PostgreSQL lease', async () => {
    const second = new IntakeStore();
    try {
      await expect(second.acquire('synthetic-ingest')).rejects.toThrow('ALREADY_RUNNING');
    } finally {
      await second.close();
    }
  });
  it('keeps new wire evidence atomic without treating cache changes as another received message', async () => {
    const batch = reply('synthetic:owner:6');
    const cache = batch.cache as { logs: unknown[] };
    cache.logs.push([
      '18497500347065223',
      '3970073012646000642',
      { logId: '3970073012646000642', message: '새 캐시 원문' },
    ]);
    await store.accept('synthetic:owner:4', batch);
    const c = createDatabase(config.DATABASE_URL ?? '');
    try {
      expect((await c.pool.query('select count(*) n from intake_events')).rows[0].n).toBe('1');
      expect((await c.pool.query('select count(*) n from intake_wire_snapshots')).rows[0].n).toBe(
        '2',
      );
      expect((await store.cursor())?.cursor).toBe('synthetic:owner:6');
    } finally {
      await c.pool.end();
    }
  });
  it('keeps private content out of both raw tables and pauses on unknown room classification', async () => {
    const batch = reply('synthetic:owner:8');
    batch.result = {
      events: [{ chat_id: '123', log_id: '3970073012646000666', text: 'PRIVATE_EVENT' }],
      next_cursor: 'synthetic:owner:8',
      gap: false,
    };
    batch.cache = {
      rooms: [{ chat_id: 123, kind: 'DirectChat' }],
      logs: [[123, '3970073012646000666', { message: 'PRIVATE_WIRE' }]],
    };
    await store.accept('synthetic:owner:6', batch);
    expect((await store.cursor())?.cursor).toBe('synthetic:owner:8');
    const unknown = reply('synthetic:owner:9');
    unknown.cache = { rooms: [] };
    await expect(store.accept('synthetic:owner:8', unknown)).rejects.toThrow(
      'CLASSIFICATION_UNVERIFIED',
    );
    expect((await store.cursor())?.cursor).toBe('synthetic:owner:8');
    const c = createDatabase(config.DATABASE_URL ?? '');
    try {
      expect(
        (
          await c.pool.query(
            "select count(*)::int n from intake_events where payload::text like '%PRIVATE_EVENT%'",
          )
        ).rows[0].n,
      ).toBe(0);
      expect(
        (
          await c.pool.query(
            "select count(*)::int n from intake_wire_snapshots where wire::text like '%PRIVATE_WIRE%'",
          )
        ).rows[0].n,
      ).toBe(0);
    } finally {
      await c.pool.end();
    }
  });
  it('normalizes durable input independently and resumes its checkpoint without duplicate room work', async () => {
    const evidence = new EvidenceRepository(),
      processor = new NativeNormalizer(evidence);
    try {
      expect(await processor.processBatch()).toEqual({ scanned: 1, normalized: 1 });
      const saved = await evidence.db.execute('select body from kakao_messages');
      expect(saved.rows[0]?.body).toMatchObject({
        logId: '3970073012646000642',
        type: 1,
        text: '합성 원문',
        own: null,
        sentAt: '2026-11-13T08:00:00.000Z',
        timeSource: 'native',
      });
      expect(await new NativeNormalizer(evidence).processBatch()).toEqual({
        scanned: 0,
        normalized: 0,
      });
      expect(
        (await evidence.db.execute('select revision from native_room_dirty')).rows[0]?.revision,
      ).toBe(1);
    } finally {
      await evidence.close();
    }
  });
  it('imports historical context without replacing newer live messages or creating answering events', async () => {
    const evidence = new EvidenceRepository();
    try {
      const old = {
        room_id: '18497500347065223',
        log_id: '3970073012646000642',
        author_id: '7175652408034127965',
        text: '과거 스냅샷',
        type: 1,
        own: 0,
        observed_at: '2026-11-12T17:00:00+09:00',
        sent_at: 'None',
      };
      const other = { ...old, log_id: '3970073012646000645' };
      const groups = [{ room_id: old.room_id, messages: [old, other] }];
      expect(await importNativeMessages({ groups }, evidence)).toEqual({
        memberships: 2,
        unique: 2,
        imported: 1,
      });
      const rows = (await evidence.db.execute('select body from kakao_messages order by order_id'))
        .rows;
      expect(rows[0]?.body).toMatchObject({ text: '합성 원문', source: 'live' });
      expect(rows[1]?.body).toMatchObject({ text: '과거 스냅샷', source: 'reference' });
      expect(
        (await evidence.db.execute('select count(*)::int n from intake_events')).rows[0]?.n,
      ).toBe(1);
      expect(await new NativeNormalizer(evidence).processBatch()).toEqual({
        scanned: 0,
        normalized: 0,
      });
      await expect(
        importNativeMessages(
          {
            groups: [
              { room_id: old.room_id, messages: [old, { ...old, text: '충돌한 다른 원문' }] },
            ],
          },
          evidence,
        ),
      ).rejects.toThrow('MESSAGE_CONFLICT');
    } finally {
      await evidence.close();
    }
  });
  it('fills each15-message quota after noise filtering and resumes from the consumed native ID', async () => {
    const evidence = new EvidenceRepository(),
      roomId = '5550001',
      at = 1794556800000;
    try {
      const frame = (room: string, logId: string, text: string) => ({
        room_id: room,
        log_id: logId,
        author_id: '42',
        author_name: '합성',
        text,
        type: 1,
        own: 0,
        observed_at: '2026-11-13T08:00:00Z',
        sent_at: 'None',
      });
      const messages = Array.from({ length: 200 }, (_, i) => i + 1).flatMap((i) => [
        frame(roomId, String(1000 - i), i % 5 ? '안녕하세요' : `합성 의견 ${1000 - i}`),
        frame(roomId, String(1000 + i), i % 5 ? 'ㅋㅋ' : `합성 의견 ${1000 + i}`),
      ]);
      await importNativeMessages(
        {
          groups: [
            { room_id: roomId, messages },
            { room_id: '5550002', messages: [frame('5550002', '995', '다른 방의 의견')] },
          ],
        },
        evidence,
      );
      const build = (direction: 'before' | 'after', relations?: ReadonlyMap<string, 'unrelated'>) =>
        new StoredContextSource(evidence.db, {
          roomId,
          anchorId: '1000',
          direction,
          from: at - 1000,
          until: at + 1000,
          relations,
        });
      const collect = (
        direction: 'before' | 'after',
        cursor: string | null = null,
        accepted: Awaited<ReturnType<typeof collectUsefulContext>>['messages'] = [],
      ) =>
        collectUsefulContext({
          source: build(direction),
          roomId,
          anchorId: '1000',
          direction,
          cursor,
          accepted,
          budget: { maxPages: 3, maxScanned: 200 },
          additional: 15,
        });
      const first = await collect('before'),
        second = await collect('before', first.cursor, first.messages),
        after = await collect('after');
      expect(first.messages.map((m) => m.logId)).toEqual(
        Array.from({ length: 15 }, (_, i) => String(995 - i * 5)),
      );
      expect(second.messages.map((m) => m.logId)).toEqual(
        Array.from({ length: 15 }, (_, i) => String(920 - i * 5)),
      );
      expect(after.messages.map((m) => m.logId)).toEqual(
        Array.from({ length: 15 }, (_, i) => String(1005 + i * 5)),
      );
      expect(
        new Set([...first.messages, ...second.messages, ...after.messages].map((m) => m.logId))
          .size,
      ).toBe(45);
      const manual = await collectUsefulContext({
        source: build('before', new Map([['995', 'unrelated']])),
        roomId,
        anchorId: '1000',
        direction: 'before',
        cursor: null,
        budget: { maxPages: 3, maxScanned: 200 },
      });
      expect(manual.messages.map((m) => m.logId)).not.toContain('995');
      expect(manual.messages).toHaveLength(15);
      const shortage = await collectUsefulContext({
        source: new StoredContextSource(evidence.db, {
          roomId: '5550002',
          anchorId: '1000',
          direction: 'before',
          from: at - 1000,
          until: at + 1000,
        }),
        roomId: '5550002',
        anchorId: '1000',
        direction: 'before',
        cursor: null,
        budget: { maxPages: 3, maxScanned: 200 },
      });
      expect(shortage).toMatchObject({
        shortage: 14,
        exhausted: false,
        reason: 'gap',
        gap: 'stored_history_boundary',
      });
      await expect(build('before').read('2000', 15)).rejects.toThrow('CURSOR');
    } finally {
      await evidence.close();
    }
  });
  it('rolls back a partial normalization batch on native identity mismatch while retaining the raw data', async () => {
    const evidence = new EvidenceRepository(),
      processor = new NativeNormalizer(evidence);
    try {
      const before = (await evidence.db.execute('select last_pk from native_worker_offsets'))
        .rows[0]?.last_pk;
      const savedCount = (await evidence.db.execute('select count(*)::int n from kakao_messages'))
        .rows[0]?.n;
      await evidence.db.insert(intakeEvents).values(
        ['3970073012646000643', '3970073012646000644'].map((logId, i) => ({
          source: 'kakao',
          ownerInstance: 'synthetic',
          identity: (i ? 'b' : 'a').repeat(64),
          roomId: '18497500347065223',
          logId,
          payload: {
            event: {
              chat_id: i ? '999' : '18497500347065223',
              log_id: logId,
              type: 1,
              text: '합성 후속',
            },
            own: null,
            wireSelection: 'missing',
          },
        })),
      );
      await expect(processor.processBatch()).rejects.toThrow('IDENTITY_MISMATCH');
      expect(
        (await evidence.db.execute('select last_pk from native_worker_offsets')).rows[0]?.last_pk,
      ).toBe(before);
      expect(
        (await evidence.db.execute('select count(*)::int n from kakao_messages')).rows[0]?.n,
      ).toBe(savedCount);
      expect(
        (await evidence.db.execute('select count(*)::int n from intake_events')).rows[0]?.n,
      ).toBe(3);
    } finally {
      await evidence.close();
    }
  });
  it('publishes a retained, classified room into canonical evidence with an atomic checkpoint', async () => {
    const evidence = new EvidenceRepository();
    try {
      const roomId = '65421';
      const at = Date.parse('2026-11-17T04:00:00Z');
      const logId = '3970073012646000888';
      const [raw] = await evidence.db
        .insert(intakeEvents)
        .values({
          source: 'kakao',
          ownerInstance: 'synthetic',
          identity: 'c'.repeat(64),
          roomId,
          logId,
          payload: {},
        })
        .returning();
      if (!raw) throw Error('FIXTURE_RAW_EVENT_REQUIRED');
      await evidence.db.insert(monitoringRooms).values({
        roomId,
        body: { name: 'Synthetic room' },
        metrics: {},
        excluded: false,
        joined: true,
        snapshotId: randomUUID(),
      });
      await evidence.db.insert(monitoringSettings).values({
        key: 'keywords',
        value: {
          keywords: ['APL'],
          keyword_groups: [{ id: 'apl', name: 'APL', kind: 'service', keywords: ['APL'] }],
          exclude_keywords: ['테스트 제외 [숫자]회', '합성 APL 공지:'],
        },
      });
      const base = {
        roomId,
        authorId: '77',
        authorName: '참가자',
        type: 1,
        own: false,
        observedAt: new Date(at).toISOString(),
        sortAt: at,
        sentAt: new Date(at).toISOString(),
        timeSource: 'native' as const,
        prevId: null,
        replyTo: null,
        wireStatus: 'verified' as const,
        source: 'live' as const,
      };
      const bodies = [
        { ...base, logId, text: 'APL 티켓은 어디서 쓰나요?' },
        {
          ...base,
          logId: '3970073012646000887',
          text: '대회 정보를 찾아봤어요',
          sortAt: at - 1000,
        },
        { ...base, logId: '3970073012646000889', text: 'ㅋㅋ' },
        { ...base, logId: '3970073012646000890', text: '테스트 제외 25회 홍보' },
        { ...base, logId: '3970073012646000891', text: '안내 페이지에 사용처가 나와 있어요' },
      ];
      const preceding = Array.from({ length: 15 }, (_, i) => ({
        ...base,
        logId: String(BigInt(logId) - BigInt(i + 2)),
        text: `대회 참가 일정 ${i + 1}번을 확인했어요`,
        sortAt: at - (i + 2) * 1000,
      }));
      await evidence.db.insert(kakaoMessages).values(
        [...bodies, ...preceding].map((body, i) => ({
          roomId,
          logId: body.logId,
          orderId: body.logId,
          body,
          intakePk: i === 0 ? raw.pk : null,
        })),
      );
      const worker = new NativeContextPublisher(evidence);
      expect(await worker.processBatch(at + 2_700_000)).toEqual({ published: 0, lastPk: 0 });
      await evidence.db
        .update(nativeWorkerOffsets)
        .set({ lastPk: raw.pk })
        .where(eq(nativeWorkerOffsets.consumer, 'native-normalize'));
      expect(await worker.processBatch(at + 2_700_000)).toEqual({ published: 1, lastPk: raw.pk });
      expect(await worker.processBatch(at + 2_700_000)).toEqual({ published: 0, lastPk: raw.pk });
      const entries = await evidence.list({
        day: '2026-11-17',
        target: 'APL',
        label: '',
        limit: 10,
      });
      expect(entries.total).toBe(1);
      const detail = await evidence.detail(entries.items[0]?.conversationId ?? '');
      expect(detail.contextPaging).toEqual({ beforeTotal: 16, afterTotal: 1 });
      expect(detail.before).toBe(15);
      expect(detail.messages.map((m) => m.id)).toEqual([
        ...preceding
          .slice(0, 14)
          .reverse()
          .map((body) => body.logId),
        bodies[1]?.logId,
        logId,
        bodies[4]?.logId,
      ]);
      const expanded = await evidence.detail(detail.conversation.id, { before: 30, after: 15 });
      expect(expanded.before).toBe(16);
      expect(expanded.messages.map((m) => m.id)).toEqual([
        preceding[14]?.logId,
        ...detail.messages.map((m) => m.id),
      ]);
      expect(detail.limited).toBe(true);
      expect((await evidence.options(detail.conversation.id))[0]?.label).toBe('unreviewed');
    } finally {
      await evidence.close();
    }
  });
  it('publishes a complete group across batch boundaries and exposes only the ad reference', async () => {
    const evidence = new EvidenceRepository();
    try {
      const roomId = '65422';
      const at = Date.parse('2026-11-17T05:00:00Z');
      const ad = '합성 APL 공지: 티켓 신청 안내 많은관심부탁드립니다';
      const fixtures = [
        { logId: '700', text: ad, authorId: '56' },
        { logId: '701', text: '티켓이 너무 비싸네요', replyTo: '700', authorId: '57' },
        { logId: '702', text: '그 가격에는 참가하기 어렵겠어요', authorId: '58' },
        { logId: '703', text: 'APL 평일 티켓 가격도 같은가요?', authorId: '58' },
        { logId: '704', text: '주말 기준이라면 후기 보고 결정할게요', authorId: '57' },
      ];
      await evidence.db.insert(monitoringRooms).values({
        roomId,
        body: { name: 'Synthetic group' },
        metrics: {},
        excluded: false,
        joined: true,
        snapshotId: randomUUID(),
      });
      const raw = await evidence.db
        .insert(intakeEvents)
        .values(
          fixtures.map(({ logId }) => ({
            source: 'kakao',
            ownerInstance: 'synthetic',
            identity: logId.padStart(64, '0'),
            roomId,
            logId,
            payload: {},
          })),
        )
        .returning();
      await evidence.db.insert(kakaoMessages).values(
        fixtures.map((fixture, index) => {
          const sortAt = at + index * 60_000;
          return {
            roomId,
            logId: fixture.logId,
            orderId: fixture.logId,
            intakePk: raw[index]?.pk,
            body: {
              ...fixture,
              roomId,
              type: fixture.replyTo ? 26 : 1,
              own: false,
              authorName: '합성 참가자',
              replyTo: fixture.replyTo ?? null,
              sortAt,
              sentAt: new Date(sortAt).toISOString(),
              observedAt: new Date(sortAt + 1000).toISOString(),
              timeSource: 'native',
              prevId: null,
              wireStatus: 'verified',
              source: 'live',
            },
          };
        }),
      );
      const lastPk = raw.at(-1)?.pk;
      if (!lastPk) throw Error('GROUP_FIXTURE_RAW_EVENTS_MISSING');
      await evidence.db
        .update(nativeWorkerOffsets)
        .set({ lastPk })
        .where(eq(nativeWorkerOffsets.consumer, 'native-normalize'));
      const worker = new NativeContextPublisher(evidence);
      expect((await worker.processBatch(at + 2_760_000)).published).toBe(1);
      expect((await worker.processBatch(at + 3_000_000)).published).toBe(0);
      const entries = await evidence.list({
        day: '2026-11-17',
        target: 'APL',
        label: '',
        limit: 10,
      });
      const entry = entries.items.find((item) => item.room === 'Synthetic group');
      if (!entry) throw Error('GROUP_FIXTURE_NOT_PUBLISHED');
      expect(entries.items.filter((item) => item.room === entry.room)).toHaveLength(1);
      const detail = await evidence.detail(entry.conversationId);
      expect(detail.messages.map((row) => row.id)).toEqual(['701', '702', '703', '704']);
      expect(detail.conversation.keywords).toEqual({ APL: 1 });
      expect(detail.messages[0]?.promotionReference).toMatchObject({
        logId: '700',
        method: 'explicit_reply',
        targets: ['APL'],
      });
      expect(detail.episodes).toHaveLength(2);
      expect(await evidence.canonicalId(detail.episodes?.[1]?.id ?? '')).toBe(
        detail.conversation.id,
      );
      expect(JSON.stringify(detail)).not.toContain(ad);
      const bookmarks = new BookmarksRepository(evidence);
      const source_id = detail.episodes?.[1]?.id;
      await bookmarks.save({ kind: 'conversation', source_id });
      await bookmarks.save({ kind: 'episode', source_id });
      expect(
        (await bookmarks.list({ kind: 'conversation', source_id: detail.conversation.id })).total,
      ).toBe(1);
      expect((await bookmarks.list({ kind: 'episode', source_id })).total).toBe(1);
    } finally {
      await evidence.close();
    }
  });
});
