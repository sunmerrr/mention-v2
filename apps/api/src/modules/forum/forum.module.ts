import { Module } from '@nestjs/common';
import { AssetsModule } from '../assets/assets.module.js';
import { MonitoringModule } from '../monitoring/monitoring.module.js';
import { SettingsModule } from '../settings/settings.module.js';
import { ForumRepository } from './forum.repository.js';
import { ForumService } from './forum.service.js';
import { ForumMedia } from './forum-media.service.js';
@Module({
  imports: [MonitoringModule, SettingsModule, AssetsModule],
  providers: [ForumRepository, ForumService, ForumMedia],
  exports: [ForumRepository, ForumService, ForumMedia],
})
export class ForumModule {}
