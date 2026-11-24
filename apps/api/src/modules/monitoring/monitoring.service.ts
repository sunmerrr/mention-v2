import { randomUUID } from 'node:crypto';
import { type MonitoringList, type MonitoringScope, monitoringIdSchema } from '@app/shared';
import { workspaceReads } from '@app/shared/monitoring/application/workspace';
import { type Correction, correctionSchema } from '@app/shared/monitoring/contracts/api';
import { Injectable } from '@nestjs/common';
import { config } from '../../shared/config/index.js';
import { AppError } from '../../shared/errors/app-error.js';
import { AssetRepository } from '../assets/asset.repository.js';
import { EvidenceRepository } from '../evidence/evidence.repository.js';
import { ProjectionRepository } from '../projection/projection.repository.js';
import { KeywordSettingsRepository } from '../settings/keyword-settings.repository.js';
import { AliasesRepository } from './aliases.repository.js';
import { BookmarksRepository } from './bookmarks.repository.js';
import { BriefingRepository } from './briefing.repository.js';
import { CampaignRegistry } from './campaign-registry.js';
import { CampaignView } from './campaign-view.js';
import { ContextExport } from './context-export.js';
import { EpisodeEdits } from './episode-edits.js';
import { GuideRepository } from './guide.repository.js';
import { MessageTimeline } from './message-timeline.js';
import { MonitoringRepository } from './monitoring.repository.js';
import { OperationsRepository } from './operations.repository.js';
import { PostgresBackups } from './postgres-backups.js';
import { RoomsRepository } from './rooms.repository.js';
import { TimelineTrends } from './timeline-trends.js';

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
    private readonly timeline: MessageTimeline,
    private readonly trends: TimelineTrends,
    private readonly briefing: BriefingRepository,
    private readonly contextExport: ContextExport,
    private readonly campaignView: CampaignView,
    private readonly campaignRegistry: CampaignRegistry,
    private readonly operations: OperationsRepository,
    private readonly backups: PostgresBackups,
    private readonly aliases: AliasesRepository,
    private readonly episodeEdits: EpisodeEdits,
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
      if (action === 'conversation-review') {
        const id = monitoringIdSchema.parse(input.id);
        const options = await this.evidence.options(id);
        const target = options.find((item) => item.target === input.service);
        if (!target) throw new AppError('INVALID_TARGET', '대화의 분석 대상을 확인해 주세요.', 400);
        return this.evidence.correct(
          correctionSchema.parse({
            id,
            service: target.target,
            verdict: input.verdict,
            summary: input.summary ?? '',
            expected: input.expected ?? target.expected,
            request_id: input.request_id ?? randomUUID(),
            origin: 'human',
          }),
        );
      }
      if (action === 'context-expand' && input.conversation === true) {
        const id = monitoringIdSchema.parse(input.id);
        const detail = await this.evidence.detail(id, { before: 30, after: 30 });
        return {
          added_before: input.direction === 'before' ? Math.max(0, detail.before - 15) : 0,
          added_after: input.direction === 'after' ? Math.max(0, detail.after - 15) : 0,
          complete: true,
          stop_reason: 'stored_context_ready',
        };
      }
      if (action === 'episode-review') return this.episodeEdits.review(input, scope.local);
      if (action === 'conversation-message-review') return this.evidence.reviewContext(input);
      if (action === 'episode-quality') return this.episodeEdits.quality(input, scope.local);
      if (action === 'mention-correction') return this.episodeEdits.correction(input, scope.local);
      if (action === 'feedback-review') return this.episodeEdits.annotate(input, scope.local);
      if (action === 'review-undo') return this.episodeEdits.undo(input.history_id, scope.local);
      if (action === 'context-expand' && input.conversation !== true)
        return this.episodeEdits.expand(input, scope.local);
      if (action === 'alias-decision') return this.aliases.decide(input);
      if (action === 'backup-create') return this.backups.enqueue();
      if (action === 'backup-verify') return this.backups.verify(input.id);
      if (action === 'campaign-start') return this.campaignRegistry.startManual(input);
      if (action === 'campaign-stop') {
        const stopped = await this.campaignRegistry.stop(String(input.id ?? ''));
        if (stopped) return stopped;
        return this.episodeEdits.stop(input.id, scope.local);
      }
      if (action === 'briefing-refresh') return this.briefing.refresh(input.day);
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
  async workspace(feature: string, params: Record<string, string>, local = false) {
    if (!Object.hasOwn(workspaceReads, feature))
      throw new AppError('NOT_FOUND', '없는 기능입니다.', 404);
    if (config.MONITORING_EVIDENCE_BACKEND === 'postgres') {
      if (feature === 'aliases') return this.aliases.list(params);
      if (feature === 'operations') return this.operations.read(params);
      if (feature === 'campaigns') return this.campaignView.list(local);
      if (feature === 'responses') return this.campaignView.responses(params, local);
      if (feature === 'episode') {
        const id = monitoringIdSchema.parse(params.id);
        const existing =
          (await this.campaignView.episode(id, local)) ??
          (await this.campaignView.archivedMention(id, local));
        if (existing) return existing;
        throw new AppError('NOT_FOUND', '없는 대화입니다.', 404);
      }
      if (feature === 'conversation') return this.detail(monitoringIdSchema.parse(params.id));
      if (feature === 'briefing') return this.briefing.read(params.day);
      if (feature === 'delivery') return this.briefing.delivery();
      if (feature === 'trends') return this.trends.read(params);
      if (feature === 'messages') return this.timeline.list(params);
      if (feature === 'guide') return this.guide.list(params);
      if (feature === 'rooms') return this.rooms.list(params);
      if (feature === 'keywords') return this.settings.read();
      if (feature === 'keywordProcessing') return this.settings.processing();
      if (feature === 'bookmarks') return this.bookmarks.list(params);
      throw new AppError('NOT_FOUND', '없는 기능입니다.', 404);
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
    if (config.MONITORING_EVIDENCE_BACKEND === 'postgres') {
      if (endpoint.startsWith('/photo/')) return this.assets.nativePhoto(endpoint);
      const path = new URL(endpoint, 'http://mention.local').pathname;
      const briefingDay = /^\/download\/briefing-(\d{4}-\d{2}-\d{2})\.png$/u.exec(path)?.[1];
      if (briefingDay) return this.briefing.image(briefingDay);
      const contextDay = /^\/download\/context-(\d{4}-\d{2}-\d{2})\.csv$/u.exec(path)?.[1];
      if (contextDay) return this.contextExport.asset(contextDay);
      if (path === '/results.json' || /^\/download\/\d{4}-\d{2}-\d{2}\.csv$/u.test(path))
        return this.timeline.asset(endpoint);
      throw new AppError('ASSET_UNAVAILABLE', '파일을 찾을 수 없습니다.', 404);
    }
    return this.repository.asset(endpoint);
  }
  detail(id: string, window?: { before: number; after: number }) {
    const valid = monitoringIdSchema.parse(id);
    if (config.MONITORING_EVIDENCE_BACKEND === 'postgres')
      return this.evidence.detail(valid, window);
    return this.repository.read(`/api/conversations/${encodeURIComponent(valid)}`);
  }
}
