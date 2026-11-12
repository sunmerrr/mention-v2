import { Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { MonitoringModule } from '../modules/monitoring/monitoring.module.js';
import { ProjectionSync } from '../modules/projection/projection-sync.service.js';

/** Only the worker role owns scheduled read projection work. */
@Module({ imports: [ScheduleModule.forRoot(), MonitoringModule], providers: [ProjectionSync] })
export class WorkerModule {}
