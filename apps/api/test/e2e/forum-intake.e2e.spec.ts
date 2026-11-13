import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { Test } from '@nestjs/testing';
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { eq } from 'drizzle-orm';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createDatabase } from '../../src/db/client.js';
import { collectorCommands } from '../../src/db/schema.js';
import { ForumControl } from '../../src/modules/forum-intake/forum-control.js';
import { ForumController } from '../../src/modules/forum-intake/forum-controller.js';
import { ForumStore } from '../../src/modules/forum-intake/forum-store.js';
import { config } from '../../src/shared/config/index.js';
import { ResponseInterceptor } from '../../src/shared/interceptors/response.interceptor.js';

const extension = 'a'.repeat(32),
  token = 'syntheticcollector'.repeat(3);
const headers = {
  authorization: `Bearer ${token}`,
  'x-mention-extension': extension,
  origin: `chrome-extension://${extension}`,
};
const base = '/collector/pokergosu/v1';
const capture = () => ({
  eventId: randomUUID(),
  operation: 'thread',
  page_url: 'https://www.pokergosu.com/free/9999999999999999999',
  capturedAt: '2026-11-13T07:00:00.000Z',
  data: {
    id: '9999999999999999999',
    url: 'https://www.pokergosu.com/free/9999999999999999999',
    title: '합성 APL 없는 원문',
    body: '포함 키워드가 없어도 저장할 합성 본문',
    author: '',
    published_at: null,
    comments: [],
    images: [],
    comment_coverage: 'visible-complete',
    expected_comments: 0,
    unavailable_comments: 0,
    skipped_comments: [],
  },
});
describe('independent flat forum intake on PostgreSQL', () => {
  let container: StartedPostgreSqlContainer, store: ForumStore, app: NestFastifyApplication;
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
    store = new ForumStore();
    await store.register('synthetic', extension, token);
    const module = await Test.createTestingModule({
      controllers: [ForumController],
      providers: [{ provide: ForumStore, useValue: store }],
    }).compile();
    app = module.createNestApplication<NestFastifyApplication>(new FastifyAdapter());
    app.useGlobalInterceptors(new ResponseInterceptor());
    await app.init();
    await app.getHttpAdapter().getInstance().ready();
  }, 120000);
  afterAll(async () => {
    await app?.close();
    await store?.close();
    config.DATABASE_URL = prior;
    await container?.stop();
  });
  it('authenticates collector identity and returns flat status without web settings', async () => {
    const denied = await app.inject({ method: 'GET', url: `${base}/status` });
    expect(denied.statusCode).toBe(403);
    const response = await app.inject({ method: 'GET', url: `${base}/status`, headers });
    expect(response.json()).toMatchObject({
      protocolVersion: 1,
      threads: 0,
      matched: 0,
      collectorId: 'synthetic',
    });
    expect(response.json().success).toBeUndefined();
    expect(
      (
        await app.inject({
          method: 'GET',
          url: `${base}/status`,
          headers: { ...headers, 'x-mention-extension': 'b'.repeat(32) },
        })
      ).statusCode,
    ).toBe(403);
  });
  it('durably accepts exact decimal identity and raw content while matching is pending', async () => {
    const input = capture();
    const response = await app.inject({
      method: 'POST',
      url: `${base}/capture`,
      headers,
      payload: input,
    });
    expect(response.statusCode).toBe(201);
    const ack = response.json();
    expect(ack).toMatchObject({ saved: true, accepted: true, matchStatus: 'pending', comments: 0 });
    expect(ack.eligible).toBeUndefined();
    expect(ack.success).toBeUndefined();
    const duplicate = await app.inject({
      method: 'POST',
      url: `${base}/capture`,
      headers,
      payload: input,
    });
    expect(duplicate.json()).toEqual(ack);
    const conflict = await app.inject({
      method: 'POST',
      url: `${base}/capture`,
      headers,
      payload: { ...input, data: { ...input.data, body: '다른 내용' } },
    });
    expect(conflict.statusCode).toBe(409);
    const c = createDatabase(config.DATABASE_URL ?? '');
    try {
      const result = await c.pool.query('SELECT native_id FROM forum_threads');
      expect(result.rows[0].native_id).toBe('9999999999999999999');
      expect(
        (await c.pool.query('SELECT payload FROM collector_inbox')).rows[0].payload.data.body,
      ).toBe(input.data.body);
    } finally {
      await c.pool.end();
    }
  });
  it('bounds discovery and preserves pinned evidence and excludes unobserved search IDs', async () => {
    const url = 'https://www.pokergosu.com/free/search?s=1&v=APL';
    const list = {
      eventId: randomUUID(),
      operation: 'list',
      page_url: url,
      data: [{ id: '99', url: 'https://www.pokergosu.com/free/99', pinned: true }],
    };
    expect(
      (await app.inject({ method: 'POST', url: `${base}/capture`, headers, payload: list }))
        .statusCode,
    ).toBe(201);
    const plan = await app.inject({
      method: 'POST',
      url: `${base}/search/plan`,
      headers,
      payload: { url, ids: ['99', '100'] },
    });
    expect(plan.json().queue).toEqual([{ id: '99', url: 'https://www.pokergosu.com/free/99' }]);
    const c = createDatabase(config.DATABASE_URL ?? '');
    try {
      expect(
        (await c.pool.query("SELECT pinned FROM forum_threads WHERE native_id='99'")).rows[0]
          .pinned,
      ).toBe(true);
    } finally {
      await c.pool.end();
    }
  });
  it('rejects invalid coverage and malformed source URLs instead of claiming acceptance', async () => {
    const input = capture();
    const invalid = { ...input, data: { ...input.data, expected_comments: 4 } };
    expect(
      (await app.inject({ method: 'POST', url: `${base}/capture`, headers, payload: invalid }))
        .statusCode,
    ).toBe(400);
    expect(
      (
        await app.inject({
          method: 'POST',
          url: `${base}/capture`,
          headers,
          payload: { ...input, page_url: 'https://evil.invalid/free/1' },
        })
      ).statusCode,
    ).toBe(400);
  });
  it('leases commands once, scopes owners and retains late receipts without replay', async () => {
    const principal = await store.authenticate(headers);
    const control = new ForumControl(store);
    const command = await control.enqueue(principal, { action: 'stop' });
    expect(command).toBeDefined();
    if (!command) throw Error('COMMAND_NOT_CREATED');
    const client = { instance: randomUUID(), version: '0.7.0', permission: true, enabled: true };
    const first = await control.poll(principal, client);
    expect(first).toMatchObject({ state: 'LEASED', command: { id: command.id, action: 'stop' } });
    expect(await control.poll(principal, client)).toMatchObject({
      state: 'COMMAND_IN_FLIGHT',
      command: null,
    });
    expect(await control.poll(principal, { ...client, instance: randomUUID() })).toMatchObject({
      state: 'ANOTHER_CLIENT_CONNECTED',
      command: null,
    });
    await store.db
      .update(collectorCommands)
      .set({ expiresAt: new Date(0) })
      .where(eq(collectorCommands.id, command.id));
    expect(await control.poll(principal, client)).toMatchObject({ state: 'IDLE', command: null });
    const receipt = {
      instance: client.instance,
      id: command.id,
      result: { ok: true, code: 'STOPPED' },
    };
    expect(await control.ack(principal, receipt)).toEqual({ acknowledged: true });
    expect(await control.ack(principal, receipt)).toEqual({ acknowledged: true });
    await expect(
      control.ack(principal, { ...receipt, result: { ok: false, code: 'ERROR' } }),
    ).rejects.toThrow('CONFLICT');
    await expect(control.ack(principal, { ...receipt, instance: randomUUID() })).rejects.toThrow(
      'OWNER',
    );
  });
});
