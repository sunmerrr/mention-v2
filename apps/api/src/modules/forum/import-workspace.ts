import { createReadStream } from 'node:fs';
import { createInterface } from 'node:readline';
import {
  pokergosuDetailSchema,
  pokergosuSummarySchema,
} from '@app/shared/monitoring/contracts/pokergosu';
import { z } from 'zod';
import type { AssetRepository } from '../assets/asset.repository.js';
import type { EvidenceRepository } from '../evidence/evidence.repository.js';
import type { KeywordSettingsRepository } from '../settings/keyword-settings.repository.js';
import type { ForumRepository } from './forum.repository.js';
/** Bounded offline migration records; never opens the legacy DB or sends a request. */
export async function importWorkspace(
  filename: string,
  settings: KeywordSettingsRepository,
  forum: ForumRepository,
  audit: EvidenceRepository,
  assets: AssetRepository,
) {
  const stream = createReadStream(filename, { encoding: 'utf8' }),
    lines = createInterface({ input: stream, crlfDelay: Infinity });
  let initialized = false,
    summary: ReturnType<typeof pokergosuSummarySchema.parse> | undefined,
    expected: number | undefined;
  const ids = new Set<string>();
  let audits = 0,
    receipts = 0,
    images = 0;
  try {
    for await (const line of lines) {
      if (!line.trim()) continue;
      if (line.length > 32 * 1024 * 1024) throw Error('WORKSPACE_RECORD_TOO_LARGE');
      const record = z
        .object({ kind: z.string(), value: z.unknown(), source: z.string().optional() })
        .parse(JSON.parse(line));
      if (!initialized) {
        if (record.kind !== 'keywords') throw Error('WORKSPACE_KEYWORDS_REQUIRED');
        await settings.importSnapshot(z.record(z.string(), z.unknown()).parse(record.value));
        initialized = true;
        continue;
      }
      if (record.kind === 'forum-post') {
        const detail = pokergosuDetailSchema.parse(record.value);
        if (ids.has(detail.post.id)) throw Error('WORKSPACE_DUPLICATE_POST');
        ids.add(detail.post.id);
        await forum.importDetail(detail);
      } else if (record.kind === 'forum-summary') {
        if (summary) throw Error('WORKSPACE_DUPLICATE_SUMMARY');
        summary = pokergosuSummarySchema.parse(record.value);
        expected = summary.collected;
      } else if (record.kind === 'forum-media') {
        const image = z
          .object({
            key: z.string().regex(/^[a-f0-9]{64}$/),
            bytes: z.string().max(7 * 1024 * 1024),
          })
          .parse(record.value);
        await assets.importImage(image.key, Buffer.from(image.bytes, 'base64'));
        images++;
      } else if (record.kind === 'forum-receipt') {
        await forum.importReviewReceipt(record.value);
        receipts++;
      } else if (record.kind === 'audit') {
        if (!record.source) throw Error('WORKSPACE_AUDIT_SOURCE_REQUIRED');
        await audit.importAudit(
          record.source,
          z.record(z.string(), z.unknown()).parse(record.value),
        );
        audits++;
      } else throw Error('INVALID_WORKSPACE_RECORD');
    }
    if (!initialized || !summary || ids.size !== expected)
      throw Error('WORKSPACE_IMPORT_INCOMPLETE');
    await forum.importSummary(summary);
    const { policy } = await settings.policy();
    await forum.rebuildOpinions(policy.keyword_groups);
    return { posts: ids.size, audits, receipts, images };
  } finally {
    lines.close();
    stream.destroy();
  }
}
