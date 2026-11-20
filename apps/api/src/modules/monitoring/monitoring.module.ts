import { Module } from '@nestjs/common';
import { config } from '../../shared/config/index.js';
import { AssetsModule } from '../assets/assets.module.js';
import { EvidenceRepository } from '../evidence/evidence.repository.js';
import { ProjectionRepository } from '../projection/projection.repository.js';
import { SettingsModule } from '../settings/settings.module.js';
import { AliasesRepository } from './aliases.repository.js';
import { BookmarksRepository } from './bookmarks.repository.js';
import { BriefingRepository } from './briefing.repository.js';
import { CampaignRegistry } from './campaign-registry.js';
import { CampaignView } from './campaign-view.js';
import { ContextExport } from './context-export.js';
import { EpisodeEdits } from './episode-edits.js';
import { GuideRepository } from './guide.repository.js';
import { MessageTimeline } from './message-timeline.js';
import { MONITORING_SOURCE, MonitoringRepository } from './monitoring.repository.js';
import { MonitoringService } from './monitoring.service.js';
import { OperationsRepository } from './operations.repository.js';
import { PostgresBackups } from './postgres-backups.js';
import { RoomsRepository } from './rooms.repository.js';
import { TimelineTrends } from './timeline-trends.js';

@Module({
  imports: [AssetsModule, SettingsModule],
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
    MessageTimeline,
    TimelineTrends,
    BriefingRepository,
    ContextExport,
    CampaignRegistry,
    CampaignView,
    OperationsRepository,
    PostgresBackups,
    AliasesRepository,
    EpisodeEdits,
  ],
  exports: [
    EvidenceRepository,
    MonitoringService,
    ProjectionRepository,
    MonitoringRepository,
    MessageTimeline,
    TimelineTrends,
    BriefingRepository,
    CampaignRegistry,
  ],
})
export class MonitoringModule {}
