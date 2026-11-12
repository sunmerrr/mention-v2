import { monitoringListSchema, projectionDatasetSchema } from '@app/shared';
import { MonitoringRepository } from '../modules/monitoring/monitoring.repository.js';
import { loadEnv } from '../shared/config/load-env.js';

await loadEnv();
const { config } = await import('../shared/config/index.js');
// Repository module config is imported dynamically after environment loading.
const { ProjectionRepository } = await import('../modules/projection/projection.repository.js');
const { importProjection } = await import('../modules/projection/import-projection.js');
const source = new MonitoringRepository({
  origin: config.MENTION_SOURCE_URL,
  timeoutMs: config.MENTION_SOURCE_TIMEOUT_MS,
});
const target = new ProjectionRepository();
try {
  const result = await importProjection(
    source,
    target,
    projectionDatasetSchema,
    monitoringListSchema,
  );
  process.stdout.write(`${JSON.stringify(result)}\n`);
} catch {
  process.stderr.write(
    'Projection import failed. The previous active generation is preserved; no source data was changed.\n',
  );
  process.exitCode = 1;
} finally {
  await target.close();
}
