import { Module } from '@nestjs/common';
import { HealthController } from './health.controller.js';
import { LifecycleState } from './lifecycle-state.js';

@Module({
  controllers: [HealthController],
  providers: [LifecycleState],
  exports: [LifecycleState],
})
export class HealthModule {}
