export const stances = [
  "positive",
  "negative",
  "neutral",
  "mixed",
  "uncertain",
] as const;
export type Stance = (typeof stances)[number];
export const decisions = [...stances, "excluded"] as const;
export type Decision = (typeof decisions)[number];
export type Label = Decision | "unreviewed";
export type Origin = "ai" | "human";
export interface Evaluation {
  label: Label;
  summary: string;
  origin: Origin | null;
  stale: boolean;
  expected?: string;
  previous?: { label: Decision; origin: Origin };
}
export interface ContextPreview {
  id: string;
  author: string;
  text: string;
  at: number;
  own?: boolean;
  truncated?: boolean;
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
  lastAt?: number;
  contextPreview?: ContextPreview[];
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
const koreanDateFormatter = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Asia/Seoul",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});
export function koreanDay(timestamp: number): string {
  return koreanDateFormatter.format(timestamp);
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
            evaluation.label !== "excluded" &&
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
export function selectConversationSections(dataset: Dataset, scope: Scope) {
  const preview = (c: Conversation) =>
    (c.contextPreview || []).slice(0, 3).map((m) => ({
      ...m,
      text: m.text.slice(0, 180),
      truncated: !!m.truncated || m.text.length > 180,
    }));
  const scoped = scopedConversations(dataset, scope);
  const latest = scoped
    .filter(
      (c) => c.contextPreview === undefined || c.contextPreview.length > 0,
    )
    .sort(
      (a, b) =>
        (b.lastAt ?? b.at) - (a.lastAt ?? a.at) || b.id.localeCompare(a.id),
    )
    .slice(0, 4)
    .map((c) => ({
      id: c.id,
      room: c.room,
      at: c.lastAt ?? c.at,
      title: c.title,
      targets: c.targets,
      messageCount: c.messageCount,
      contextPreview: preview(c),
      judgmentExcluded: c.targets
        .filter((target) => !scope.target || target === scope.target)
        .every((target) => c.evaluations[target]?.label === "excluded"),
      opinions: Object.entries(c.evaluations)
        .filter(
          ([target, e]) =>
            (!scope.target || target === scope.target) &&
            !e.stale &&
            e.label !== "unreviewed" &&
            e.label !== "excluded" &&
            !!e.summary.trim(),
        )
        .map(([target, e]) => ({
          target,
          label: e.label,
          summary: e.summary,
          origin: e.origin,
        })),
    }));
  function reaction(label: "positive" | "negative") {
    const candidates = scoped.flatMap((conversation) =>
      Object.entries(conversation.evaluations)
        .filter(
          ([target, e]) =>
            (!scope.target || target === scope.target) &&
            !e.stale &&
            e.label === label &&
            !!e.summary.trim() &&
            conversation.messageCount >= 3,
        )
        .map(([target, evaluation]) => ({
          id: conversation.id,
          target,
          label,
          summary: evaluation.summary,
          origin: evaluation.origin,
          room: conversation.room,
          at: conversation.lastAt ?? conversation.at,
          messageCount: conversation.messageCount,
          contextPreview: preview(conversation),
        })),
    );
    candidates.sort(
      (a, b) =>
        b.messageCount - a.messageCount ||
        b.at - a.at ||
        a.id.localeCompare(b.id),
    );
    const chosen: typeof candidates = [],
      ids = new Set<string>(),
      targets = new Set<string>();
    // First cover targets, then fill remaining places with different conversations.
    for (const diverse of [true, false])
      for (const candidate of candidates) {
        if (chosen.length === 4) break;
        if (ids.has(candidate.id) || (diverse && targets.has(candidate.target)))
          continue;
        ids.add(candidate.id);
        targets.add(candidate.target);
        chosen.push(candidate);
      }
    return chosen;
  }
  return {
    latest,
    positive: reaction("positive"),
    negative: reaction("negative"),
  };
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
        [...decisions, "unreviewed"].map((s) => [s, 0]),
      ) as Record<Label, number>;
      for (const c of relevant) {
        const e = c.evaluations[target.name];
        counts[e?.stale ? "unreviewed" : e?.label || "unreviewed"]++;
      }
      return {
        ...target,
        counts,
        conversations: relevant.length,
        classified: relevant.length - counts.unreviewed - counts.excluded,
      };
    })
    .sort(
      (a, b) =>
        b.conversations - a.conversations || a.name.localeCompare(b.name),
    );
  return {
    highlights: selectHighlights(dataset, scope),
    conversationSections: selectConversationSections(dataset, scope),
    targets,
    conversations: conversations.length,
    classified: targets.reduce((sum, t) => sum + t.classified, 0),
    excluded: targets.reduce((sum, t) => sum + t.counts.excluded, 0),
    unclassified: targets.reduce((sum, t) => sum + t.counts.unreviewed, 0),
    activeTargets: targets.filter((t) => t.conversations > 0).length,
    gaps: dataset.gaps,
    collectionState: dataset.collectionState,
    capturedAt: dataset.capturedAt,
    source: dataset.source,
  };
}
export type Overview = ReturnType<typeof summarize>;

export function reviewState(evaluation?: Evaluation) {
  if (evaluation?.label === "excluded") return "excluded";
  return evaluation?.stale
    ? "recheck"
    : !evaluation || evaluation.label === "unreviewed"
      ? "unclassified"
      : "classified";
}
export function matchesReviewState(
  evaluation: Evaluation | undefined,
  status?: string,
) {
  return (
    !status ||
    (status === "pending"
      ? ["unclassified", "recheck"].includes(reviewState(evaluation))
      : reviewState(evaluation) === status)
  );
}
