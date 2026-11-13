import { createReadStream } from 'node:fs';
import { createInterface } from 'node:readline';
import { evidenceBundleSchema, projectionDatasetSchema } from '@app/shared';
import type { EvidenceRepository } from './evidence.repository.js';
/** Offline migration input only. No source process, socket, HTTP or write retries. */
export async function importEvidenceFile(
  filename: string,
  target: Pick<EvidenceRepository, 'importBundle' | 'publishMetadata' | 'importAudit'>,
  progress: (done: number, total: number) => void = () => {},
) {
  const stream = createReadStream(filename, { encoding: 'utf8' }),
    lines = createInterface({ input: stream, crlfDelay: Infinity });
  let dataset: ReturnType<typeof projectionDatasetSchema.parse> | undefined;
  const seen = new Set<string>();
  try {
    for await (const line of lines) {
      if (!line.trim()) continue;
      if (line.length > 32 * 1024 * 1024) throw Error('EVIDENCE_FILE_RECORD_TOO_LARGE');
      const record = JSON.parse(line) as {
        kind: unknown;
        dataset?: unknown;
        bundle?: unknown;
        source?: unknown;
        body?: unknown;
      };
      if (!dataset) {
        if (record.kind !== 'metadata') throw Error('EVIDENCE_FILE_HEADER_REQUIRED');
        dataset = projectionDatasetSchema.parse(record.dataset);
        continue;
      }
      if (record.kind === 'audit') {
        if (
          typeof record.source !== 'string' ||
          !record.body ||
          typeof record.body !== 'object' ||
          Array.isArray(record.body)
        )
          throw Error('INVALID_AUDIT_RECORD');
        await target.importAudit(record.source, record.body as Record<string, unknown>);
        continue;
      }
      if (record.kind !== 'bundle') throw Error('EVIDENCE_FILE_INVALID_RECORD');
      const bundle = evidenceBundleSchema.parse(record.bundle),
        id = bundle.detail.conversation.id;
      if (seen.has(id)) throw Error('EVIDENCE_FILE_DUPLICATE_ID');
      seen.add(id);
      await target.importBundle(bundle);
      progress(seen.size, dataset.conversations.length);
    }
    if (
      !dataset ||
      seen.size !== dataset.conversations.length ||
      dataset.conversations.some((c) => !seen.has(c.id))
    )
      throw Error('EVIDENCE_FILE_INCOMPLETE');
    await target.publishMetadata(dataset);
    return { conversations: seen.size, sourceCapturedAt: dataset.capturedAt };
  } finally {
    lines.close();
    stream.destroy();
  }
}
