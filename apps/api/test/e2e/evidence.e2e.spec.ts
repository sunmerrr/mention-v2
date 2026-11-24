import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { eq } from 'drizzle-orm';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createDatabase } from '../../src/db/client.js';
import { monitoringContextHistory } from '../../src/db/schema.js';
import {
  contextHistoryBase,
  EvidenceRepository,
} from '../../src/modules/evidence/evidence.repository.js';
import { importNativeReference } from '../../src/modules/evidence/native-reference.js';
import { BookmarksRepository } from '../../src/modules/monitoring/bookmarks.repository.js';
import { config } from '../../src/shared/config/index.js';

const bundle = (id = 'synthetic-first') => ({
  detail: {
    conversation: {
      id,
      room: '합성 방',
      at: 1794538800000,
      title: '합성 대화',
      targets: ['APL'],
      evaluations: {
        APL: {
          label: 'unreviewed',
          summary: '',
          origin: null,
          stale: false,
          expected: 'baseline-token',
        },
      },
      keywords: { APL: 1 },
      messageCount: 1,
    },
    messages: [
      {
        id: '3970073012646000642',
        author: '합성 참여자',
        text: 'APL 티켓은 어디서 써요?',
        time: 1794538800000,
        phase: 'discussion',
        background: false,
        own: false,
        anchor: true,
      },
    ],
    limited: true,
    before: 0,
    after: 0,
    source: 'synthetic',
  },
  classifications: [
    {
      id: `${id}:APL`,
      conversationId: id,
      target: 'APL',
      label: 'unreviewed',
      summary: '',
      origin: null,
      stale: false,
      expected: 'baseline-token',
      room: '합성 방',
      at: 1794538800000,
      history: [],
    },
  ],
});
const metadata = (ids: string[]) => ({
  conversations: ids.map((id) => bundle(id).detail.conversation),
  targets: [{ name: 'APL', aliases: ['APL'], mentions: ids.length }],
  capturedAt: '2026-11-13T07:00:00.000Z',
  source: 'synthetic',
  collectionState: 'synthetic',
  gaps: 0,
});
describe('authoritative PostgreSQL evidence and classifications', () => {
  let container: StartedPostgreSqlContainer, store: EvidenceRepository;
  const prior = config.DATABASE_URL;
  beforeAll(async () => {
    container = await new PostgreSqlContainer('postgres:16-alpine').start();
    config.DATABASE_URL = container.getConnectionUri();
    const c = createDatabase(config.DATABASE_URL, true);
    try {
      await migrate(c.db, { migrationsFolder: path.resolve('drizzle') });
    } finally {
      await c.pool.end();
    }
    store = new EvidenceRepository();
    await store.importBundle(bundle());
    await store.publishMetadata(metadata(['synthetic-first']));
  }, 120000);
  afterAll(async () => {
    await store?.close();
    config.DATABASE_URL = prior;
    await container?.stop();
  });
  it('retains exact original IDs, notes, expected tokens and rejects inconsistent evidence', async () => {
    expect((await store.detail('synthetic-first')).messages[0]?.id).toBe('3970073012646000642');
    expect((await store.options('synthetic-first'))[0]?.expected).toBe('baseline-token');
    const bad = bundle('invalid');
    const badOption = bad.classifications[0];
    if (!badOption) throw Error('MISSING_FIXTURE');
    badOption.expected = 'changed';
    await expect(store.importBundle(bad)).rejects.toThrow('Classification changed');
  });
  it('resolves old episode IDs while preserving guarded classifications and native room identity', async () => {
    const nativeGroup = {
      id: 'synthetic-first',
      room_id: '18497500347065223',
      anchor_ms: 1794538800000,
      services: ['APL'],
      members: [
        { id: 'synthetic-first', title: '합성 첫 대화' },
        { id: 'legacy-episode', title: '합성 두번째 대화' },
      ],
      messages: [
        {
          room_id: '18497500347065223',
          log_id: '3970073012646000642',
          author_id: '7175652408034127965',
        },
      ],
    };
    const episodeRecords = nativeGroup.members.map((m, i) => ({
      id: m.id,
      room_id: nativeGroup.room_id,
      title: m.title,
      services: '["APL"]',
      anchor_ms: 1794538800000 + i * 1000,
    }));
    expect(await importNativeReference({ groups: [nativeGroup], episodeRecords }, store)).toEqual({
      groups: 1,
      aliases: 2,
      messages: 1,
    });
    expect((await store.detail('legacy-episode')).conversation.id).toBe('synthetic-first');
    expect(await store.options('legacy-episode')).toEqual(await store.options('synthetic-first'));
    await expect(
      importNativeReference(
        { groups: [nativeGroup, { ...nativeGroup, id: 'another-group' }] },
        store,
      ),
    ).rejects.toThrow('ALIAS_COLLISION');
    await expect(
      importNativeReference({ groups: [{ ...nativeGroup, room_id: '1' }] }, store),
    ).rejects.toThrow('WRONG_ROOM');
    expect((await store.options('legacy-episode'))[0]?.expected).toBe('baseline-token');
  });
  it('stores bookmarks and archive history locally, resolving conversation aliases but retaining episode identity', async () => {
    const bookmarks = new BookmarksRepository(store);
    expect((await bookmarks.list({})).total).toBe(0);
    const input = {
      kind: 'conversation',
      source_id: 'legacy-episode',
      category: 'question',
      status: 'todo',
      owner: ' 담당자 ',
      note: "100% O'Reilly 확인",
    };
    const first = await bookmarks.save(input),
      second = await bookmarks.save({ ...input, status: 'in_progress' });
    expect(first.id).toBe(second.id);
    expect(second).toMatchObject({
      source_id: 'synthetic-first',
      room_id: '18497500347065223',
      title: '합성 첫 대화',
      owner: '담당자',
      event_ms: 1794538800000,
    });
    expect((await bookmarks.list({ q: '100%', status: 'all', category: 'all' })).total).toBe(1);
    expect((await bookmarks.list({ q: "%' OR true --" })).total).toBe(0);
    expect(
      (await bookmarks.list({ kind: 'conversation', source_id: 'legacy-episode' })).items[0]?.id,
    ).toBe(first.id);
    await bookmarks.archive({ id: first.id });
    expect((await bookmarks.list({})).total).toBe(0);
    expect((await bookmarks.list({ archived: '1' })).total).toBe(1);
    await bookmarks.archive({ id: first.id, archive: false });
    expect((await bookmarks.list({ archived: 'false' })).total).toBe(1);
    const episode = await bookmarks.save({ ...input, kind: 'episode' });
    expect(episode).toMatchObject({
      source_id: 'legacy-episode',
      title: '합성 두번째 대화',
      event_ms: 1794538801000,
    });
    expect((await bookmarks.list({})).total).toBe(2);
    await expect(bookmarks.archive({ id: first.id, archive: 'false' })).rejects.toThrow();
  });
  it('atomically commits label, memo, evidence revision, append-only audit and request receipt', async () => {
    const request = {
      id: 'legacy-episode',
      service: 'APL',
      verdict: 'excluded' as const,
      summary: '티켓 사용처 문의이므로 여론 판단 제외',
      expected: 'baseline-token',
      request_id: randomUUID(),
    };
    expect(await store.correct(request)).toMatchObject({
      ok: true,
      verdict: 'excluded',
      origin: 'human',
    });
    const detail = await store.detail(request.id),
      options = await store.options(request.id);
    expect(options[0]).toMatchObject({
      label: 'excluded',
      summary: request.summary,
      origin: 'human',
      stale: false,
    });
    expect(detail.conversation.evaluations.APL?.expected).toBe(options[0]?.expected);
    expect(await store.correct(request)).toMatchObject({ replayed: true });
    await expect(store.correct({ ...request, summary: 'changed' })).rejects.toThrow('동일 요청');
    expect((await store.options(request.id))[0]?.history).toHaveLength(1);
    const page = await store.list({
      day: '',
      target: 'APL',
      label: 'excluded',
      status: 'excluded',
      limit: 12,
    });
    expect(page.total).toBe(1);
    await expect(
      store.importBundle({
        ...bundle(),
        classifications: [{ ...bundle().classifications[0], summary: 'new source' }],
      }),
    ).rejects.toThrow();
  });
  it('allows one concurrent correction for an expected revision and protects human labels from AI', async () => {
    const option = (await store.options('synthetic-first'))[0];
    if (!option) throw Error('MISSING_OPTION');
    const expected = option.expected;
    const request = {
      id: 'synthetic-first',
      service: 'APL',
      verdict: 'neutral' as const,
      summary: '메모 수정',
      expected,
      request_id: randomUUID(),
    };
    const results = await Promise.allSettled([
      store.correct(request),
      store.correct({ ...request, request_id: randomUUID(), summary: '경쟁 수정' }),
    ]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    const current = (await store.options(request.id))[0];
    if (!current) throw Error('MISSING_OPTION');
    await expect(
      store.correct({
        ...request,
        origin: 'ai',
        expected: current.expected,
        request_id: randomUUID(),
        evidence: [{ log_id: '3970073012646000642', quote: '티켓' }],
      }),
    ).rejects.toThrow('사람이 검토');
  });
  it('preserves unknown legacy receipts and refuses to execute an old request ID', async () => {
    const requestId = randomUUID();
    await store.importAudit('judgment-decisions', {
      request_id: requestId,
      state: 'unknown',
      payload: 'original evidence',
    });
    await store.importAudit('judgment-decisions', {
      request_id: requestId,
      state: 'unknown',
      payload: 'original evidence',
    });
    expect(await store.requestState(requestId)).toEqual({ state: 'unknown' });
    const option = (await store.options('synthetic-first'))[0];
    if (!option) throw Error('MISSING_OPTION');
    await expect(
      store.correct({
        id: 'synthetic-first',
        service: 'APL',
        verdict: 'neutral',
        summary: 'must not execute',
        expected: option.expected,
        request_id: requestId,
      }),
    ).rejects.toThrow('기존 처리 기록');
  });
  it('publishes only imported membership and never resurrects records missing from the active source', async () => {
    await store.importBundle(bundle('synthetic-second'));
    await expect(store.detail('synthetic-second')).rejects.toThrow('찾을 수');
    await expect(store.publishMetadata(metadata(['not-imported']))).rejects.toThrow('INCOMPLETE');
    await store.publishMetadata(metadata(['synthetic-second']));
    expect((await store.dataset()).conversations.map((c) => c.id)).toEqual(['synthetic-second']);
    expect((await store.list({ day: '', target: '', label: '', limit: 12 })).total).toBe(1);
    await expect(store.detail('synthetic-first')).rejects.toThrow('찾을 수');
  });
  it('allows contextual relevance edits and undo while retaining the human verdict and note', async () => {
    const id = 'synthetic-relevance';
    const logId = '3970073012646000643';
    const fixture = bundle(id);
    fixture.detail.messages.push({
      ...fixture.detail.messages[0],
      id: logId,
      anchor: false,
      text: '근처 메시지',
    });
    await store.importBundle(fixture);
    await store.publishMetadata(metadata([id]));
    await store.correct({
      id,
      service: 'APL',
      verdict: 'neutral',
      expected: 'baseline-token',
      summary: '기존 판단',
      request_id: randomUUID(),
    });
    const result = await store.reviewContext({ id, log_id: logId, relation: 'unrelated' });
    expect((await store.detail(id)).messages.at(-1)?.relation).toBe('unrelated');
    expect((await store.options(id))[0]).toMatchObject({
      label: 'neutral',
      summary: '기존 판단',
      origin: 'human',
      stale: true,
    });
    const historyId = result.undo_ids[0] - contextHistoryBase;
    const [change] = await store.db
      .select()
      .from(monitoringContextHistory)
      .where(eq(monitoringContextHistory.pk, historyId));
    await store.undoContext(historyId, change);
    expect((await store.detail(id)).messages.at(-1)?.relation).toBe('pending');
  });
});
