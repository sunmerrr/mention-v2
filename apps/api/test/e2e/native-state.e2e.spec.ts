import { randomUUID } from 'node:crypto';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
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
