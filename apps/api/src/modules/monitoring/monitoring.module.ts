import { Module } from '@nestjs/common';
import { config } from '../../shared/config/index.js';
import { EvidenceRepository } from '../evidence/evidence.repository.js';
import { ProjectionRepository } from '../projection/projection.repository.js';
import { SettingsModule } from '../settings/settings.module.js';
import { BookmarksRepository } from './bookmarks.repository.js';
import { GuideRepository } from './guide.repository.js';
import { MONITORING_SOURCE, MonitoringRepository } from './monitoring.repository.js';
import { MonitoringService } from './monitoring.service.js';
import { RoomsRepository } from './rooms.repository.js';

@Module({
  imports: [SettingsModule],
  providers: [
    {
      provide: MONITORING_SOURCE,
      useValue: { origin: config.MENTION_SOURCE_URL, timeoutMs: config.MENTION_SOURCE_TIMEOUT_MS },
    },
    EvidenceRepository,
    ProjectionRepository,
    MonitoringRepository,
    MonitoringService,
    BookmarksRepository,
    RoomsRepository,
    GuideRepository,
  ],
  exports: [EvidenceRepository, MonitoringService, ProjectionRepository, MonitoringRepository],
})
export class MonitoringModule {}
