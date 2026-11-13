import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { eq } from 'drizzle-orm';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createDatabase } from '../../src/db/client.js';
import { collectorInbox, forumRetainedReviews } from '../../src/db/schema.js';
import { ForumRepository } from '../../src/modules/forum/forum.repository.js';
import { ForumProcessor } from '../../src/modules/forum/forum-processor.js';
import { ForumStore } from '../../src/modules/forum-intake/forum-store.js';
import { KeywordSettingsRepository } from '../../src/modules/settings/keyword-settings.repository.js';
import { config } from '../../src/shared/config/index.js';

const policy = {
  version: 1,
  keywords: ['APL'],
  keyword_groups: [{ id: 'apl', name: 'APL', kind: 'event', keywords: ['APL'] }],
  sources: { kakao: { disabled: [] }, pokergosu: { disabled: [] } },
};
const capture = (body = 'APL 대회 후기', id = '9999999999999999999') => ({
  operation: 'thread',
  eventId: randomUUID(),
  page_url: `https://www.pokergosu.com/free/${id}`,
  data: {
    id,
    url: `https://www.pokergosu.com/free/${id}`,
    title: '합성 원문',
    body,
    author: '합성',
    published_at: null,
    comments: [],
    comment_coverage: 'visible-complete',
    expected_comments: 0,
    unavailable_comments: 0,
  },
});
describe('durable raw forum processing', () => {
  let container: StartedPostgreSqlContainer,
    store: ForumStore,
    forum: ForumRepository,
    settings: KeywordSettingsRepository,
    processor: ForumProcessor;
  let principal: { pk: number; id: string; extensionId: string };
  const previous = config.DATABASE_URL;
  beforeAll(async () => {
    container = await new PostgreSqlContainer('postgres:16-alpine').start();
    config.DATABASE_URL = container.getConnectionUri();
    const c = createDatabase(config.DATABASE_URL, true);
    try {
      await migrate(c.db, { migrationsFolder: path.resolve('drizzle') });
    } finally {
      await c.pool.end();
    }
    store = new ForumStore();
    forum = new ForumRepository();
    settings = new KeywordSettingsRepository();
    processor = new ForumProcessor(forum);
    const token = 'synthetic-process-token'.repeat(3),
      extension = 'a'.repeat(32);
    await store.register('processing', extension, token);
    principal = await store.authenticate({
      authorization: `Bearer ${token}`,
      'x-mention-extension': extension,
      origin: `chrome-extension://${extension}`,
    });
    await settings.importSnapshot({
      keyword_policy: policy,
      keyword_policy_token: 'initial',
      exclude_keywords: ['APL'],
    });
  }, 120000);
  afterAll(async () => {
    await store?.close();
    await forum?.close();
    await settings?.close();
    config.DATABASE_URL = previous;
    await container?.stop();
  });
  it('processes raw once after acceptance, preserving native IDs and ignoring Kakao-only exclusions', async () => {
    const raw = capture();
    const ack = await store.capture(principal, raw);
    expect(ack).toMatchObject({ accepted: true, matchStatus: 'pending' });
    expect(await forum.detail(raw.data.id)).toBeNull();
    expect(await processor.processOne()).toBe(true);
    expect((await forum.detail(raw.data.id))?.post).toMatchObject({
      id: raw.data.id,
      matched: true,
      keywords: ['APL'],
    });
    expect(await processor.processOne()).toBe(false);
    expect(await store.capture(principal, raw)).toEqual(ack);
    expect(await processor.processOne()).toBe(false);
  });
  it('keeps human notes, marks changed evidence stale, and rejects old guarded requests', async () => {
    const id = '9999999999999999999',
      option = (await forum.detail(id))?.evaluations?.[0];
    if (!option) throw Error('NO_OPTION');
    await forum.save({
      id,
      service: 'APL',
      verdict: 'positive',
      summary: '사람이 확인한 평가',
      expected: option.expected,
      request_id: randomUUID(),
      origin: 'human',
    });
    const human = (await forum.detail(id))?.evaluations?.[0];
    await store.capture(principal, capture('APL 운영은 변경된 후기입니다.'));
    await processor.processOne();
    const updated = (await forum.detail(id))?.evaluations?.[0];
    expect(updated).toMatchObject({
      label: 'positive',
      origin: 'human',
      summary: '사람이 확인한 평가',
      stale: true,
    });
    expect(updated?.expected).not.toBe(human?.expected);
    await expect(
      forum.save({
        id,
        service: 'APL',
        verdict: 'neutral',
        summary: '오래된 검토',
        expected: human?.expected ?? '',
        request_id: randomUUID(),
        origin: 'human',
      }),
    ).rejects.toThrow('맥락이 변경');
  });
  it('retains removed target reviews and all raw comments while limiting the public DTO to100', async () => {
    const id = '9999999999999999999';
    await store.capture(principal, capture('이번에는 관련 없는 본문', id));
    await processor.processOne();
    expect((await forum.detail(id))?.evaluations).toEqual([]);
    expect(
      await forum.db
        .select()
        .from(forumRetainedReviews)
        .where(eq(forumRetainedReviews.sourceId, id)),
    ).toHaveLength(1);
    const raw = {
      ...capture('다시 APL 후기', id),
      data: {
        ...capture('다시 APL 후기', id).data,
        comments: Array.from({ length: 101 }, (_, i) => ({
          id: String(i + 1),
          text: i === 100 ? 'APL 댓글' : '합성 댓글',
        })),
        expected_comments: 101,
      },
    };
    await store.capture(principal, raw);
    await processor.processOne();
    const detail = await forum.detail(id);
    expect(detail?.evaluations?.[0]).toMatchObject({
      origin: 'human',
      summary: '사람이 확인한 평가',
    });
    expect(detail?.comments).toHaveLength(100);
    expect(detail?.post).toMatchObject({ commentCount: 101, matchedComments: 1 });
    const [saved] = await forum.db
      .select()
      .from(collectorInbox)
      .where(eq(collectorInbox.eventId, raw.eventId));
    expect((saved?.payload.data as { comments: unknown[] }).comments).toHaveLength(101);
  });
  it('skips superseded captures without deleting their raw evidence', async () => {
    const id = '8888888888888888888';
    await store.capture(principal, capture('APL 이전 원문', id));
    await store.capture(principal, capture('APL 최신 원문', id));
    await processor.processOne();
    expect(await forum.detail(id)).toBeNull();
    await processor.processOne();
    expect((await forum.detail(id))?.body).toBe('APL 최신 원문');
  });
  it('orders multiple collectors by durable inbox identity rather than arrival timestamps', async () => {
    const id = '7777777777777777777',
      token = 'second-synthetic-token'.repeat(3),
      extension = 'b'.repeat(32);
    await store.register('second', extension, token);
    const second = await store.authenticate({
      authorization: `Bearer ${token}`,
      'x-mention-extension': extension,
      origin: `chrome-extension://${extension}`,
    });
    const firstCapture = capture('APL 먼저 저장된 원문', id);
    await store.capture(principal, firstCapture);
    await processor.processOne();
    const lastCapture = capture('APL 나중에 저장된 원문', id);
    await store.capture(second, lastCapture);
    // A server-clock adjustment must not roll the durable sequence backwards.
    await forum.db
      .update(collectorInbox)
      .set({ receivedAt: new Date(0) })
      .where(eq(collectorInbox.eventId, lastCapture.eventId));
    await processor.processOne();
    expect((await forum.detail(id))?.body).toBe('APL 나중에 저장된 원문');
  });
  it('resumes keyword reindex from PostgreSQL without losing removed human reviews', async () => {
    const value = await settings.read();
    await settings.save({
      keyword_policy: {
        ...policy,
        sources: { kakao: { disabled: [] }, pokergosu: { disabled: ['APL'] } },
      },
      keyword_policy_token: value.keyword_policy_token,
      exclude_keywords: [],
    });
    expect(await processor.hasPendingReindex()).toBe(true);
    expect(await processor.reindexOne()).toBe(true);
    // A fresh processor resumes the saved cursor rather than restarting or changing the host.
    const resumed = new ForumProcessor(forum);
    for (let i = 0; i < 20; i++) if (!(await resumed.reindexOne())) break;
    expect(await resumed.hasPendingReindex()).toBe(false);
    expect(await settings.forumProcessing()).toMatchObject({ state: 'completed' });
    expect(await settings.processing()).toMatchObject({ state: 'queued' });
    expect((await forum.detail('9999999999999999999'))?.post.matched).toBe(false);
    expect((await forum.detail('9999999999999999999'))?.evaluations).toEqual([]);
    await settings.save({
      keyword_policy: policy,
      keyword_policy_token: (await settings.read()).keyword_policy_token,
      exclude_keywords: [],
    });
    for (let i = 0; i < 20; i++) if (!(await resumed.reindexOne())) break;
    expect((await forum.detail('9999999999999999999'))?.evaluations?.[0]).toMatchObject({
      origin: 'human',
      summary: '사람이 확인한 평가',
    });
    expect(await resumed.hasPendingReindex()).toBe(false);
  });
  it('publishes finished summary counts from canonical cards after reindex', async () => {
    await forum.rebuildSummary();
    expect(await forum.summary()).toMatchObject({
      available: true,
      discovered: 3,
      collected: 3,
      matched: 3,
      pending: 0,
      comments: 101,
      keywords: ['APL'],
    });
  });
});
