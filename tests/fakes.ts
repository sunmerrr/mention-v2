import type {
  ClassificationWriter,
  MonitoringReader,
} from "../packages/application/src/ports";
import type {
  Classification,
  Correction,
  Detail,
} from "../packages/contracts/src/api";
import type { Dataset, Label } from "../packages/domain/src/model";
export function fixture(): Dataset {
  const labels: Label[] = [
    "positive",
    "negative",
    "neutral",
    "mixed",
    "uncertain",
    "unreviewed",
  ];
  return {
    source: "synthetic",
    capturedAt: "2026-11-05T01:00:00.000Z",
    collectionState: "monitoring",
    gaps: 1,
    targets: [
      { name: "샘플 A", aliases: ["A", "에이"], mentions: 30 },
      { name: "샘플 B", aliases: ["B"], mentions: 20 },
    ],
    conversations: Array.from({ length: 29 }, (_, index) => {
      const id = index.toString(16).padStart(32, "0");
      return {
        id,
        room: "합성 테스트 방",
        at: 1793840400000 - Math.floor(index / 3) * 1000,
        title: `합성 발언 ${index}`,
        targets: ["샘플 A", "샘플 B"],
        evaluations: {
          "샘플 A": {
            label: labels[index % 6],
            summary: "합성 분류 근거",
            origin: "ai" as const,
            stale: false,
          },
          "샘플 B": {
            label: "unreviewed" as const,
            summary: "",
            origin: null,
            stale: false,
          },
        },
        keywords: { A: 1 },
        messageCount: 4,
      };
    }),
  };
}
export class FakeReader implements MonitoringReader, ClassificationWriter {
  data = fixture();
  writes: Correction[] = [];
  async read() {
    return this.data;
  }
  async refresh() {
    return this.data;
  }
  async detail(id: string): Promise<Detail> {
    const c = this.data.conversations.find((c) => c.id === id);
    if (!c) throw Error("missing fixture");
    return {
      conversation: c,
      messages: [
        {
          id: "synthetic-message",
          text: "합성 메시지",
          author: "합성 참여자",
          time: c.at,
          phase: "discussion",
          background: false,
          own: false,
        },
      ],
      limited: true,
      before: 0,
      after: 0,
      source: "synthetic",
    };
  }
  async classifications(): Promise<Classification[]> {
    return this.data.conversations.slice(0, 5).map((c) => ({
      id: `${c.id}:A`,
      conversationId: c.id,
      target: "샘플 A",
      label: "positive",
      summary: "합성 분류",
      origin: "ai",
      stale: false,
      expected: "synthetic-revision",
      room: c.room,
      at: c.at,
      history: [],
    }));
  }
  async correct(input: Correction) {
    this.writes.push(input);
  }
}
