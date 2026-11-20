import { type MonitoringList, type MonitoringScope, monitoringIdSchema } from '@app/shared';
import { workspaceReads } from '@app/shared/monitoring/application/workspace';
import type { Correction } from '@app/shared/monitoring/contracts/api';
import { Injectable } from '@nestjs/common';
import { config } from '../../shared/config/index.js';
import { AppError } from '../../shared/errors/app-error.js';
import { AssetRepository } from '../assets/asset.repository.js';
import { EvidenceRepository } from '../evidence/evidence.repository.js';
import { ProjectionRepository } from '../projection/projection.repository.js';
import { KeywordSettingsRepository } from '../settings/keyword-settings.repository.js';
import { BookmarksRepository } from './bookmarks.repository.js';
import { GuideRepository } from './guide.repository.js';
import { MonitoringRepository } from './monitoring.repository.js';
import { RoomsRepository } from './rooms.repository.js';

@Injectable()
export class MonitoringService {
  constructor(
    private readonly repository: MonitoringRepository,
    private readonly projection: ProjectionRepository,
    private readonly evidence: EvidenceRepository,
    private readonly settings: KeywordSettingsRepository,
    private readonly bookmarks: BookmarksRepository,
    private readonly rooms: RoomsRepository,
    private readonly guide: GuideRepository,
    private readonly assets: AssetRepository,
  ) {}
  requestState(id: string) {
    if (config.MONITORING_EVIDENCE_BACKEND === 'postgres') return this.evidence.requestState(id);
    return this.repository.read(`/api/classifications/request-state/${encodeURIComponent(id)}`);
  }
  async correct(input: Correction, scope: { local: boolean }) {
    if (input.origin === 'ai' && !scope.local)
      throw new AppError('FORBIDDEN', '로컬 AI 요청만 허용합니다.', 403);
    if (config.MONITORING_EVIDENCE_BACKEND === 'postgres') return this.evidence.correct(input);
    const result = await this.repository.write('/api/classifications/correct', input, scope);
    void this.projection.requestRefresh().catch(() => {});
    return result;
  }
  async action(action: string, input: Record<string, unknown>, scope: { local: boolean }) {
    if (config.MONITORING_EVIDENCE_BACKEND === 'postgres') {
      if (action === 'guide-settings') return this.guide.save(input);
      if (action === 'room-settings') return this.rooms.save(input);
      if (action === 'keyword-settings') return this.settings.save(input);
      if (action === 'keyword-check') return this.settings.check(input);
      if (action === 'bookmark-save') return this.bookmarks.save(input);
      if (action === 'bookmark-archive') return this.bookmarks.archive(input);
    }
    const result = await this.repository.write(`/api/actions/${action}`, input, scope);
    void this.projection.requestRefresh().catch(() => {});
    return result;
  }
  overview(scope: MonitoringScope) {
    return config.MONITORING_READ_BACKEND === 'postgres'
      ? this.projection.overview(scope)
      : this.repository.read('/api/overview', scope);
  }
  conversations(query: MonitoringList) {
    return config.MONITORING_READ_BACKEND === 'postgres'
      ? this.projection.list(query)
      : this.repository.read('/api/conversations', query);
  }
  classifications(query: MonitoringList) {
    return config.MONITORING_EVIDENCE_BACKEND === 'postgres'
      ? this.evidence.list(query)
      : this.repository.read('/api/classifications', query);
  }
  sourceKeywordStatus() {
    return config.MONITORING_EVIDENCE_BACKEND === 'postgres'
      ? this.settings.forumProcessing()
      : this.repository.read('/api/source-keywords/status');
  }
  workspace(feature: string, params: Record<string, string>) {
    if (!Object.hasOwn(workspaceReads, feature))
      throw new AppError('NOT_FOUND', '없는 기능입니다.', 404);
    if (config.MONITORING_EVIDENCE_BACKEND === 'postgres') {
      if (feature === 'guide') return this.guide.list(params);
      if (feature === 'rooms') return this.rooms.list(params);
      if (feature === 'keywords') return this.settings.read();
      if (feature === 'keywordProcessing') return this.settings.processing();
      if (feature === 'bookmarks') return this.bookmarks.list(params);
    }
    return this.repository.read(`/api/workspace/${feature}`, params);
  }
  options(id: string) {
    if (config.MONITORING_EVIDENCE_BACKEND === 'postgres')
      return this.evidence.options(monitoringIdSchema.parse(id));
    return this.repository.read(
      `/api/conversations/${monitoringIdSchema.parse(id)}/classifications`,
    );
  }
  asset(endpoint: string) {
    if (config.MONITORING_EVIDENCE_BACKEND === 'postgres' && endpoint.startsWith('/photo/'))
      return this.assets.nativePhoto(endpoint);
    return this.repository.asset(endpoint);
  }
  detail(id: string, window?: { before: number; after: number }) {
    const valid = monitoringIdSchema.parse(id);
    if (config.MONITORING_EVIDENCE_BACKEND === 'postgres')
      return this.evidence.detail(valid, window);
    return this.repository.read(`/api/conversations/${encodeURIComponent(valid)}`);
  }
}
