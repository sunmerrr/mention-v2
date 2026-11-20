import { randomUUID } from 'node:crypto';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { koreanDay } from '@app/shared/monitoring/domain/time';
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { eq } from 'drizzle-orm';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { createDatabase } from '../../src/db/client.js';
import { nativeStateRecords, nativeStateSnapshots } from '../../src/db/schema.js';
import {
  importNativeState,
  nativeStateTables,
} from '../../src/modules/evidence/import-native-state.js';
import { GuideRepository } from '../../src/modules/monitoring/guide.repository.js';
import { RoomsRepository } from '../../src/modules/monitoring/rooms.repository.js';

let container: StartedPostgreSqlContainer,
  client: ReturnType<typeof createDatabase>,
  directory: string;
beforeAll(async () => {
  container = await new PostgreSqlContainer('postgres:16-alpine').start();
  client = createDatabase(container.getConnectionUri(), true);
  await migrate(client.db, { migrationsFolder: path.resolve('drizzle') });
  directory = await mkdtemp(path.join(tmpdir(), 'native-state-'));
}, 120000);
afterAll(async () => {
  await client?.pool.end();
  await container?.stop();
  if (directory) await rm(directory, { recursive: true, force: true });
});
const header = () => ({
  kind: 'native-state',
  version: 1,
  id: randomUUID(),
  capturedAt: '2026-11-13T10:00:00.000Z',
  counts: Object.fromEntries(nativeStateTables.map((t) => [t, t === 'campaign_sends' ? 1 : 0])),
});
async function file(h: ReturnType<typeof header>, rows: unknown[]) {
  const f = path.join(directory, `${randomUUID()}.jsonl`);
  await writeFile(f, [h, ...rows].map((r) => JSON.stringify(r)).join('\n'), { mode: 0o600 });
  return f;
}
it('preserves inert uncertain receipts, supports exact replay and refuses changed original records', async () => {
  const h = header(),
    row = {
      table: 'campaign_sends',
      ordinal: 0,
      body: { request_id: 'kept', state: 'unknown', log_id: '3970073012646000642' },
    };
  delete h.counts.confirmed_observations;
  const f = await file(h, [row]);
  expect((await importNativeState(f, client)).records).toBe(1);
  await importNativeState(f, client);
  const snapshots = await client.db
    .select()
    .from(nativeStateSnapshots)
    .where(eq(nativeStateSnapshots.id, h.id));
  const snapshot = snapshots[0];
  if (!snapshot) throw Error('MISSING_SNAPSHOT');
  const saved = await client.db
    .select()
    .from(nativeStateRecords)
    .where(eq(nativeStateRecords.snapshotPk, snapshot.pk));
  expect(snapshots[0]?.complete).toBe(true);
  expect(saved).toHaveLength(1);
  expect(saved[0]?.body).toEqual(row.body);
  await expect(
    importNativeState(await file(h, [{ ...row, body: { ...row.body, state: 'pending' } }]), client),
  ).rejects.toThrow('NATIVE_STATE_RECORD_CHANGED');
});
it('does not publish a truncated snapshot and resumes the same immutable snapshot', async () => {
  const h = header();
  await expect(importNativeState(await file(h, []), client)).rejects.toThrow(
    'NATIVE_STATE_SNAPSHOT_INCOMPLETE',
  );
  expect(
    (
      await client.db.select().from(nativeStateSnapshots).where(eq(nativeStateSnapshots.id, h.id))
    )[0]?.complete,
  ).toBe(false);
  await importNativeState(
    await file(h, [{ table: 'campaign_sends', ordinal: 0, body: { state: 'sending' } }]),
    client,
  );
  expect(
    (
      await client.db.select().from(nativeStateSnapshots).where(eq(nativeStateSnapshots.id, h.id))
    )[0]?.complete,
  ).toBe(true);
});
it('rejects unsafe settings, missing tables and unordered records', async () => {
  const h = header();
  h.counts.campaign_sends = 0;
  h.counts.settings = 1;
  await expect(
    importNativeState(
      await file(h, [
        { table: 'settings', ordinal: 0, body: { key: 'auth_token', value: 'not-retained' } },
      ]),
      client,
    ),
  ).rejects.toThrow('NATIVE_STATE_SETTING_NOT_ALLOWED');
  const missing = header();
  delete missing.counts.rooms;
  await expect(importNativeState(await file(missing, []), client)).rejects.toThrow(
    'NATIVE_STATE_TABLE_NOT_ALLOWED',
  );
  await expect(
    importNativeState(
      await file(header(), [{ table: 'campaign_sends', ordinal: 1, body: {} }]),
      client,
    ),
  ).rejects.toThrow('NATIVE_STATE_RECORD_ORDER_INVALID');
});

