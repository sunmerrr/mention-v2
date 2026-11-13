import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { importForumArchive } from './import-forum-archive.js';

const header = {
  kind: 'forum-archive',
  version: 1,
  capturedAt: '2026-11-13T00:00:00.000Z',
  counts: {
    threads: 1,
    revisions: 0,
    state: 0,
    thread_read_errors: 0,
    search_results: 0,
    control_commands: 1,
    control_events: 0,
    control_heartbeat: 0,
    control_owner: 0,
  },
};
async function withFile(rows: unknown[], run: (filename: string) => Promise<void>) {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'mention-forum-archive-'));
  try {
    const file = path.join(dir, 'snapshot.jsonl');
    await writeFile(file, rows.map((v) => JSON.stringify(v)).join('\n'), { mode: 0o600 });
    await run(file);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}
describe('inert legacy forum archive', () => {
  it('retains raw payload and uncertain command without turning either into executable work', async () => {
    const records = [
      {
        table: 'threads',
        row: { id: '9999999999999999999', payload: '{"comments":[]}', checked_at: 123.456 },
      },
      {
        table: 'control_commands',
        row: { id: 'original-command', state: 'unknown', payload: '{"operation":"monitor"}' },
      },
    ];
    await withFile([header, ...records], async (file) => {
      const retained: unknown[] = [];
      const result = await importForumArchive(file, {
        async importAudit(source, body) {
          retained.push({ source, body });
        },
      });
      expect(result.rows).toBe(2);
      expect(retained).toEqual(records.map((body) => ({ source: 'forum-source', body })));
      expect(retained.every((v) => !Object.hasOwn(v as object, 'request_id'))).toBe(true);
    });
  });
  it('rejects an incomplete snapshot and duplicate raw rows', async () => {
    const row = { table: 'threads', row: { id: '1' } };
    const target = { async importAudit() {} };
    await withFile([header, row], async (file) => {
      await expect(importForumArchive(file, target)).rejects.toThrow('INCOMPLETE');
    });
    await withFile([header, row, row], async (file) => {
      await expect(importForumArchive(file, target)).rejects.toThrow('DUPLICATE');
    });
  });
  it('does not accept an arbitrary table or a headerless stream', async () => {
    const target = { async importAudit() {} };
    await withFile([header, { table: 'credentials', row: {} }], async (file) => {
      await expect(importForumArchive(file, target)).rejects.toThrow();
    });
    await withFile([{ table: 'threads', row: { id: '1' } }], async (file) => {
      await expect(importForumArchive(file, target)).rejects.toThrow();
    });
  });
});
