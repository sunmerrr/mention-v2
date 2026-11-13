import { afterEach, expect, it } from 'vitest';
import { config } from '../../shared/config/index.js';
import type { EvidenceRepository } from '../evidence/evidence.repository.js';
import type { MonitoringRepository } from '../monitoring/monitoring.repository.js';
import type { ProjectionRepository } from './projection.repository.js';
import { ProjectionSync } from './projection-sync.service.js';

const prior = { backend: config.MONITORING_READ_BACKEND, once: config.WORKER_RUN_ONCE };
afterEach(() => {
  config.MONITORING_READ_BACKEND = prior.backend;
  config.WORKER_RUN_ONCE = prior.once;
});
function service() {
  return new ProjectionSync(
    {
      read: async () => {
        throw Error('synthetic-source-unavailable');
      },
    } as unknown as MonitoringRepository,
    {} as ProjectionRepository,
    {} as EvidenceRepository,
  );
}
it('a cron one-shot fails instead of reporting success when projection import fails', async () => {
  config.MONITORING_READ_BACKEND = 'postgres';
  config.WORKER_RUN_ONCE = true;
  await expect(service().refresh()).rejects.toThrow('synthetic-source-unavailable');
});
it('a periodic worker retains the prior generation without crashing on a failed source read', async () => {
  config.MONITORING_READ_BACKEND = 'postgres';
  config.WORKER_RUN_ONCE = false;
  await expect(service().refresh()).resolves.toBeUndefined();
});
