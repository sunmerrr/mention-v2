import { createHash } from "node:crypto";
import { chmodSync, mkdirSync } from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import type { PokergosuReader } from "../../../../packages/application/src/pokergosu";
import type { Classification } from "../../../../packages/contracts/src/api";
import type {
  ForumCorrection,
  ForumEvaluation,
} from "../../../../packages/contracts/src/forum-opinions";
import type { KeywordPolicy } from "../../../../packages/contracts/src/keyword-policy";
import { sourceKeywords } from "../../../../packages/contracts/src/keyword-policy";
import type { PokergosuDetail } from "../../../../packages/contracts/src/pokergosu";
import type { Scope } from "../../../../packages/domain/src/model";
import {
  emptyOpinionCounts,
  type SourceOpinion,
} from "../../../../packages/domain/src/source-opinions";
import { koreanDay } from "../../../../packages/domain/src/time";
import type { KeywordPolicies } from "./keyword-policies";

class ReviewConflict extends Error {
  readonly statusCode = 409;
}
type Stored = {
  target_id: string;
  post_id: string;
  label: Classification["label"];
  summary: string;
  origin: "ai" | "human";
  evidence: string;
  revision: number;
  at: number;
};
const hash = (value: unknown) =>
  createHash("sha256").update(JSON.stringify(value)).digest("hex");
const publishedTime = (value: string | null) =>
  value
    ? Date.parse(
        /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(value)
          ? value.replace(" ", "T") + "+09:00"
          : value,
      )
    : NaN;
const identity = (word: string) =>
  word
    .normalize("NFKC")
    .toLocaleLowerCase()
    .replace(/[\s._-]+/g, "");
