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
