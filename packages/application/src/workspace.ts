/** Existing monitoring capabilities; no assistant or collector lifecycle operations. */
export type RecordData = Record<string, unknown>;
export const workspaceReads = {
  keywords: "/api/keywords",
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