function targets(detail: PokergosuDetail, policy: KeywordPolicy) {
  const active = new Set(sourceKeywords(policy, "pokergosu").map(identity));
  const hits = new Set(
    detail.post.keywords
      .filter((word) => active.has(identity(word)))
      .map(identity),
  );
  return policy.keyword_groups.filter((g) =>
    g.keywords.some((word) => hits.has(identity(word))),
  );
}
function evidence(
  detail: PokergosuDetail,
  targetId: string,
  policy: KeywordPolicy,
) {
  const target = policy.keyword_groups.find((g) => g.id === targetId);
  return hash([
    targetId,
    target?.keywords.filter((w) =>
      detail.post.keywords.some((word) => identity(word) === identity(w)),
    ),
    detail.post.title,
    detail.post.author,
    detail.post.publishedAt,
    detail.body,
    detail.images.map((i) => i.url),
    detail.comments.map((c) => [
      c.id,
      c.author,
      c.publishedAt,
      c.text,
      c.images.map((i) => i.url),
    ]),
    detail.coverage,
    detail.commentsLimited,
    detail.skippedComments,
    detail.unavailableComments,
  ]);
}
export class ForumOpinions {
  private db: DatabaseSync;
  private cache = new Map<
    string,
    { at: number; value: Promise<SourceOpinion> }
  >();
  constructor(
    filename: string,
    private readonly reader: PokergosuReader,
    private readonly policies: Pick<KeywordPolicies, "read">,
  ) {
    mkdirSync(path.dirname(filename), { recursive: true, mode: 0o700 });
    this.db = new DatabaseSync(filename, { timeout: 1000 });
    chmodSync(filename, 0o600);
    this.db.exec(`PRAGMA journal_mode=WAL;
  CREATE TABLE IF NOT EXISTS reviews(post_id TEXT,target_id TEXT,label TEXT,summary TEXT,origin TEXT,evidence TEXT,revision INTEGER,at INTEGER,PRIMARY KEY(post_id,target_id));
  CREATE TABLE IF NOT EXISTS receipts(request_id TEXT PRIMARY KEY,payload_hash TEXT,post_id TEXT,target_id TEXT,result TEXT);
  CREATE TABLE IF NOT EXISTS review_history(request_id TEXT PRIMARY KEY,post_id TEXT,target_id TEXT,previous TEXT,next TEXT,at INTEGER);`);
  }
  close() {
    this.db.close();
  }
  private stored(id: string, target: string) {
    return this.db
      .prepare("SELECT * FROM reviews WHERE post_id=? AND target_id=?")
      .get(id, target) as Stored | undefined;
  }
  private option(
    detail: PokergosuDetail,
    target: KeywordPolicy["keyword_groups"][number],
    policy: KeywordPolicy,
  ): ForumEvaluation {
    const row = this.stored(detail.post.id, target.id),
      signature = evidence(detail, target.id, policy),
      stale = !!row && row.evidence !== signature;
    return {
      id: detail.post.id + ":" + target.id,
      conversationId: detail.post.id,
      targetId: target.id,
      target: target.name,
      label: row?.label || "unreviewed",
      summary: row?.summary || "",
      origin: row?.origin || null,
      stale,
      expected: hash([
        signature,
        row?.revision || 0,
        row?.label || "unreviewed",
        row?.summary || "",
        row?.origin || null,
      ]),
      room: "포커고수 자유게시판",
      at: publishedTime(detail.post.publishedAt) || detail.post.checkedAt,
      history: [],
    };
  }
  async options(detail: PokergosuDetail) {
    const { policy } = await this.policies.read();
    return targets(detail, policy).map((target) =>
      this.option(detail, target, policy),
    );
  }
  async save(input: ForumCorrection) {
    const payloadHash = hash(input),
      receipt = this.db
        .prepare("SELECT * FROM receipts WHERE request_id=?")
        .get(input.request_id);
    if (receipt) {
      if (receipt.payload_hash !== payloadHash)
        throw new ReviewConflict("같은 요청 ID의 내용이 달라졌습니다.");
      return JSON.parse(String(receipt.result));
    }
    const [detail, { policy }] = await Promise.all([
      this.reader.detail(input.id),
      this.policies.read(),
    ]);
    const target =
      detail && targets(detail, policy).find((t) => t.name === input.service);
    if (!detail || !target)
      throw new ReviewConflict(
        "수집 내용이나 대상 키워드가 변경됐습니다. 새로고침해 주세요.",
      );
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const duplicate = this.db
        .prepare("SELECT * FROM receipts WHERE request_id=?")
        .get(input.request_id);
      if (duplicate) {
        if (duplicate.payload_hash !== payloadHash)
          throw new ReviewConflict("요청 내용이 달라졌습니다.");
        this.db.exec("COMMIT");
        return JSON.parse(String(duplicate.result));
      }
      const current = this.option(detail, target, policy),
        previous = this.stored(input.id, target.id);
      if (current.expected !== input.expected)
        throw new ReviewConflict(
          "분류나 맥락이 변경됐습니다. 새로고침 후 다시 선택해 주세요.",
        );
      if (input.origin === "ai" && previous?.origin === "human")
        throw new ReviewConflict(
          "사람이 수정한 분류는 자동으로 덮어쓰지 않습니다.",
        );
      const next = {
        post_id: input.id,
        target_id: target.id,
        label: input.verdict,
        summary: input.summary,
        origin: input.origin,
        evidence: evidence(detail, target.id, policy),
        revision: (previous?.revision || 0) + 1,
        at: Date.now(),
      };
      this.db
        .prepare("INSERT OR REPLACE INTO reviews VALUES (?,?,?,?,?,?,?,?)")
        .run(
          next.post_id,
          next.target_id,
          next.label,
          next.summary,
          next.origin,
          next.evidence,
          next.revision,
          next.at,
        );
      this.db
        .prepare("INSERT INTO review_history VALUES (?,?,?,?,?,?)")
        .run(
          input.request_id,
          input.id,
          target.id,
          JSON.stringify(previous || null),
          JSON.stringify(next),
          next.at,
        );
      const result = { saved: true, request_id: input.request_id };
      this.db
        .prepare("INSERT INTO receipts VALUES (?,?,?,?,?)")
        .run(
          input.request_id,
          payloadHash,
          input.id,
          target.id,
          JSON.stringify(result),
        );
      this.db.exec("COMMIT");
      this.cache.clear();
      return result;
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }
  async summary(scope: Scope): Promise<SourceOpinion> {
    const settings = await this.policies.read();
    const key = hash([scope, settings.policy]);
    const cached = this.cache.get(key);
    if (cached && Date.now() - cached.at < 10000) return cached.value;
    const value = this.build(scope);
    this.cache.set(key, { at: Date.now(), value });
    if (this.cache.size > 32) {
      const oldest = this.cache.keys().next().value;
      if (oldest) this.cache.delete(oldest);
    }
    try {
      return await value;
    } catch (error) {
      this.cache.delete(key);
      throw error;
    }
  }
  private async build(scope: Scope): Promise<SourceOpinion> {
    const { policy } = await this.policies.read();
    const result: SourceOpinion = {
      units: 0,
      available: true,
      undated: 0,
      targets: policy.keyword_groups
        .filter((g) => !scope.target || scope.target === g.name)
        .map((g) => ({
          id: g.id,
          name: g.name,
          counts: emptyOpinionCounts(),
          units: 0,
        })),
      evidence: [],
    };
    let cursor: string | undefined;
    do {
      const page = await this.reader.list(
        { q: "", keyword: "", day: "", match: "matched", limit: 50 },
        cursor
          ? JSON.parse(Buffer.from(cursor, "base64url").toString())
          : undefined,
      );
      result.available = page.summary.available;
      // Reuse the source reader's bounded keyset pages; only retained matches are decoded.
      for (const post of page.items) {
        const stamp = post.publishedAt ? publishedTime(post.publishedAt) : NaN;
        if (!Number.isFinite(stamp)) result.undated++;
        if (
          scope.day &&
          (!Number.isFinite(stamp) || koreanDay(stamp) !== scope.day)
        )
          continue;
        const detail = await this.reader.detail(post.id);
        if (!detail) continue;
        const relevant = targets(detail, policy).filter(
          (t) => !scope.target || t.name === scope.target,
        );
        if (!relevant.length) continue;
        result.units++;
        for (const target of relevant) {
          const row = result.targets.find((t) => t.id === target.id);
          if (!row) continue;
          const option = this.option(detail, target, policy);
          const label = option.stale ? "unreviewed" : option.label;
          row.units++;
          row.counts[label]++;
          if (
            !["unreviewed", "excluded", "uncertain"].includes(label) &&
            option.summary.trim()
          )
            result.evidence.push({
              id: post.id,
              target: target.name,
              label,
              summary: option.summary,
              href: "/posts/" + post.id,
              title: post.title,
              at: Number.isFinite(stamp) ? stamp : post.checkedAt,
            });
        }
      }
      cursor = page.nextCursor || undefined;
    } while (cursor);
    result.evidence.sort((a, b) => b.at - a.at || b.id.localeCompare(a.id));
    result.evidence = result.evidence.slice(0, 24);
    return result;
  }
}
