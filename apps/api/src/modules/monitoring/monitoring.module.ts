import { Module } from '@nestjs/common';
import { config } from '../../shared/config/index.js';
import { MONITORING_SOURCE, MonitoringRepository } from './monitoring.repository.js';
import { MonitoringService } from './monitoring.service.js';

@Module({
  providers: [
    {
      provide: MONITORING_SOURCE,
      useValue: { origin: config.MENTION_SOURCE_URL, timeoutMs: config.MENTION_SOURCE_TIMEOUT_MS },
    },
    MonitoringRepository,
    MonitoringService,
  ],
  exports: [MonitoringService],
})
export class MonitoringModule {}
