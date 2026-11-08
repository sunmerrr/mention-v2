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
export function selectHighlights(dataset: Dataset, scope: Scope) {
  const candidates = scopedConversations(dataset, scope).flatMap(
    (conversation) =>
      Object.entries(conversation.evaluations)
        .filter(
          ([target, evaluation]) =>
            (!scope.target || target === scope.target) &&
            !evaluation.stale &&
            evaluation.label !== "unreviewed" &&
            evaluation.label !== "uncertain" &&
            evaluation.summary.trim().length > 0 &&
            conversation.messageCount >= 3,
        )
        .map(([target, evaluation]) => ({ conversation, target, evaluation })),
  );
  // Cover distinct target/stance pairs before adding more of the same reaction.
  candidates.sort(
    (a, b) =>
      b.conversation.messageCount - a.conversation.messageCount ||
      b.conversation.at - a.conversation.at ||
      a.conversation.id.localeCompare(b.conversation.id),
  );
  const seen = new Set<string>(),
    ids = new Set<string>();
  return candidates
    .filter(({ conversation, target, evaluation }) => {
      const key = `${target}:${evaluation.label}`;
      if (seen.has(key) || ids.has(conversation.id)) return false;
      seen.add(key);
      ids.add(conversation.id);
      return true;
    })
    .slice(0, 4)
    .map(({ conversation, target, evaluation }) => ({
      id: conversation.id,
      room: conversation.room,
      target,
      label: evaluation.label,
      summary: evaluation.summary,
      reason: `${target}의 ${evaluation.label === "positive" ? "긍정" : evaluation.label === "negative" ? "부정" : evaluation.label === "mixed" ? "혼합" : "중립"} 반응 사례 · 저장된 맥락 ${conversation.messageCount}개`,
    }));
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
    highlights: selectHighlights(dataset, scope),
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
