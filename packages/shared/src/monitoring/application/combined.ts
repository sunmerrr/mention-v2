import type { OverviewPayload } from '../contracts/api.js';
import type { CombinedScope } from '../contracts/combined.js';
import { type KeywordPolicy, sourceKeywords } from '../contracts/keyword-policy.js';
import { forumKeywordIdentity } from '../domain/forum-topics.js';
import { type MentionGroups, rankKeywordMentions } from '../domain/keyword-mentions.js';
import type { Scope } from '../domain/model.js';
import { rankRelatedKeywords } from '../domain/related-keywords.js';
import {
  emptyOpinionCounts,
  type SourceOpinion,
  sharedOpinionTopics,
} from '../domain/source-opinions.js';
import {
  type ReportingWeeks,
  reportingWeeks,
  type WeeklyOpinions,
} from '../domain/weekly-opinions.js';

interface KeywordReport {
  mentions: ReadonlyMap<string, number>;
  related: ReadonlyMap<string, number>;
  weekly: WeeklyOpinions;
}

interface Ports {
  kakao(scope: Scope): Promise<OverviewPayload>;
  forum(scope: Scope): Promise<SourceOpinion>;
  policy(): Promise<{ policy: KeywordPolicy }>;
  kakaoKeywords(scope: Scope, groups: MentionGroups, weeks: ReportingWeeks): Promise<KeywordReport>;
  forumKeywords(scope: Scope, weeks: ReportingWeeks): Promise<KeywordReport>;
}
const emptySource: SourceOpinion = {
  available: false,
  units: 0,
  undated: 0,
  targets: [],
  evidence: [],
};
export class CombinedQueries {
  constructor(private readonly ports: Ports) {}
  async read(scope: CombinedScope) {
    const { policy } = await this.ports.policy();
    const { source, ...filters } = scope;
    const enabled = source
      ? new Set(sourceKeywords(policy, source).map(forumKeywordIdentity))
      : null;
    const configuredGroups = policy.keyword_groups.filter(
      ({ keywords }) =>
        !enabled || keywords.some((word) => enabled.has(forumKeywordIdentity(word))),
    );
    const groups = configuredGroups.filter((g) => !scope.target || g.name === scope.target);
    const weeks = reportingWeeks(scope.day);
    const useKakao = source !== 'pokergosu',
      useForum = source !== 'kakao';
    const [chat, forum, kakaoKeywords, forumKeywords] = await Promise.all([
      useKakao ? this.ports.kakao(filters) : undefined,
      useForum ? this.ports.forum(filters) : emptySource,
      useKakao ? this.ports.kakaoKeywords(filters, groups, weeks) : undefined,
      useForum ? this.ports.forumKeywords(filters, weeks) : undefined,
    ]);
    const kakao: SourceOpinion = chat
      ? {
          units: chat.overview.conversations,
          available: true,
          undated: 0,
          targets: chat.overview.targets.map((t) => ({
            id: policy.keyword_groups.find((g) => g.name === t.name)?.id || t.name,
            name: t.name,
            counts: t.counts,
            units: t.conversations,
          })),
          evidence: chat.overview.highlights.map((e) => ({
            id: e.id,
            target: e.target,
            label: e.label,
            summary: e.summary,
            href: `/conversations/${e.id}?nav=%2Fcombined`,
            title: e.room,
            at: 0,
          })),
        }
      : emptySource;
    const rows = groups.map((g) => ({
      id: g.id,
      name: g.name,
      kakao: kakao.targets.find((t) => t.id === g.id) || {
        id: g.id,
        name: g.name,
        counts: emptyOpinionCounts(),
        units: 0,
      },
      pokergosu: forum.targets.find((t) => t.id === g.id) || {
        id: g.id,
        name: g.name,
        counts: emptyOpinionCounts(),
        units: 0,
      },
    }));
    return {
      scope,
      metadata: {
        days: chat?.metadata.days ?? [],
        source: chat?.metadata.source ?? ('legacy' as const),
        targets: configuredGroups.map((g) => ({
          name: g.name,
          aliases: g.keywords,
        })),
      },
      kakao,
      pokergosu: forum,
      rows,
      keywordMentions: rankKeywordMentions(
        groups,
        policy,
        kakaoKeywords?.mentions ?? new Map(),
        forumKeywords?.mentions ?? new Map(),
        forum.available,
      ),
      relatedKeywords:
        scope.target && groups[0]
          ? rankRelatedKeywords(
              groups[0],
              configuredGroups,
              kakaoKeywords?.related ?? new Map(),
              forumKeywords?.related ?? new Map(),
              forum.available,
            )
          : [],
      weekly: {
        weeks,
        rows: rows.map(({ id, name }) => ({
          id,
          name,
          values: weeks.map(({ start }) => {
            const chat = kakaoKeywords?.weekly.get(start, name);
            const forum = forumKeywords?.weekly.get(start, name);
            if (!chat && !forum) return null;
            const positive = (chat?.positive ?? 0) + (forum?.positive ?? 0);
            const negative = (chat?.negative ?? 0) + (forum?.negative ?? 0);
            const classified =
              positive +
              negative +
              (chat?.neutral ?? 0) +
              (forum?.neutral ?? 0) +
              (chat?.mixed ?? 0) +
              (forum?.mixed ?? 0);
            const mentions =
              classified +
              (chat?.uncertain ?? 0) +
              (forum?.uncertain ?? 0) +
              (chat?.unreviewed ?? 0) +
              (forum?.unreviewed ?? 0);
            return { positive, negative, classified, mentions };
          }),
        })),
      },
      topics: sharedOpinionTopics(kakao.evidence, forum.evidence),
      collectionState: chat?.overview.collectionState ?? 'snapshot',
    };
  }
}
export type CombinedPayload = Awaited<ReturnType<CombinedQueries['read']>>;
