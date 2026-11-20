import { Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { AssetsModule } from '../modules/assets/assets.module.js';
import { NativePhotoWorker } from '../modules/assets/native-photo-worker.service.js';
import { NativeContextPublisher } from '../modules/context/native-context-publisher.service.js';
import { NativeNormalizer } from '../modules/context/native-normalizer.service.js';
import { ForumModule } from '../modules/forum/forum.module.js';
import { ForumAggregate } from '../modules/forum/forum-aggregate.service.js';
import { MessageTimelineWorker } from '../modules/monitoring/message-timeline-worker.js';
import { MonitoringModule } from '../modules/monitoring/monitoring.module.js';
import { ObservationBrokerWorker } from '../modules/monitoring/observation-broker-worker.js';
import { ProjectionSync } from '../modules/projection/projection-sync.service.js';
import { SettingsModule } from '../modules/settings/settings.module.js';

/** Only the worker role owns scheduled read projection work. */
@Module({
  imports: [ScheduleModule.forRoot(), MonitoringModule, ForumModule, SettingsModule, AssetsModule],
  providers: [
    ProjectionSync,
    ForumAggregate,
    NativeNormalizer,
    NativeContextPublisher,
    NativePhotoWorker,
    MessageTimelineWorker,
    ObservationBrokerWorker,
  ],
})
export class WorkerModule {}
