import { Worker } from 'node:worker_threads';
import type { Dataset, Overview } from '@app/shared/monitoring/domain/model';
export type PreparedSummary = { day: string; target: string; body: Overview };
/** CPU work must never block health, page requests or mutation acknowledgements. */
export async function aggregate(dataset: Dataset): Promise<PreparedSummary[]> {
  const extension = import.meta.url.endsWith('.ts') ? 'ts' : 'js';
  const worker = new Worker(new URL(`./aggregate-worker.${extension}`, import.meta.url), {
    workerData: dataset,
  });
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await new Promise<PreparedSummary[]>((resolve, reject) => {
      timer = setTimeout(
        () => reject(new Error('Projection aggregation deadline exceeded')),
        60000,
      );
      worker.once('message', resolve);
      worker.once('error', reject);
      worker.once('exit', (code) => {
        if (code !== 0) reject(new Error('Projection aggregation stopped'));
      });
    });
  } finally {
    clearTimeout(timer);
    await worker.terminate();
  }
}
