import { createReadStream } from 'node:fs';
import { createInterface } from 'node:readline';
import { z } from 'zod';
import { stableJson } from '../connection/stable-json.js';
import type { EvidenceRepository } from '../evidence/evidence.repository.js';

const table = z.enum([
  'threads',
  'revisions',
  'state',
  'thread_read_errors',
  'search_results',
  'control_commands',
  'control_events',
  'control_heartbeat',
  'control_owner',
]);
const counts = z.record(table, z.number().int().nonnegative());
/** An inert archive, never a queue import: old commands cannot execute from these rows. */
export async function importForumArchive(
  filename: string,
  target: Pick<EvidenceRepository, 'importAudit'>,
  onThread?: (row: Record<string, unknown>) => Promise<void>,
) {
  const stream = createReadStream(filename, { encoding: 'utf8' }),
    lines = createInterface({ input: stream, crlfDelay: Infinity });
  let expected: z.infer<typeof counts> | undefined;
  const found: Record<string, number> = {},
    identities = new Set<string>();
  try {
    for await (const line of lines) {
      if (!line.trim()) continue;
      if (line.length > 32 * 1024 * 1024) throw Error('FORUM_ARCHIVE_RECORD_TOO_LARGE');
      const raw = JSON.parse(line);
      if (!expected) {
        const header = z
          .object({
            kind: z.literal('forum-archive'),
            version: z.literal(1),
            capturedAt: z.iso.datetime(),
            counts,
          })
          .parse(raw);
        expected = header.counts;
        continue;
      }
      const value = z.object({ table, row: z.record(z.string(), z.unknown()) }).parse(raw);
      const identity = stableJson(value);
      if (identities.has(identity)) throw Error('FORUM_ARCHIVE_DUPLICATE_ROW');
      identities.add(identity);
      found[value.table] = (found[value.table] ?? 0) + 1;
      await target.importAudit('forum-source', value);
      if (value.table === 'threads') await onThread?.(value.row);
    }
    if (!expected || Object.entries(expected).some(([t, n]) => (found[t] ?? 0) !== n))
      throw Error('FORUM_ARCHIVE_INCOMPLETE');
    return { rows: identities.size, counts: found };
  } finally {
    lines.close();
    stream.destroy();
  }
}