it('materializes room policy and completed counts without replaying guide or send work', async () => {
  const h = header();
  h.counts.campaign_sends = 0;
  h.counts.rooms = 2;
  h.counts.settings = 2;
  h.counts.messages = 3;
  const day = koreanDay(Date.now()),
    cid = '18497500347065223',
    other = '18497500347065224';
  await importNativeState(
    await file(h, [
      {
        table: 'rooms',
        ordinal: 0,
        body: { id: cid, name: 'APL % 방', excluded: 1, joined: 1, title_verified: 1 },
      },
      {
        table: 'rooms',
        ordinal: 1,
        body: { id: other, name: '다른 방', excluded: 0, joined: 1, title_verified: 1 },
      },
      { table: 'settings', ordinal: 0, body: { key: 'keywords', value: '["APL"]' } },
      {
        table: 'settings',
        ordinal: 1,
        body: { key: 'exclude_keywords', value: '["홍보 [숫자]회"]' },
      },
      ...['APL 질문', 'APL 홍보 12회', '미해당'].map((text, ordinal) => ({
        table: 'messages',
        ordinal,
        body: { room_id: cid, text, day, sort_at: 1700000000000, source: 'live' },
      })),
    ]),
    client,
  );
  const rooms = new RoomsRepository(client);
  expect((await rooms.importSnapshot(h.id)).rooms).toBe(2);
  expect((await rooms.importSnapshot(h.id)).replayed).toBe(true);
  const result = await rooms.list({ q: '%' });
  expect(result.excluded.total).toBe(1);
  expect(result.included.total).toBe(0);
  expect(result.excluded.rooms[0]?.count).toBe(1);
  expect(result.summary.messages).toBe(1);
  await expect(rooms.save({ room_ids: [cid, '9'], excluded: false })).rejects.toThrow(
    '알 수 없는 방',
  );
  expect((await rooms.list({})).excluded.total).toBe(1);
  await rooms.save({ room_ids: [cid, cid], excluded: false });
  expect((await rooms.list({})).excluded.total).toBe(0);
  expect((await rooms.list({})).summary.unresolved_gaps).toBe(1);
  await rooms.save({ room_ids: [cid], excluded: false });
  expect((await rooms.list({})).summary.unresolved_gaps).toBe(1);
  const newer = header();
  newer.counts.campaign_sends = 0;
  await importNativeState(await file(newer, []), client);
  await expect(rooms.importSnapshot(newer.id)).rejects.toThrow('ROOM_SOURCE_HANDOFF_REQUIRED');
});

it('keeps guide switches and references separate from analysis exclusions', async () => {
  const guide = new GuideRepository(client),
    cid = '18497500347065223';
  const references = [
    { kind: 'document', label: '문서', value: '/Users/we/work/apl-guide/ANSWERING.md' },
  ];
  const h = header();
  h.counts.campaign_sends = 0;
  h.counts.guide_rooms = 1;
  h.counts.guide_messages = 1;
  h.counts.guide_message_details = 1;
  h.counts.guide_followup_links = 1;
  const log = '3970073012646000642',
    stamp = new Date().toISOString();
  await importNativeState(
    await file(h, [
      {
        table: 'guide_rooms',
        ordinal: 0,
        body: {
          room_id: cid,
          updated_at: stamp,
          config: JSON.stringify({
            enabled: true,
            respond: false,
            keywords: ['APL'],
            names: [],
            references,
          }),
        },
      },
      {
        table: 'guide_messages',
        ordinal: 0,
        body: {
          room_id: cid,
          log_id: log,
          observed_at: stamp,
          text: 'APL 티켓 질문',
          source: 'live',
          own: 0,
        },
      },
      {
        table: 'guide_message_details',
        ordinal: 0,
        body: {
          room_id: cid,
          log_id: log,
          reply_to: '3970073012646000600',
          quote: '{"text":"질문"}',
        },
      },
      {
        table: 'guide_followup_links',
        ordinal: 0,
        body: { room_id: cid, log_id: log, context: '{"kind":"verified"}' },
      },
    ]),
    client,
  );
  expect((await guide.importSnapshot(h.id)).messages).toBe(1);
  expect((await guide.importSnapshot(h.id)).replayed).toBe(true);
  expect((await guide.list({ room: cid })).messages[0]?.reply_to).toBe('3970073012646000600');
  await new RoomsRepository(client).save({ room_ids: [cid], excluded: true });
  await guide.save({
    room_id: cid,
    enabled: true,
    respond: false,
    keywords: [' APL ', 'APL'],
    names: ['땅콩'],
    references,
  });
  expect(await guide.captureEnabled(cid)).toBe(true);
  expect((await guide.list({ room: cid })).config.respond).toBe(false);
  await guide.save({ room_id: cid, enabled: false, respond: true, keywords: ['APL'], names: [] });
  expect(await guide.captureEnabled(cid)).toBe(false);
  expect((await guide.list({ room: cid })).config.references).toEqual(references);
  await expect(
    guide.save({ room_id: '9', enabled: true, respond: true, keywords: [], names: [] }),
  ).rejects.toThrow('참여 중인 방');
  await expect(
    guide.save({
      room_id: cid,
      enabled: true,
      respond: true,
      keywords: [],
      names: [],
      references: [{ kind: 'website', value: 'https://user:password@example.test' }],
    }),
  ).rejects.toThrow();
  expect((await guide.list({ room: cid })).config.enabled).toBe(false);
});

