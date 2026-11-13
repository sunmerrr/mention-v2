import { Module } from '@nestjs/common';
import { OwnerIngest } from '../modules/connection/owner-ingest.service.js';
import { ForumController } from '../modules/forum-intake/forum-controller.js';
import { ForumStore } from '../modules/forum-intake/forum-store.js';
import { HealthModule } from '../modules/health/health.module.js';
@Module({
  imports: [HealthModule],
  controllers: [ForumController],
  providers: [OwnerIngest, ForumStore],
})
export class IngestModule {}
