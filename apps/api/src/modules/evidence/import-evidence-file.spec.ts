import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { importEvidenceFile } from './import-evidence-file.js';

let directory: string;
beforeEach(async () => {
  directory = await mkdtemp(path.resolve('../../.dev/tmp/evidence-file-test-'));
});
afterEach(async () => {
  await rm(directory, { recursive: true, force: true });
});
const metadata = {
  conversations: [],
  targets: [],
  capturedAt: '2026-11-13T07:00:00.000Z',
  source: 'synthetic',
  collectionState: 'synthetic',
  gaps: 0,
};
const target = () => ({
  importBundle: vi.fn(async () => ({})),
  importAudit: vi.fn(async () => {}),
  publishMetadata: vi.fn(async () => {}),
});
it('imports original uncertain receipts without treating them as executable tasks', async () => {
  const file = path.join(directory, 'snapshot.jsonl');
  await writeFile(
    file,
    [
      { kind: 'metadata', dataset: metadata },
      {
        kind: 'audit',
        source: 'judgment-decisions',
        body: { request_id: 'synthetic-request', state: 'unknown' },
      },
    ]
      .map((x) => JSON.stringify(x))
      .join('\n'),
  );
  const store = target();
  expect(await importEvidenceFile(file, store)).toMatchObject({ conversations: 0 });
  expect(store.importAudit).toHaveBeenCalledWith('judgment-decisions', {
    request_id: 'synthetic-request',
    state: 'unknown',
  });
  expect(store.importBundle).not.toHaveBeenCalled();
  expect(store.publishMetadata).toHaveBeenCalledOnce();
});
it('never publishes incomplete or duplicate snapshot headers', async () => {
  const file = path.join(directory, 'snapshot.jsonl'),
    store = target();
  const conversation = {
    id: 'missing',
    room: '합성',
    at: 1794538800000,
    title: '합성',
    targets: [],
    evaluations: {},
    keywords: {},
    messageCount: 0,
  };
  await writeFile(
    file,
    JSON.stringify({ kind: 'metadata', dataset: { ...metadata, conversations: [conversation] } }),
  );
  await expect(importEvidenceFile(file, store)).rejects.toThrow('INCOMPLETE');
  expect(store.publishMetadata).not.toHaveBeenCalled();
  await writeFile(
    file,
    [
      { kind: 'metadata', dataset: metadata },
      { kind: 'metadata', dataset: metadata },
    ]
      .map((x) => JSON.stringify(x))
      .join('\n'),
  );
  await expect(importEvidenceFile(file, store)).rejects.toThrow('INVALID_RECORD');
  expect(store.publishMetadata).not.toHaveBeenCalled();
});