it('publishes the archived message feed independently with stable paging and safe CSV', async () => {
  const { MessageTimeline } = await import('../../src/modules/monitoring/message-timeline.js');
  const h = header();
  h.counts.campaign_sends = 0;
  h.counts.messages = 102;
  const observed = '2026-11-13T10:00:00.000+09:00';
  const records = Array.from({ length: 102 }, (_, ordinal) => ({
    table: 'messages',
    ordinal,
    body: {
      room_id: '1',
      log_id: String(ordinal + 1),
      text: ordinal === 101 ? '=APL 123' : 'APL 질문',
      observed_at: observed,
      sort_at: Date.parse(observed),
      day: '2026-11-13',
      type: 1,
      own: 0,
      source: 'live',
    },
  }));
  await importNativeState(await file(h, records), client);
  const { monitoringSettings } = await import('../../src/db/schema.js');
  await client.db
    .insert(monitoringSettings)
    .values({
      key: 'keywords',
      value: { keywords: ['APL'], keyword_groups: [], exclude_keywords: [] },
    })
    .onConflictDoUpdate({
      target: monitoringSettings.key,
      set: { value: { keywords: ['APL'], keyword_groups: [], exclude_keywords: [] } },
    });
  const timeline = new MessageTimeline(client);
  await timeline.refresh(h.id);
  const params = { day: '2026-11-13' };
  const first = await timeline.list(params);
  expect(first.messages).toHaveLength(100);
  expect(first.keyword_counts).toEqual({ APL: 102 });
  expect(first.messages[0]?.text).toBe('=APL 123');
  expect(first.next_before).toBeTruthy();
  const second = await timeline.list({ ...params, before: first.next_before ?? '' });
  expect(second.messages).toHaveLength(2);
  expect(second.next_before).toBeNull();
  expect(second.messages.map(({ log_id }) => log_id)).toEqual(['2', '1']);
  const csv = await timeline.asset('/download/2026-11-13.csv');
  expect(csv.bytes.toString()).toContain("'=APL 123");
  await client.db
    .update(monitoringSettings)
    .set({
      value: { keywords: ['APL'], keyword_groups: [], exclude_keywords: ['123'] },
    })
    .where(eq(monitoringSettings.key, 'keywords'));
  await expect(timeline.list(params)).rejects.toMatchObject({ code: 'TIMELINE_NOT_READY' });
  await timeline.refresh(h.id);
  const after = await timeline.list(params);
  expect(after.keyword_counts).toEqual({ APL: 101 });
  expect(after.messages[0]?.cursor).toBe(first.messages[1]?.cursor);
});

