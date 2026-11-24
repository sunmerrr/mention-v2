export interface TopicMention {
  id: string;
  title: string;
  at: number;
  targets: string[];
}

export interface TopicSource {
  mentions: TopicMention[];
  checkedAt: number | null;
  available: boolean;
}

const orderById = new Intl.Collator('en', { numeric: true });

export function rankTopics(kakao: TopicMention[], pokergosu: TopicMention[]) {
  type Source = 'kakao' | 'pokergosu';
  const topics = new Map<
    string,
    {
      name: string;
      kakao: number;
      pokergosu: number;
      latest: Partial<Record<Source, { id: string; title: string; at: number }>>;
    }
  >();
  for (const [source, mentions] of [
    ['kakao', kakao],
    ['pokergosu', pokergosu],
  ] as const) {
    for (const { id, title, at, targets } of mentions) {
      for (const name of new Set(targets)) {
        const topic = topics.get(name) ?? {
          name,
          kakao: 0,
          pokergosu: 0,
          latest: {},
        };
        topic[source]++;
        const previous = topic.latest[source];
        if (
          !previous ||
          at > previous.at ||
          (at === previous.at && orderById.compare(id, previous.id) > 0)
        )
          topic.latest[source] = { id, title, at };
        topics.set(name, topic);
      }
    }
  }
  return [...topics.values()]
    .map((topic) => ({ ...topic, count: topic.kakao + topic.pokergosu }))
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name, 'ko'));
}
