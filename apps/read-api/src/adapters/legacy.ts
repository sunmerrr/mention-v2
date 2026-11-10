import { z } from "zod";
import type {
  ClassificationWriter,
  MonitoringReader,
} from "../../../../packages/application/src/ports";
import type {
  Classification,
  Correction,
  Detail,
  Message,
} from "../../../../packages/contracts/src/api";
import type {
  Conversation,
  Dataset,
  Evaluation,
} from "../../../../packages/domain/src/model";

const labelSchema = z.enum([
  "positive",
  "negative",
  "neutral",
  "mixed",
  "uncertain",
  "unreviewed",
]);
const evaluationSchema = z.object({
  verdict: labelSchema,
  summary: z.string().default(""),
  source: z.string(),
  needs_review: z.boolean(),
  expected: z.string().optional(),
  previous_verdict: labelSchema.optional(),
  previous_origin: z.enum(["ai", "human"]).optional(),
});
const groupSchema = z.object({
  id: z.string(),
  room: z.string(),
  anchor_ms: z.number(),
  members: z.array(z.object({ id: z.string().default(""), title: z.string() })),
  services: z.array(z.string()),
  evaluations: z.record(z.string(), evaluationSchema),
  keyword_counts: z.record(z.string(), z.number()),
  message_count: z.number(),
  last_message_ms: z.number().optional(),
  context_preview: z
    .array(
      z.object({
        id: z.string(),
        author: z.string(),
        text: z.string(),
        at: z.number(),
        own: z.boolean().optional(),
        truncated: z.boolean().optional(),
      }),
    )
    .optional(),
});
const snapshotSchema = z.object({
  conversations: z.array(groupSchema),
  keyword_groups: z.array(
    z.object({
      name: z.string(),
      keywords: z.array(z.string()),
      message_count: z.number(),
      keyword_counts: z.record(z.string(), z.number()).optional(),
    }),
  ),
  coverage_summary: z
    .object({ open: z.number(), partial: z.number() })
    .optional(),
  status: z.string().default("unknown"),
});
type Group = z.infer<typeof groupSchema>;
const prefix = "[AI 확정] ";
function normalize(group: Group): Conversation {
  const evaluations: Record<string, Evaluation> = {};
  for (const [target, e] of Object.entries(group.evaluations))
    evaluations[target] = {
      label: e.verdict,
      summary: e.summary.replace(/^\[AI 확정\] /, ""),
      origin:
        e.verdict === "unreviewed"
          ? null
          : e.summary.startsWith(prefix)
            ? "ai"
            : "human",
      stale: e.needs_review,
      expected: e.expected,
      ...(e.needs_review &&
      e.previous_verdict &&
      e.previous_verdict !== "unreviewed" &&
      e.previous_origin
        ? {
            previous: { label: e.previous_verdict, origin: e.previous_origin },
          }
        : {}),
    };
  return {
    id: group.id,
    room: group.room,
    at: group.anchor_ms,
    title: (group.members[0]?.title || "대화 내용을 확인하세요").slice(0, 500),
    targets: group.services,
    evaluations,
    keywords: group.keyword_counts,
    messageCount: group.message_count,
    lastAt: group.last_message_ms,
    contextPreview: group.context_preview,
  };
}
export class UpstreamError extends Error {
  constructor(
    message: string,
    readonly status = 502,
  ) {
    super(message);
  }
}
export class LegacyReader implements MonitoringReader, ClassificationWriter {
  private snapshot?: Dataset;
  private snapshotFlight?: Promise<Dataset>;
  private classificationsCache?: { at: number; items: Classification[] };
  private classificationFlight?: Promise<Classification[]>;
  constructor(
    private readonly base: string,
    private readonly warn: (message: string) => void = () => {},
    private readonly ttl = 30000,
    private readonly transport?: {
      request(path: string, input?: Correction): Promise<unknown>;
    },
  ) {
    const url = new URL(base);
    if (
      !["127.0.0.1", "localhost"].includes(url.hostname) ||
      url.protocol !== "http:"
    )
      throw new Error("The legacy adapter must use loopback HTTP");
  }
  private async request(path: string, input?: Correction): Promise<unknown> {
    if (this.transport) return this.transport.request(path, input);
    const response = await fetch(new URL(path, this.base), {
      method: input ? "POST" : "GET",
      headers: {
        "X-Monitor-Public": "1",
        ...(input
          ? {
              Origin: new URL(this.base).origin,
              "Content-Type": "application/json",
            }
          : {}),
      },
      body: input ? JSON.stringify(input) : undefined,
      signal: AbortSignal.timeout(20000),
    });
    if (!response.ok)
      throw new UpstreamError(
        response.status === 409
          ? "다른 화면에서 평가가 변경됐습니다. 새로고침 후 다시 확인해 주세요."
          : "기존 수집 서비스에서 데이터를 가져오지 못했습니다.",
        response.status === 409 ? 409 : 502,
      );
    return response.json();
  }
  async read(): Promise<Dataset> {
    if (this.snapshot) {
      if (Date.now() - Date.parse(this.snapshot.capturedAt) > this.ttl)
        void this.refresh().catch(() =>
          this.warn(
            "Legacy snapshot refresh failed; retained the last successful public snapshot",
          ),
        );
      return this.snapshot;
    }
    return this.refresh();
  }
  async refresh(): Promise<Dataset> {
    if (this.snapshotFlight) return this.snapshotFlight;
    this.snapshotFlight = (async () => {
      const raw = snapshotSchema.parse(await this.request("/api/insights"));
      const result: Dataset = {
        conversations: raw.conversations.map(normalize),
        targets: raw.keyword_groups.map((g) => ({
          name: g.name,
          aliases: g.keywords,
          mentions: g.message_count,
          aliasCounts: g.keyword_counts,
        })),
        capturedAt: new Date().toISOString(),
        source: "legacy",
        collectionState: raw.status,
        gaps:
          (raw.coverage_summary?.open || 0) +
          (raw.coverage_summary?.partial || 0),
      };
      this.snapshot = result;
      return result;
    })();
    try {
      return await this.snapshotFlight;
    } finally {
      this.snapshotFlight = undefined;
    }
  }
  async detail(id: string): Promise<Detail> {
    if (!/^[a-f0-9]{32}$/.test(id))
      throw new UpstreamError("대화 주소를 확인해 주세요.", 400);
    const raw = await this.request(
      `/api/conversation?id=${encodeURIComponent(id)}`,
    );
    const group = groupSchema.parse(raw);
    const detail = z
      .object({
        messages: z.array(
          z.object({
            log_id: z.string(),
            text: z.string(),
            author_name: z.string().nullish(),
            author_id: z.string().nullish(),
            time_ms: z.number(),
            phase: z.string().default("discussion"),
            context_folded: z.boolean().optional(),
            context_class: z.string().optional(),
            relation: z.string().optional(),
            role: z.string().optional(),
            photos: z
              .array(
                z.object({ url: z.string(), thumbnail: z.string().nullish() }),
              )
              .optional(),
            own: z.union([z.boolean(), z.literal(0), z.literal(1)]).optional(),
          }),
        ),
        context_summary: z
          .object({
            limited: z.boolean(),
            promotion_followup_needed: z.boolean().optional(),
          })
          .optional(),
        phase_counts: z.record(z.string(), z.number()),
        dialogue_phase_counts: z.record(z.string(), z.number()).optional(),
      })
      .parse(raw);
    const messages: Message[] = detail.messages.map((m) => ({
      id: m.log_id,
      author: m.author_name || "참여자",
      text: m.text,
      time: m.time_ms,
      phase: m.phase,
      background: !!m.context_folded,
      backgroundLabel:
        m.context_class === "registration" ? "참가·예약 기록" : undefined,
      own: !!m.own,
      relation: m.relation,
      anchor: m.role === "anchor",
      photos: m.photos,
    }));
    const conversation = normalize(group);
    if (
      Object.values(conversation.evaluations).some(
        (evaluation) => evaluation.stale,
      )
    ) {
      const previous = await this.classifications();
      for (const item of previous.filter(
        (item) =>
          item.conversationId === group.id && item.label !== "unreviewed",
      )) {
        const evaluation = conversation.evaluations[item.target];
        if (evaluation?.stale && item.label !== "unreviewed" && item.origin)
          evaluation.previous = { label: item.label, origin: item.origin };
      }
    }
    return {
      conversation,
      messages,
      limited: !!detail.context_summary?.limited,
      promotionFollowupNeeded:
        detail.context_summary?.promotion_followup_needed,
      before: (detail.dialogue_phase_counts || detail.phase_counts).before || 0,
      after: (detail.dialogue_phase_counts || detail.phase_counts).after || 0,
      source: "legacy",
      episodes: group.members,
    };
  }
  async classificationOptions(id: string): Promise<Classification[]> {
    if (!/^[a-f0-9]{32}$/.test(id))
      throw new UpstreamError("대화 주소를 확인해 주세요.", 400);
    return z
      .array(
        z.object({
          id: z.string(),
          conversationId: z.string(),
          target: z.string(),
          label: labelSchema,
          summary: z.string(),
          origin: z.enum(["ai", "human"]).nullable(),
          stale: z.boolean(),
          expected: z.string(),
          room: z.string(),
          at: z.number(),
          history: z.array(
            z.object({
              at: z.string(),
              origin: z.enum(["ai", "human"]),
              before: z.string(),
              after: z.string(),
              note: z.string(),
            }),
          ),
        }),
      )
      .parse(
        await this.request(
          `/api/classifications-for-conversation?id=${encodeURIComponent(id)}`,
        ),
      );
  }
  async classifications(): Promise<Classification[]> {
    if (
      this.classificationsCache &&
      Date.now() - this.classificationsCache.at < this.ttl
    )
      return this.classificationsCache.items;
    if (this.classificationFlight) return this.classificationFlight;
    this.classificationFlight = (async () => {
      const items: Classification[] = [];
      let page = 1,
        pages = 1;
      do {
        const data = z
          .object({
            pages: z.number().int().min(1),
            items: z.array(
              z.object({
                id: z.string(),
                service: z.string(),
                verdict: labelSchema,
                summary: z.string(),
                origin: z.enum(["ai", "human"]),
                stale: z.boolean(),
                expected: z.string(),
                room: z.string(),
                at: z.number(),
                history: z.array(
                  z.object({
                    at: z.string(),
                    origin: z.enum(["ai", "human"]),
                    previous: z.object({ verdict: z.string() }),
                    next: z.object({
                      verdict: z.string(),
                      summary: z.string(),
                    }),
                  }),
                ),
              }),
            ),
          })
          .parse(await this.request(`/api/classifications?page=${page}`));
        pages = data.pages;
        if (pages > 100)
          throw new UpstreamError(
            "분류 목록이 커서 조회 어댑터의 범위를 넘었습니다.",
          );
        for (const i of data.items)
          items.push({
            id: `${i.id}:${i.service}`,
            conversationId: i.id,
            target: i.service,
            label: i.verdict,
            summary: i.summary,
            origin: i.origin,
            stale: i.stale,
            expected: i.expected,
            room: i.room,
            at: i.at,
            history: i.history.map((e) => ({
              at: e.at,
              origin: e.origin,
              before: e.previous.verdict,
              after: e.next.verdict,
              note: e.next.summary,
            })),
          });
        page++;
      } while (page <= pages);
      this.classificationsCache = { at: Date.now(), items };
      return items;
    })();
    try {
      return await this.classificationFlight;
    } finally {
      this.classificationFlight = undefined;
    }
  }
  invalidate() {
    this.classificationsCache = undefined;
    this.snapshot = undefined;
  }
  async correct(input: Correction): Promise<void> {
    await this.request("/classification-save", input);
    this.classificationsCache = undefined;
    this.snapshot = undefined;
  }
}
