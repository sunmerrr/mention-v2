import { createHash } from "node:crypto";
import { chmodSync, mkdirSync } from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import type {
  ClassificationWriter,
  MonitoringReader,
} from "../../../../packages/application/src/ports";
import type {
  Classification,
  Correction,
  Detail,
} from "../../../../packages/contracts/src/api";
import type {
  Conversation,
  Dataset,
  Origin,
} from "../../../../packages/domain/src/model";
import { UpstreamError } from "./legacy";

type Decision = {
  active: number;
  revision: number;
  summary: string;
  base: string;
  origin: Origin;
};
export class JudgmentExclusions
  implements MonitoringReader, ClassificationWriter
{
  private db: DatabaseSync;
  private locks = new Map<string, Promise<void>>();
  constructor(
    private readonly source: MonitoringReader &
      ClassificationWriter & { invalidate?: () => void },
    filename: string,
  ) {
    if (filename !== ":memory:")
      mkdirSync(path.dirname(filename), { recursive: true, mode: 0o700 });
    this.db = new DatabaseSync(filename);
    if (filename !== ":memory:") chmodSync(filename, 0o600);
    this.db.exec(`CREATE TABLE IF NOT EXISTS exclusions(id TEXT,target TEXT,active INTEGER,revision INTEGER,summary TEXT,base TEXT,metadata TEXT,origin TEXT NOT NULL DEFAULT 'human',PRIMARY KEY(id,target));
      CREATE TABLE IF NOT EXISTS decisions(request_id TEXT PRIMARY KEY,payload TEXT,state TEXT,at TEXT,canonical_id TEXT);
      CREATE TABLE IF NOT EXISTS decision_events(request_id TEXT PRIMARY KEY,id TEXT,target TEXT,previous TEXT,next TEXT,at TEXT);
      CREATE INDEX IF NOT EXISTS decision_events_target ON decision_events(id,target,at);`);
    if (
      !this.db
        .prepare("PRAGMA table_info(exclusions)")
        .all()
        .some((column) => column.name === "origin")
    ) {
      this.db.exec(
        "ALTER TABLE exclusions ADD COLUMN origin TEXT NOT NULL DEFAULT 'human'",
      );
    }
    if (
      !this.db
        .prepare("PRAGMA table_info(decisions)")
        .all()
        .some((column) => column.name === "canonical_id")
    ) {
      this.db.exec("ALTER TABLE decisions ADD COLUMN canonical_id TEXT");
    }
  }
  close() {
    this.db.close();
  }
  private decision(id: string, target: string): Decision | undefined {
    return this.db
      .prepare("SELECT * FROM exclusions WHERE id=? AND target=?")
      .get(id, target) as Decision | undefined;
  }
  private token(base: string, decision?: Decision) {
    return decision
      ? createHash("sha256")
          .update(JSON.stringify([base, decision.revision]))
          .digest("hex")
      : base;
  }
  private staleExclusion(
    decision: Decision | undefined,
    base: string | undefined,
  ) {
    return !!(
      decision?.active &&
      decision.origin === "ai" &&
      typeof base === "string" &&
      decision.base !== base
    );
  }
  private option(item: Classification): Classification {
    const decision = this.decision(item.conversationId, item.target);
    const stale = this.staleExclusion(decision, item.expected);
    const history = this.db
      .prepare(
        "SELECT previous,next,at FROM decision_events WHERE id=? AND target=? ORDER BY at DESC,rowid DESC LIMIT 10",
      )
      .all(item.conversationId, item.target)
      .map((row) => {
        const previous = JSON.parse(row.previous as string) as Classification;
        const next = JSON.parse(row.next as string) as {
          label: string;
          summary: string;
          origin?: Origin;
        };
        return {
          at: row.at as string,
          origin: next.origin ?? "human",
          before: previous.label,
          after: next.label,
          note: next.summary,
        };
      });
    return {
      ...item,
      expected: this.token(item.expected, decision),
      history: [...history, ...item.history]
        .sort((a, b) => b.at.localeCompare(a.at))
        .slice(0, 10),
      ...(decision?.active
        ? {
            label: "excluded" as const,
            summary: decision.summary,
            origin: decision.origin,
            stale,
          }
        : {}),
    };
  }
  private conversation(input: Conversation): Conversation {
    const conversation = structuredClone(input);
    for (const [target, evaluation] of Object.entries(
      conversation.evaluations,
    )) {
      const decision = this.decision(conversation.id, target);
      const base = evaluation.expected;
      const stale = this.staleExclusion(decision, base);
      if (evaluation.expected)
        evaluation.expected = this.token(evaluation.expected, decision);
      if (decision?.active)
        Object.assign(evaluation, {
          label: stale ? "unreviewed" : "excluded",
          summary: decision.summary,
          origin: decision.origin,
          stale,
          previous: stale ? { label: "excluded", origin: "ai" } : undefined,
        });
    }
    return conversation;
  }
  private dataset(dataset: Dataset): Dataset {
    return {
      ...dataset,
      conversations: dataset.conversations.map((item) =>
        this.conversation(item),
      ),
    };
  }
  async read() {
    return this.dataset(await this.source.read());
  }
  async refresh() {
    return this.dataset(await this.source.refresh());
  }
  async detail(id: string): Promise<Detail> {
    const detail = await this.source.detail(id);
    return { ...detail, conversation: this.conversation(detail.conversation) };
  }
  private async rawOptions(id: string) {
    return this.source.classificationOptions
      ? this.source.classificationOptions(id)
      : (await this.source.classifications()).filter(
          (item) => item.conversationId === id,
        );
  }
  async classificationOptions(id: string) {
    return (await this.rawOptions(id)).map((item) => this.option(item));
  }
  async classifications() {
    const items = await this.source.classifications();
    const known = new Set(items.map((item) => item.id));
    const missing = this.db
      .prepare("SELECT metadata FROM exclusions WHERE active=1")
      .all()
      .map((row) => JSON.parse(row.metadata as string) as Classification)
      .filter((item) => !known.has(item.id));
    if (missing.length) {
      const dataset = await this.source.read();
      for (const item of missing) {
        if (known.has(item.id)) continue;
        const conversation = dataset.conversations.find(
          (conversation) => conversation.id === item.conversationId,
        );
        const evaluation = conversation?.evaluations[item.target];
        if (conversation && evaluation?.expected) {
          known.add(item.id);
          items.push({
            ...item,
            label: evaluation.label,
            expected: evaluation.expected,
            room: conversation.room,
            at: conversation.at,
          });
        }
      }
    }
    return items.map((item) => this.option(item));
  }
  invalidate() {
    this.source.invalidate?.();
  }
  async requestStatus(requestId: string): Promise<{ state: string }> {
    const row = this.db
      .prepare("SELECT state FROM decisions WHERE request_id=?")
      .get(requestId);
    return { state: typeof row?.state === "string" ? row.state : "not_found" };
  }
  async correct(input: Correction): Promise<void> {
    const receipt = this.db
      .prepare("SELECT canonical_id FROM decisions WHERE request_id=?")
      .get(input.request_id);
    let canonicalId =
      typeof receipt?.canonical_id === "string"
        ? receipt.canonical_id
        : input.id;
    if (!receipt) {
      const raw = (await this.rawOptions(input.id)).find(
        (item) => item.target === input.service,
      );
      if (raw) canonicalId = raw.conversationId;
    }
    const key = JSON.stringify([canonicalId, input.service]);
    const previous = this.locks.get(key) || Promise.resolve();
    let release = () => {};
    const current = new Promise<void>((resolve) => {
      release = resolve;
    });
    this.locks.set(key, current);
    await previous;
    try {
      await this.save(input, canonicalId);
    } finally {
      release();
      if (this.locks.get(key) === current) this.locks.delete(key);
    }
  }
  private async validateAi(input: Correction, raw: Classification) {
    const unresolved = this.db
      .prepare(
        "SELECT 1 FROM decisions WHERE state IN ('saving','unknown') AND (canonical_id=? OR json_extract(payload,'$.id') IN (?,?)) AND json_extract(payload,'$.service')=? LIMIT 1",
      )
      .get(raw.conversationId, input.id, raw.conversationId, input.service);
    if (unresolved)
      throw new UpstreamError(
        "이전 분류 저장 결과가 불확실합니다. 자동으로 다시 판단하지 않습니다.",
        409,
      );
    const current = this.option(raw);
    if (
      raw.origin === "human" ||
      current.origin === "human" ||
      raw.history.some((event) => event.origin === "human") ||
      current.history.some((event) => event.origin === "human")
    )
      throw new UpstreamError(
        "사람이 검토한 분류는 AI가 변경할 수 없습니다.",
        409,
      );
    if (
      !input.summary.trim() ||
      !input.evidence ||
      input.evidence.length < 1 ||
      input.evidence.length > 5
    )
      throw new UpstreamError(
        "AI 분류에는 판단 이유와 원문 근거 1~5개가 필요합니다.",
        409,
      );
    const detail = await this.source.detail(input.id);
    if (
      detail.conversation.evaluations[input.service]?.origin === "human" ||
      detail.conversation.evaluations[input.service]?.previous?.origin ===
        "human"
    )
      throw new UpstreamError(
        "사람이 검토한 분류는 AI가 변경할 수 없습니다.",
        409,
      );
    const messages = new Map(
      detail.messages
        .filter(
          (message) =>
            !["unrelated", "ignored_noise"].includes(message.relation || ""),
        )
        .map((message) => [message.id, message.text]),
    );
    for (const evidence of input.evidence) {
      if (
        !evidence.quote ||
        evidence.quote.length > 2000 ||
        !messages.get(evidence.log_id)?.includes(evidence.quote)
      )
        throw new UpstreamError(
          "AI 분류 근거가 현재 원문과 일치하지 않습니다.",
          409,
        );
    }
    const checked = (await this.rawOptions(input.id)).find(
      (item) => item.target === input.service,
    );
    if (
      !checked ||
      checked.conversationId !== raw.conversationId ||
      detail.conversation.id !== raw.conversationId ||
      checked.expected !== raw.expected ||
      checked.origin === "human" ||
      this.option(checked).expected !== input.expected
    )
      throw new UpstreamError(
        "분류 또는 맥락이 변경됐습니다. 다시 검토해 주세요.",
        409,
      );
  }

  private async save(input: Correction, canonicalId: string): Promise<void> {
    const payload = JSON.stringify(input);
    const replay = this.db
      .prepare("SELECT payload,state FROM decisions WHERE request_id=?")
      .get(input.request_id);
    if (replay) {
      if (replay.payload !== payload)
        throw new UpstreamError("같은 요청 ID의 내용이 변경됐습니다.", 409);
      if (replay.state === "saved") return;
      throw new UpstreamError(
        "저장 결과를 확인하지 못했습니다. 새 요청으로 반복하지 마세요.",
        409,
      );
    }
    const raw = (await this.rawOptions(input.id)).find(
      (item) => item.target === input.service,
    );
    if (
      !raw ||
      raw.conversationId !== canonicalId ||
      this.option(raw).expected !== input.expected
    )
      throw new UpstreamError(
        "다른 화면에서 분류 또는 맥락이 변경됐습니다. 최신 내용을 확인해 주세요.",
        409,
      );
    const previous = this.decision(canonicalId, input.service);
    const previousEvaluation = this.option(raw);
    const origin = input.origin ?? "human";
    if (origin === "ai") await this.validateAi(input, raw);
    if (input.verdict !== "excluded" && !previous?.active && origin !== "ai") {
      await this.source.correct({ ...input, expected: raw.expected });
      return;
    }
    // Serialize local decisions and preserve a durable reservation before a
    // source restoration. Ambiguous restoration is never automatically retried.
    this.db
      .prepare(
        "INSERT INTO decisions(request_id,payload,state,at,canonical_id) VALUES (?,?,?,?,?)",
      )
      .run(
        input.request_id,
        payload,
        "saving",
        new Date().toISOString(),
        canonicalId,
      );
    try {
      if (input.verdict !== "excluded")
        await this.source.correct({ ...input, expected: raw.expected });
      if (input.verdict !== "excluded" && !previous?.active) {
        this.db
          .prepare("UPDATE decisions SET state='saved' WHERE request_id=?")
          .run(input.request_id);
        return;
      }
      this.db.exec("BEGIN IMMEDIATE");
      try {
        this.db
          .prepare(
            "INSERT INTO exclusions (id,target,active,revision,summary,base,metadata,origin) VALUES (?,?,?,?,?,?,?,?) ON CONFLICT(id,target) DO UPDATE SET active=excluded.active,revision=excluded.revision,summary=excluded.summary,base=excluded.base,metadata=excluded.metadata,origin=excluded.origin",
          )
          .run(
            canonicalId,
            input.service,
            input.verdict === "excluded" ? 1 : 0,
            (previous?.revision || 0) + 1,
            input.summary,
            raw.expected,
            JSON.stringify({
              ...raw,
              conversationId: canonicalId,
              summary: input.summary,
            }),
            origin,
          );
        this.db.prepare("INSERT INTO decision_events VALUES (?,?,?,?,?,?)").run(
          input.request_id,
          canonicalId,
          input.service,
          JSON.stringify(previousEvaluation),
          JSON.stringify({
            label: input.verdict,
            summary: input.summary,
            origin,
          }),
          new Date().toISOString(),
        );
        this.db
          .prepare("UPDATE decisions SET state='saved' WHERE request_id=?")
          .run(input.request_id);
        this.db.exec("COMMIT");
      } catch (error) {
        this.db.exec("ROLLBACK");
        throw error;
      }
    } catch (error) {
      this.db
        .prepare("UPDATE decisions SET state='unknown' WHERE request_id=?")
        .run(input.request_id);
      throw error;
    }
  }
}
