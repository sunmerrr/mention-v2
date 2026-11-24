import { CombinedQueries } from '@app/shared/monitoring/application/combined';
import { PokergosuQueries } from '@app/shared/monitoring/application/pokergosu';
import { TopicBriefingQueries } from '@app/shared/monitoring/application/topic-briefing';
import type { CombinedScope } from '@app/shared/monitoring/contracts/combined';
import type { PokergosuListInput } from '@app/shared/monitoring/contracts/pokergosu';
import type { TopicScope } from '@app/shared/monitoring/contracts/topic-briefing';
import { Injectable } from '@nestjs/common';
import { config } from '../../shared/config/index.js';
import { AppError } from '../../shared/errors/app-error.js';
import { MonitoringRepository } from '../monitoring/monitoring.repository.js';
import { ProjectionRepository } from '../projection/projection.repository.js';
import { KeywordSettingsRepository } from '../settings/keyword-settings.repository.js';
import { ForumRepository } from './forum.repository.js';
import { ForumMedia } from './forum-media.service.js';
@Injectable()
export class ForumService {
  private readonly pgQueries: PokergosuQueries;
  private readonly pgCombined: CombinedQueries;
  private readonly topics: TopicBriefingQueries;
  constructor(
    private readonly repository: ForumRepository,
    private readonly source: MonitoringRepository,
    projection: ProjectionRepository,
    settings: KeywordSettingsRepository,
    private readonly media: ForumMedia,
  ) {
    this.pgQueries = new PokergosuQueries(repository);
    this.pgCombined = new CombinedQueries({
      kakao: (scope) => projection.overview(scope),
      forum: (scope) => repository.opinions(scope),
      lastForumCollection: async () => (await repository.summary()).lastCheckedAt,
      policy: () => settings.policy(),
      kakaoKeywords: (scope, groups, weeks) => projection.keywordReport(scope, groups, weeks),
      forumKeywords: (scope, weeks) => repository.keywordReport(scope, weeks),
      kakaoRepresentatives: (scope, targets) => projection.representatives(scope, targets),
    });
    this.topics = new TopicBriefingQueries({
      kakao: (from, through) => projection.topicActivity(from, through),
      pokergosu: async (from, through) =>
        repository.topicActivity(from, through, (await settings.policy()).policy),
    });
  }
  save(
    input: import('@app/shared/monitoring/contracts/forum-opinions').ForumCorrection,
    scope: { local: boolean },
  ) {
    if (input.origin === 'ai' && !scope.local)
      throw new AppError('FORBIDDEN', '로컬 AI 요청만 허용합니다.', 403);
    return config.MONITORING_EVIDENCE_BACKEND === 'postgres'
      ? this.repository.save(input)
      : this.source.write(`/api/pokergosu/${input.id}/reviews`, input, scope);
  }
  summary() {
    return config.MONITORING_EVIDENCE_BACKEND === 'postgres'
      ? this.pgQueries.summary()
      : this.source.read('/api/pokergosu/summary');
  }
  list(input: PokergosuListInput) {
    return config.MONITORING_EVIDENCE_BACKEND === 'postgres'
      ? this.pgQueries.list(input)
      : this.source.read('/api/pokergosu', input);
  }
  async detail(id: string) {
    if (config.MONITORING_EVIDENCE_BACKEND !== 'postgres')
      return this.source.read(`/api/pokergosu/${encodeURIComponent(id)}`);
    const detail = await this.pgQueries.detail(id);
    return detail ? this.media.decorate(detail) : null;
  }

  combined(scope: CombinedScope) {
    return config.MONITORING_EVIDENCE_BACKEND === 'postgres'
      ? this.pgCombined.read(scope)
      : this.source.read('/api/combined', { ...scope });
  }
  topicBriefing(scope: TopicScope) {
    return config.MONITORING_EVIDENCE_BACKEND === 'postgres'
      ? this.topics.read(scope)
      : this.source.read('/api/trending', { ...scope });
  }
}
