import { evidenceBundleSchema } from '@app/shared';
import { stableJson } from '../connection/stable-json.js';
import type { MonitoringRepository } from '../monitoring/monitoring.repository.js';
import { readSourceDataset } from '../projection/import-projection.js';
import type { EvidenceRepository } from './evidence.repository.js';
import { reconcileLegacyEvidence } from './reconcile-legacy-evidence.js';
/** One-shot import uses GET only. The live owner and source writer are untouched. */
export async function importEvidence(
  source: Pick<MonitoringRepository, 'read'>,
  target: Pick<EvidenceRepository, 'importBundle' | 'publishMetadata'>,
  progress: (done: number, total: number) => void = () => {},
) {
  const dataset = await readSourceDataset(source);
  let done = 0;
  for (const conversation of dataset.conversations) {
    let bundle: ReturnType<typeof evidenceBundleSchema.parse> | undefined;
    // Only repeat reads on an evidence race. No mutation is ever retried here.
    for (let attempt = 0; attempt < 3; attempt++) {
      const before = await source.read(
        `/api/conversations/${encodeURIComponent(conversation.id)}/classifications`,
      );
      const detail = await source.read(`/api/conversations/${encodeURIComponent(conversation.id)}`);
      const classifications = await source.read(
        `/api/conversations/${encodeURIComponent(conversation.id)}/classifications`,
      );
      if (stableJson(before) !== stableJson(classifications)) continue;
      const parsed = evidenceBundleSchema.safeParse(
        reconcileLegacyEvidence(detail, classifications),
      );
      if (parsed.success) {
        bundle = parsed.data;
        break;
      }
    }
    if (!bundle) throw Error('SOURCE_EVIDENCE_UNSTABLE');
    await target.importBundle(bundle);
    progress(++done, dataset.conversations.length);
  }
  await target.publishMetadata(dataset);
  return { conversations: done, sourceCapturedAt: dataset.capturedAt };
}
