import type { OverviewPayload } from "../../contracts/src/api";
import type { KeywordPolicy } from "../../contracts/src/keyword-policy";
import type { Scope } from "../../domain/src/model";
import {
  emptyOpinionCounts,
  type SourceOpinion,
  sharedOpinionTopics,
} from "../../domain/src/source-opinions";

interface Ports {
  kakao(scope: Scope): Promise<OverviewPayload>;
  forum(scope: Scope): Promise<SourceOpinion>;
  policy(): Promise<{ policy: KeywordPolicy }>;
}
export class CombinedQueries {
  constructor(private readonly ports: Ports) {}
  async read(scope: Scope) {
    const [chat, forum, { policy }] = await Promise.all([
      this.ports.kakao(scope),
      this.ports.forum(scope),
      this.ports.policy(),
    ]);
    const kakao: SourceOpinion = {
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
    };
    const rows = policy.keyword_groups
      .filter((g) => !scope.target || g.name === scope.target)
      .map((g) => ({
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
        ...chat.metadata,
        targets: policy.keyword_groups.map((g) => ({
          name: g.name,
          aliases: g.keywords,
        })),
      },
      kakao,
      pokergosu: forum,
      rows,
      topics: sharedOpinionTopics(kakao.evidence, forum.evidence),
      collectionState: chat.overview.collectionState,
    };
  }
}
export type CombinedPayload = Awaited<ReturnType<CombinedQueries["read"]>>;
