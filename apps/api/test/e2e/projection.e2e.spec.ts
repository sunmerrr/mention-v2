import path from 'node:path';
import { listSchema } from '@app/shared/monitoring/contracts/api';
import { summarize } from '@app/shared/monitoring/domain/model';
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createDatabase } from '../../src/db/client.js';
import { ProjectionRepository } from '../../src/modules/projection/projection.repository.js';
import { config } from '../../src/shared/config/index.js';
import { SystemErrorService } from '../../src/shared/services/system-error.service.js';
import { fixture } from '../fixtures/monitoring.js';

describe('PostgreSQL projection on a disposable real database', () => {
  let container: StartedPostgreSqlContainer, projection: ProjectionRepository;
  const prior = config.DATABASE_URL;
  const dataset = fixture();
  const ordered = [...dataset.conversations].sort(
    (a, b) => b.at - a.at || b.id.localeCompare(a.id),
  );
  beforeAll(async () => {
    container = await new PostgreSqlContainer('postgres:16-alpine').start();
    config.DATABASE_URL = container.getConnectionUri();
    const connection = createDatabase(config.DATABASE_URL, true);
    try {
      await migrate(connection.db, { migrationsFolder: path.resolve('drizzle') });
    } finally {
      await connection.pool.end();
    }
    projection = new ProjectionRepository();
    await projection.replace(dataset);
  }, 120000);
  afterAll(async () => {
    await projection?.close();
    config.DATABASE_URL = prior;
    await container?.stop();
  });
  it('keeps native evidence and target summaries while storing UTC timestamps', async () => {
    const page = await projection.list(listSchema.parse({ limit: 50 }));
    expect(page.items).toEqual(ordered);
    expect(page.total).toBe(dataset.conversations.length);
    const overview = await projection.overview({ day: '', target: '' });
    expect(overview.overview).toEqual(summarize(dataset, { day: '', target: '' }));
    const connection = createDatabase(config.DATABASE_URL ?? '');
    try {
      const result = await connection.pool.query('SHOW TimeZone');
      expect(result.rows[0].TimeZone).toBe('UTC');
      expect((await connection.pool.query('SHOW jit')).rows[0].jit).toBe('off');
    } finally {
      await connection.pool.end();
    }
  });
  it('traverses tied timestamps without gaps and binds cursor to its filter', async () => {
    const ids: string[] = [];
    let cursor: string | undefined;
    do {
      const page = await projection.list(listSchema.parse({ limit: 4, cursor }));
      ids.push(...page.items.map((item) => item.id));
      cursor = page.nextCursor || undefined;
    } while (cursor);
    expect(ids).toHaveLength(dataset.conversations.length);
    expect(new Set(ids).size).toBe(ids.length);
    const first = await projection.list(listSchema.parse({ limit: 4 }));
    await expect(
      projection.list(listSchema.parse({ cursor: first.nextCursor, target: '샘플 A' })),
    ).rejects.toMatchObject({ code: 'INVALID_CURSOR' });
  });
  it('filters target-specific sentiment and preserves previous generation on a failed import', async () => {
    const page = await projection.list(listSchema.parse({ target: '샘플 A', label: 'negative' }));
    expect(page.items.every((item) => item.evaluations['샘플 A']?.label === 'negative')).toBe(true);
    const repeated = {
      ...dataset,
      conversations: [...dataset.conversations, ...dataset.conversations.slice(0, 1)],
    };
    await expect(projection.replace(repeated)).rejects.toThrow();
    const after = await projection.list(listSchema.parse({ limit: 50 }));
    expect(after.total).toBe(dataset.conversations.length);
    expect(after.items).toEqual(ordered);
  });
  it('persists complete failure causes and redacts SQL parameter values and query strings', async () => {
    const errors = new SystemErrorService();
    let failure = new Error('reason at depth eight');
    for (let index = 7; index >= 0; index--) {
      failure = new Error(`stage ${index}`, { cause: failure });
    }
    errors.log(
      'http-5xx',
      new Error('database write failed\nparams: SYNTHETIC_PRIVATE_TEXT\nsecond line', {
        cause: failure,
      }),
      {
        method: 'GET',
        url: '/api/v1/monitoring/conversations?search=SYNTHETIC_PRIVATE_TEXT',
        statusCode: 503,
      },
    );
    await errors.onApplicationShutdown();
    const connection = createDatabase(config.DATABASE_URL ?? '');
    try {
      const rows = await connection.pool.query(
        'SELECT source, kind, payload, metadata FROM system_error_logs',
      );
      expect(rows.rows).toHaveLength(1);
      expect(JSON.stringify(rows.rows)).not.toContain('SYNTHETIC_PRIVATE_TEXT');
      expect(JSON.stringify(rows.rows[0].payload)).toContain('reason at depth eight');
      expect(rows.rows[0].payload.stack).toContain('projection.e2e.spec.ts');
      expect(rows.rows[0].metadata).toEqual({
        method: 'GET',
        route: '/api/v1/monitoring/conversations',
        statusCode: 503,
      });
    } finally {
      await connection.pool.end();
    }
  });
  it('allows only one scheduled producer lease at a time', async () => {
    const first = await projection.producerSession();
    try {
      await expect(projection.producerSession()).rejects.toThrow('Another projection producer');
    } finally {
      await first.query('SELECT pg_advisory_unlock(271812, 2)');
      first.release(true);
    }
    const replacement = await projection.producerSession();
    replacement.release(true);
  });
});
