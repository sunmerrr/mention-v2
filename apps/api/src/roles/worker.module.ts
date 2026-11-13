import { Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { ForumModule } from '../modules/forum/forum.module.js';
import { ForumAggregate } from '../modules/forum/forum-aggregate.service.js';
import { MonitoringModule } from '../modules/monitoring/monitoring.module.js';
import { ProjectionSync } from '../modules/projection/projection-sync.service.js';
import { SettingsModule } from '../modules/settings/settings.module.js';

/** Only the worker role owns scheduled read projection work. */
@Module({
  imports: [ScheduleModule.forRoot(), MonitoringModule, ForumModule, SettingsModule],
  providers: [ProjectionSync, ForumAggregate],
})
export class WorkerModule {}