it('reads and saves PostgreSQL briefings with an idempotent revision and downloadable PNG', async () => {
  const { BriefingRepository } = await import(
    '../../src/modules/monitoring/briefing.repository.js'
  );
  const { TimelineTrends } = await import('../../src/modules/monitoring/timeline-trends.js');
  const { generations, state } = await import('../../src/db/schema.js');
  const [generation] = await client.db
    .insert(generations)
    .values({
      metadata: {
        targets: [],
        capturedAt: new Date().toISOString(),
        source: 'synthetic',
        collectionState: 'idle',
        gaps: 0,
      },
      digest: 'synthetic',
      sourceCapturedAt: new Date(),
    })
    .returning();
  if (!generation) throw Error('TEST_GENERATION_REQUIRED');
  await client.db.insert(state).values({ key: 'active', generationPk: generation.pk });
  const briefing = new BriefingRepository(client, new TimelineTrends(client));
  const day = '2026-11-13';
  expect(await briefing.read(day)).toMatchObject({ saved: false, report: { day } });
  expect(await briefing.refresh(day)).toMatchObject({ saved: true, stale: false, revision: 1 });
  expect(await briefing.refresh(day)).toMatchObject({ saved: true, revision: 1 });
  const { bytes } = await briefing.image(day);
  expect(bytes.subarray(0, 8)).toEqual(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
});

it('registers exact confirmed observations once, keeps their evidence and hides excluded rooms from shared reads', async () => {
  const { CampaignRegistry } = await import('../../src/modules/monitoring/campaign-registry.js');
  const { CampaignView } = await import('../../src/modules/monitoring/campaign-view.js');
  const { campaignFingerprint } = await import(
    '../../src/modules/monitoring/observation-protocol.js'
  );
  const { monitoringRooms, monitoringCampaignLinks } = await import('../../src/db/schema.js');
  await client.db.insert(monitoringRooms).values({
    roomId: '9001',
    joined: true,
    excluded: false,
    metrics: {},
    body: { name: '합성 관찰 방' },
  });
  const registry = new CampaignRegistry(client);
  const view = new CampaignView(client);
  const request = {
    room_id: '9001',
    request_id: 'mention_v2_synthetic_receipt',
    title: '질문 🃏',
    seed: 'APL 티켓은 어디서 쓰나요?',
    duration: 15 as const,
  };
  const at = Date.now();
  const item = {
    request,
    fingerprint: campaignFingerprint(request),
    receipt: {
      anchor_ms: at,
      message: {
        chat_id: '9001',
        log_id: '9002',
        text: request.seed,
        type: 1,
        own: true,
        observed_at: new Date(at).toISOString(),
        sent_at: null,
      },
    },
  };
  const first = await registry.confirmed(item);
  expect(first).toMatchObject({ request_id: request.request_id, log_id: '9002' });
  expect(await registry.confirmed(item)).toEqual(first);
  expect(
    await client.db
      .select()
      .from(monitoringCampaignLinks)
      .where(eq(monitoringCampaignLinks.campaignId, first.episode_id)),
  ).toHaveLength(1);
  const changed = {
    ...item,
    receipt: { ...item.receipt, message: { ...item.receipt.message, log_id: '9003' } },
  };
  await expect(registry.confirmed(changed)).rejects.toThrow('OBSERVATION_REQUEST_CONFLICT');
  expect(await view.episode(first.episode_id)).toMatchObject({
    anchor_log_id: '9002',
    messages: [{ log_id: '9002', role: 'anchor' }],
  });
  await client.db
    .update(monitoringRooms)
    .set({ excluded: true })
    .where(eq(monitoringRooms.roomId, '9001'));
  expect(await view.episode(first.episode_id, false)).toBeNull();
  expect(await view.episode(first.episode_id, true)).toMatchObject({ anchor_log_id: '9002' });
  const { EpisodeEdits } = await import('../../src/modules/monitoring/episode-edits.js');
  const edits = new EpisodeEdits(client, view);
  await client.db.insert(monitoringCampaignLinks).values({
    campaignId: first.episode_id,
    logId: '9004',
    at: at + 5000,
    role: 'after',
    relation: 'pending',
    body: {
      log_id: '9004',
      time_ms: at + 5000,
      text: '티켓 사용처가 궁금합니다.',
      type: 1,
      own: false,
      room_id: '9001',
    },
  });
  const result = await edits.review(
    { id: first.episode_id, log_id: '9004', relation: 'related' },
    true,
  );
  expect(result.undo_ids).toHaveLength(1);
  await edits.annotate(
    {
      id: first.episode_id,
      log_id: '9004',
      topics: ['benefit'],
      stance: 'neutral',
      note: '합성 메모',
    },
    true,
  );
  expect(await view.episode(first.episode_id, true)).toMatchObject({
    feedback_count: 1,
    messages: [
      { log_id: '9002' },
      { log_id: '9004', feedback_annotation: { topics: ['benefit'], stance: 'neutral' } },
    ],
  });
  await expect(edits.undo(result.undo_ids?.[0], true)).rejects.toMatchObject({
    code: 'CONTEXT_REVIEW_CHANGED',
  });
});
