import { Module } from '@nestjs/common';
import { KeywordSettingsRepository } from './keyword-settings.repository.js';
@Module({ providers: [KeywordSettingsRepository], exports: [KeywordSettingsRepository] })
export class SettingsModule {}
