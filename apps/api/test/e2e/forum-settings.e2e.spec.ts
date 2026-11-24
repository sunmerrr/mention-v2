import { createHash, randomUUID } from 'node:crypto';
import path from 'node:path';
import { PokergosuQueries } from '@app/shared/monitoring/application/pokergosu';
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createDatabase } from '../../src/db/client.js';
import { AssetRepository } from '../../src/modules/assets/asset.repository.js';
import { ForumRepository } from '../../src/modules/forum/forum.repository.js';
import { ForumMedia } from '../../src/modules/forum/forum-media.service.js';
import { KeywordSettingsRepository } from '../../src/modules/settings/keyword-settings.repository.js';
import { config } from '../../src/shared/config/index.js';

const policy = {
  version: 1,
  keywords: ['APL', '에이피엘'],
  keyword_groups: [{ id: 'apl', name: 'APL', kind: 'event', keywords: ['APL', '에이피엘'] }],
  sources: { kakao: { disabled: [] }, pokergosu: { disabled: [] } },
};
const migratedExclusions = [
  '정모 [숫자]회차',
  ...Array.from({ length: 211 }, (_, index) => `기존 광고 제외 ${index}`),
];
const post = (id: string, title = '합성 APL 대회 후기') => ({
  post: {
    id,
    url: `https://www.pokergosu.com/free/${id}`,
    title,
    author: '합성',
    publishedAt: '2026-11-13 12:00:00',
    checkedAt: 1794538800000.125,
    excerpt: '합성 본문',
    keywords: ['APL'],
    matched: true,
    commentCount: 0,
    matchedComments: 0,
    imageCount: 0,
  },
  body: '합성 본문 100% 완료',
  images: [],
  imagesSkipped: 0,
  comments: [],
  commentsLimited: false,
  coverage: 'visible-complete',
  reportedComments: 0,
  skippedComments: 0,
  unavailableComments: 0,
  evaluations: [
    {
      id: `${id}:apl`,
      conversationId: id,
      targetId: 'apl',
      target: 'APL',
      label: 'positive',
      summary: '운영이 편리하다는 합성 평가',
      origin: 'human',
      stale: false,
      expected: 'a'.repeat(64),
      room: '합성 게시판',
      at: 1794538800000.125,
      history: [],
    },
  ],
});
describe('PostgreSQL source policies and prepared forum reads', () => {
  let container: StartedPostgreSqlContainer,
    settings: KeywordSettingsRepository,
    forum: ForumRepository,
    assets: AssetRepository;
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
    settings = new KeywordSettingsRepository();
    forum = new ForumRepository();
    assets = new AssetRepository();
    await settings.importSnapshot({
      keyword_policy: policy,
      keyword_policy_token: 'legacy-token',
      exclude_keywords: migratedExclusions,
      keyword_policy_supported: true,
    });
  }, 120000);
  afterAll(async () => {
    await settings?.close();
    await forum?.close();
    await assets?.close();
    config.DATABASE_URL = previous;
    await container?.stop();
  });
  it('keeps alias scopes independent and validates the Korean-suffixed APL example', async () => {
    expect((await settings.read()).exclude_keywords).toEqual(migratedExclusions);
    expect((await settings.policy()).policy.sources.pokergosu.disabled).toEqual([]);
    expect(
      await settings.check({
        sample: 'Kk 대회권 apl줌?',
        keywords: ['APL'],
        keyword_groups: [{ id: 'apl', name: 'APL', kind: 'event', keywords: ['APL'] }],
      }),
    ).toMatchObject({ save: true, matched: ['APL'], targets: ['APL'] });
    expect(
      await settings.check({ sample: 'APL 정모 22회차', exclude_keywords: ['정모 [숫자]회차'] }),
    ).toMatchObject({ save: false, excluded: ['정모 [숫자]회차'] });
  });
  it('commits a setting revision and durable job without inline processing, then rejects stale saves', async () => {
    const next = {
      ...policy,
      sources: { kakao: { disabled: [] }, pokergosu: { disabled: ['APL'] } },
    };
    expect(
      await settings.save({
        keyword_policy: next,
        keyword_policy_token: 'legacy-token',
        exclude_keywords: [],
      }),
    ).toMatchObject({ ok: true, processing: { state: 'queued', revision: 1 } });
    expect((await settings.policy()).policy.sources.kakao.disabled).toEqual([]);
    expect((await settings.policy()).policy.sources.pokergosu.disabled).toEqual(['APL']);
    expect(await settings.processing()).toMatchObject({ state: 'queued', updated: 0 });
    await expect(
      settings.save({
        keyword_policy: next,
        keyword_policy_token: 'legacy-token',
        exclude_keywords: [],
      }),
    ).rejects.toThrow('다른 곳에서');
    await expect(
      settings.importSnapshot({
        keyword_policy: policy,
        keyword_policy_token: 'overwrite',
        exclude_keywords: [],
      }),
    ).rejects.toThrow('덮어쓸');
  });
  it('paginates exact19-digit native IDs and treats search characters literally', async () => {
    await forum.importDetail(post('9999999999999999997'));
    await forum.importDetail(post('9999999999999999998'));
    await forum.importSummary({
      available: true,
      discovered: 2,
      collected: 2,
      matched: 2,
      pending: 0,
      readErrors: 0,
      comments: 0,
      keywords: ['APL'],
      lastCheckedAt: 1794538800000,
      monitor: null,
    });
    const queries = new PokergosuQueries(forum),
      input = { q: '', keyword: 'APL', day: '', match: 'matched' as const, limit: 1 };
    const first = await queries.list(input);
    expect(first.items[0]?.id).toBe('9999999999999999998');
    await forum.importDetail(post('9999999999999999999', '새로 수집된 합성'));
    const second = await queries.list({ ...input, cursor: first.nextCursor ?? undefined });
    expect(second.items.map((p) => p.id)).toEqual(['9999999999999999997']);
    expect(second.total).toBe(2);
    await expect(
      queries.list({ ...input, keyword: '에이피엘', cursor: first.nextCursor ?? undefined }),
    ).rejects.toThrow('필터가 변경');
    expect((await queries.list({ ...input, q: '100%', limit: 20 })).items).toHaveLength(3);
    expect((await queries.list({ ...input, q: "%' OR true --", limit: 20 })).items).toHaveLength(0);
    expect((await forum.detail('9999999999999999997'))?.evaluations?.[0]?.expected).toBe(
      'a'.repeat(64),
    );
  });
  it('serves opinion scopes only after worker materialization, and handles an empty date', async () => {
    await expect(forum.opinions({ day: '', target: '' })).rejects.toThrow('집계가 완료');
    await forum.rebuildOpinions([{ id: 'apl', name: 'APL' }]);
    const summary = await forum.opinions({ day: '', target: 'APL' });
    expect(summary.units).toBe(3);
    expect(summary.targets[0]?.counts.positive).toBe(3);
    expect((await forum.opinions({ day: '2020-01-01', target: 'APL' })).units).toBe(0);
  });
  it('edits forum labels and notes atomically while preserving human priority and receipts', async () => {
    const id = '9999999999999999997',
      request = {
        id,
        service: 'APL',
        verdict: 'neutral' as const,
        summary: '사람이 수정한 메모',
        expected: 'a'.repeat(64),
        request_id: randomUUID(),
        origin: 'human' as const,
      };
    expect(await forum.save(request)).toMatchObject({ saved: true });
    expect(await forum.save(request)).toMatchObject({ saved: true });
    const option = (await forum.detail(id))?.evaluations?.[0];
    if (!option) throw Error('MISSING_OPTION');
    expect(option).toMatchObject({
      label: 'neutral',
      summary: request.summary,
      origin: 'human',
      stale: false,
    });
    expect(option.history).toHaveLength(1);
    await expect(forum.save({ ...request, summary: '다른 내용' })).rejects.toThrow('같은 요청 ID');
    await expect(forum.save({ ...request, request_id: randomUUID() })).rejects.toThrow(
      '맥락이 변경',
    );
    await expect(
      forum.save({ ...request, request_id: randomUUID(), origin: 'ai', expected: option.expected }),
    ).rejects.toThrow('사람이 수정');
    await expect(forum.importDetail(post(id))).rejects.toThrow('덮어쓸');
  });
  it('queues only retained image references and serves validated cached bytes after worker processing', async () => {
    const id = '7777777777777777777',
      url = 'https://www.pokergosu.com/files/synthetic.png',
      key = createHash('sha256').update(url).digest('hex');
    const detail = {
      ...post(id),
      images: [{ key, url, alt: '합성', width: 1, height: 1, state: 'not_cached' }],
    };
    await forum.importDetail(detail);
    const media = new ForumMedia(forum, assets);
    await expect(media.request(id, 'f'.repeat(64))).rejects.toThrow('이미지 참조');
    expect(await media.request(id, key)).toMatchObject({ state: 'not_cached' });
    const bytes = Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aOZQAAAAASUVORK5CYII=',
      'base64',
    );
    let reads = 0;
    expect(
      await media.processOne(async (requested) => {
        expect(requested).toBe(url);
        reads++;
        return bytes;
      }),
    ).toBe(true);
    expect((await media.file(key))?.bytes.equals(bytes)).toBe(true);
    expect(await media.request(id, key)).toMatchObject({ state: 'cached' });
    expect(
      await media.processOne(async () => {
        reads++;
        return bytes;
      }),
    ).toBe(false);
    expect(reads).toBe(1);
    await expect(
      assets.importImage('e'.repeat(64), Buffer.from('<svg onload=alert(1)>')),
    ).rejects.toThrow('UNSUPPORTED_IMAGE_BYTES');
  });
});
