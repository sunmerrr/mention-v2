export const stances = [
  "positive",
  "negative",
  "neutral",
  "mixed",
  "uncertain",
] as const;
export type Stance = (typeof stances)[number];
export type Label = Stance | "unreviewed";
export type Origin = "ai" | "human";
export interface Evaluation {
  label: Label;
  summary: string;
  origin: Origin | null;
  stale: boolean;
}
export interface Conversation {
  id: string;
  room: string;
  at: number;
  title: string;
  targets: string[];
  evaluations: Record<string, Evaluation>;
  keywords: Record<string, number>;
  messageCount: number;
}
export interface Target {
  name: string;
  aliases: string[];
  mentions: number;
  aliasCounts?: Record<string, number>;
}
export interface Dataset {
  conversations: Conversation[];
  targets: Target[];
  capturedAt: string;
  source: "legacy" | "synthetic";
  collectionState: string;
  gaps: number;
}
export interface Scope {
  day: string;
  target: string;
}
export interface ConversationFilter extends Scope {
  label: string;
}
export function koreanDay(timestamp: number): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(timestamp);
}
export function scopedConversations(
  dataset: Dataset,
  scope: Scope,
): Conversation[] {
  return dataset.conversations.filter(
    (c) =>
      (!scope.day || koreanDay(c.at) === scope.day) &&
      (!scope.target || c.targets.includes(scope.target)),
  );
}
export function summarize(dataset: Dataset, scope: Scope) {
  const conversations = scopedConversations(dataset, scope);
  const targets = dataset.targets
    .filter((t) => !scope.target || t.name === scope.target)
    .map((target) => {
      const relevant = conversations.filter((c) =>
        c.targets.includes(target.name),
      );
      const counts = Object.fromEntries(
        [...stances, "unreviewed"].map((s) => [s, 0]),
      ) as Record<Label, number>;
      for (const c of relevant) {
        const e = c.evaluations[target.name];
        counts[e?.stale ? "unreviewed" : e?.label || "unreviewed"]++;
      }
      return {
        ...target,
        counts,
        conversations: relevant.length,
        classified: relevant.length - counts.unreviewed,
      };
    })
    .sort(
      (a, b) =>
        b.conversations - a.conversations || a.name.localeCompare(b.name),
    );
  return {
    targets,
    conversations: conversations.length,
    classified: targets.reduce((sum, t) => sum + t.classified, 0),
    unclassified: targets.reduce((sum, t) => sum + t.counts.unreviewed, 0),
    activeTargets: targets.filter((t) => t.conversations > 0).length,
    gaps: dataset.gaps,
    collectionState: dataset.collectionState,
    capturedAt: dataset.capturedAt,
    source: dataset.source,
  };
}
export type Overview = ReturnType<typeof summarize>;
