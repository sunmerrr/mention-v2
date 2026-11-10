import { campaignOrigin } from "../../domain/src/campaign-origin";
/** Existing monitoring capabilities; no assistant or collector lifecycle operations. */
export type RecordData = Record<string, unknown>;
export const workspaceReads = {
  keywords: "/api/keywords",
  keywordProcessing: "/api/keyword-processing",
  rooms: "/api/rooms",
  guide: "/api/guide",
  messages: "/api",
  trends: "/api/trends",
  campaigns: "/api/campaigns",
  responses: "/api/campaign-comparison",
  briefing: "/api/briefing",
  delivery: "/api/briefing-delivery",
  bookmarks: "/api/bookmarks",
  aliases: "/api/aliases",
  operations: "/api/operations",
  episode: "/api/episode",
  conversation: "/api/conversation",
} as const;
export type WorkspaceFeature = keyof typeof workspaceReads;
export const workspaceActions = [
  "keyword-settings",
  "keyword-check",
  "room-settings",
  "guide-settings",
  "bookmark-save",
  "bookmark-archive",
  "alias-decision",
  "briefing-refresh",
  "briefing-recipient",
  "briefing-delivery-settings",
  "briefing-send",
  "backup-create",
  "backup-verify",
  "campaign-start",
  "campaign-send",
  "campaign-stop",
  "context-expand",
  "episode-review",
  "episode-quality",
  "conversation-review",
  "conversation-message-review",
  "review-undo",
  "mention-correction",
  "feedback-review",
] as const;
export type WorkspaceAction = (typeof workspaceActions)[number];
export const localActions = new Set<WorkspaceAction>([
  "briefing-recipient",
  "briefing-delivery-settings",
  "briefing-send",
  "backup-create",
  "backup-verify",
  "campaign-send",
]);
export interface WorkspacePort {
  request(path: string, input?: unknown, local?: boolean): Promise<unknown>;
}
export class WorkspaceQueries {
  constructor(private readonly port: WorkspacePort) {}
  async read(
    feature: WorkspaceFeature,
    search: string,
    local = false,
  ): Promise<RecordData> {
    if (feature === "responses") {
      const params = new URLSearchParams(search);
      const source = params.get("source") || "dashboard";
      if (!["dashboard", "external", "legacy"].includes(source))
        throw new Error("Invalid observation source");
      const raw = (await this.port.request(
        "/api/campaigns",
        undefined,
        local,
      )) as RecordData;
      const records = Array.isArray(raw.campaigns)
        ? (raw.campaigns as RecordData[])
        : [];
      const counts = { dashboard: 0, external: 0, legacy: 0 };
      const options = records.flatMap((record) => {
        const origin = campaignOrigin(record.request_id);
        counts[origin]++;
        return origin === source
          ? [
              {
                id: record.id,
                title: record.title,
                room: record.room,
                anchor_ms: record.anchor_ms,
                source: origin,
              },
            ]
          : [];
      });
      const allowed = new Set(options.map((option) => option.id));
      const ids = (params.get("ids") || "")
        .split(",")
        .filter(Boolean)
        .filter((id) => allowed.has(id));
      const comparison = ids.length
        ? ((await this.port.request(
            `/api/campaign-comparison?ids=${encodeURIComponent(ids.slice(0, 6).join(","))}`,
            undefined,
            local,
          )) as RecordData)
        : {};
      return {
        ...comparison,
        options,
        campaigns: comparison.campaigns || [],
        source,
        source_counts: counts,
      };
    }
    if (feature === "rooms") {
      const filters = new URLSearchParams(search);
      const load = async (state: "active" | "excluded", key: string) => {
        const params = new URLSearchParams({
          state,
          page: filters.get(key) || "1",
          page_size: "25",
        });
        if (filters.get("q")) params.set("q", filters.get("q") || "");
        const result = await this.port.request(
          `/api/rooms?${params}`,
          undefined,
          local,
        );
        if (!result || typeof result !== "object" || Array.isArray(result))
          throw new Error("Invalid room response");
        return result as RecordData;
      };
      const [included, excluded] = await Promise.all([
        load("active", "included_page"),
        load("excluded", "excluded_page"),
      ]);
      return { included, excluded, summary: included.summary };
    }
    const path = workspaceReads[feature];
    if (!path) throw new Error("Unknown workspace feature");
    const params = new URLSearchParams(search);
    for (const key of ["room", "target", "status", "category"])
      if (params.get(key) === "all") params.delete(key);
    const result = await this.port.request(
      `${path}${params.size ? `?${params}` : ""}`,
      undefined,
      local,
    );
    if (!result || typeof result !== "object" || Array.isArray(result))
      throw new Error("Invalid workspace response");
    return result as RecordData;
  }
  async action(action: WorkspaceAction, input: RecordData, local: boolean) {
    if (
      !workspaceActions.includes(action) ||
      (localActions.has(action) && !local)
    )
      throw new Error("Action unavailable");
    return this.port.request(`/${action}`, input, local);
  }
  asset(path: string) {
    return this.port.request(path);
  }
}
