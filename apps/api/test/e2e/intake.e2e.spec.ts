import path from 'node:path';
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createDatabase } from '../../src/db/client.js';
import { IntakeStore } from '../../src/modules/connection/intake-store.js';
import type { OwnerReply } from '../../src/modules/connection/owner-client.js';
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
      events: [{ chat_id: '18497500347065223', log_id: '3970073012646000642', text: '합성 원문' }],
      next_cursor: cursor,
      gap: false,
    },
    cache: {
      logs: [
        [
          '18497500347065223',
          '3970073012646000642',
          { logId: '3970073012646000642', message: '합성 원문' },
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
});
