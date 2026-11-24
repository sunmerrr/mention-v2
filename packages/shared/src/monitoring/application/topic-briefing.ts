import type { TopicScope } from '../contracts/topic-briefing.js';
import { koreanDay, koreanLocalToEpoch } from '../domain/time.js';
import { rankTopics, type TopicSource } from '../domain/topic-briefing.js';

const hour = 3600000;
export const recentTopicHours = 6;

interface TopicPorts {
  kakao(from: number, through: number): Promise<TopicSource>;
  pokergosu(from: number, through: number): Promise<TopicSource>;
}

export class TopicBriefingQueries {
  constructor(private readonly ports: TopicPorts) {}

  async read(scope: TopicScope, now = Date.now()) {
    const today = koreanDay(now);
    const day = scope.mode === 'daily' && scope.day && scope.day < today ? scope.day : today;
    const from =
      scope.mode === 'daily' ? koreanLocalToEpoch(`${day}T00:00`) : now - recentTopicHours * hour;
    const through = scope.mode === 'daily' ? Math.min(now, from + 24 * hour - 1) : now;
    const [kakao, pokergosu] = await Promise.all([
      this.ports.kakao(from, through),
      this.ports.pokergosu(from, through),
    ]);
    return {
      mode: scope.mode,
      day,
      today,
      from,
      through,
      partial: scope.mode === 'daily' && day === today,
      topics: rankTopics(kakao.mentions, pokergosu.mentions),
      sources: {
        kakao: {
          checkedAt: kakao.checkedAt,
          available: kakao.available,
          count: kakao.mentions.length,
        },
        pokergosu: {
          checkedAt: pokergosu.checkedAt,
          available: pokergosu.available,
          count: pokergosu.mentions.length,
        },
      },
    };
  }
}
export type TopicBriefingPayload = Awaited<ReturnType<TopicBriefingQueries['read']>>;
