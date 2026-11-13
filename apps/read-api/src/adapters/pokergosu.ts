import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import {
  encodePokergosuCursor,
  type PokergosuCursor,
  type PokergosuReader,
  pokergosuScope,
} from "../../../../packages/application/src/pokergosu";
import type {
  PokergosuDetail,
  PokergosuImage,
  PokergosuListInput,
  PokergosuPage,
  PokergosuPost,
  PokergosuSummary,
} from "../../../../packages/contracts/src/pokergosu";
import { supportedPokergosuImage } from "../../../../packages/domain/src/pokergosu-media";

type Image = { url: string; alt?: string; width?: number; height?: number };
const image = (value: Image): PokergosuImage => ({
  key: createHash("sha256").update(value.url).digest("hex"),
  url: value.url,
  alt: value.alt || "",
  width: value.width || 0,
  height: value.height || 0,
  state: supportedPokergosuImage(value.url) ? "not_cached" : "unsupported",
});
type Comment = {
  images?: Image[];
  images_skipped?: number;
  id: string;
  text: string;
  author?: string;
  published_at?: string | null;
  has_media?: boolean;
  match?: { included?: string[]; eligible?: boolean };
};
type Payload = {
  images?: Image[];
  images_skipped?: number;
  title: string;
  body: string;
  author?: string;
  published_at?: string | null;
  comments: Comment[];
  eligible: boolean;
  match?: { included?: string[] };
  comment_coverage?: string;
  reported_comments?: number | null;
  skipped_comments?: unknown[];
  unavailable_comments?: number;
};
const blank = (): PokergosuSummary => ({
  available: false,
  discovered: 0,
  collected: 0,
  matched: 0,
  pending: 0,
  readErrors: 0,
  comments: 0,
  keywords: [],
  lastCheckedAt: null,
  monitor: null,
});
const keywords = (value: Payload) =>
  [
    ...new Set([
      ...(value.match?.included || []),
      ...value.comments.flatMap((c) => c.match?.included || []),
    ]),
  ].sort();
function post(id: string, value: Payload, checked: number): PokergosuPost {
  return {
    id,
    url: `https://www.pokergosu.com/free/${id}`,
    title: value.title,
    author: value.author || "",
    publishedAt: value.published_at || null,
    checkedAt: checked * 1000,
    excerpt: value.body.slice(0, 240),
    keywords: keywords(value),
    matched: value.eligible,
    commentCount: value.comments.length,
    matchedComments: value.comments.filter((c) => c.match?.eligible).length,
    imageCount:
      (value.images?.length || 0) +
      value.comments.reduce((n, c) => n + (c.images?.length || 0), 0),
  };
}
/** Opens only the independent public-board DB, never collector IPC or credentials. */
export class PokergosuSqliteReader implements PokergosuReader {
  constructor(private readonly filename: string) {}
  private read<T>(missing: T, work: (db: DatabaseSync) => T): T {
    if (!existsSync(this.filename)) return missing;
    const db = new DatabaseSync(this.filename, {
      readOnly: true,
      timeout: 1000,
    });
    try {
      db.exec("PRAGMA query_only=ON; BEGIN");
      return work(db);
    } finally {
      db.close();
    }
  }
  private summaryFrom(db: DatabaseSync): PokergosuSummary {
    const counts = db
      .prepare(
        `SELECT count(*) discovered, count(payload) collected, coalesce(sum(CASE WHEN eligible=1 THEN 1 ELSE 0 END),0) matched, coalesce(sum(json_array_length(payload,'$.comments')),0) comments, max(checked_at) lastChecked FROM threads`,
      )
      .get();
    if (!counts) throw new Error("Missing count result");
    // Keyword metadata is derived with SQL; list requests never decode all bodies.
    const terms = db
      .prepare(
        `SELECT DISTINCT value keyword FROM threads, json_each(payload,'$.match.included') WHERE payload IS NOT NULL UNION SELECT DISTINCT k.value keyword FROM threads t, json_each(t.payload,'$.comments') c, json_each(c.value,'$.match.included') k ORDER BY keyword`,
      )
      .all()
      .map((r) => String(r.keyword));
    const rawState = db
      .prepare("SELECT value FROM state WHERE key='extension_monitor'")
      .get();
    const state = rawState ? JSON.parse(String(rawState.value)) : null;
    const summary: PokergosuSummary = {
      available: true,
      discovered: Number(counts.discovered),
      collected: Number(counts.collected),
      matched: Number(counts.matched),
      pending: Number(counts.discovered) - Number(counts.collected),
      readErrors: db
        .prepare(
          "SELECT 1 FROM sqlite_master WHERE type='table' AND name='thread_read_errors'",
        )
        .get()
        ? Number(
            db.prepare("SELECT count(*) n FROM thread_read_errors").get()?.n ||
              0,
          )
        : 0,
      comments: Number(counts.comments),
      keywords: terms,
      lastCheckedAt:
        counts.lastChecked == null ? null : Number(counts.lastChecked) * 1000,
      monitor: state
        ? {
            status: state.status,
            phase: state.phase,
            reason: state.reason || null,
            nextAt: state.nextAt,
            discoveryGaps: state.discoveryGaps || 0,
          }
        : null,
    };
    return summary;
  }
  async summary(): Promise<PokergosuSummary> {
    return this.read(blank(), (db) => this.summaryFrom(db));
  }
  async list(
    input: PokergosuListInput,
    cursor?: PokergosuCursor,
  ): Promise<PokergosuPage> {
    return this.read<PokergosuPage>(
      { items: [], nextCursor: null, total: 0, summary: blank() },
      (db) => {
        const summary = this.summaryFrom(db);
        const where = ["t.payload IS NOT NULL"],
          values: (string | number)[] = [];
        if (input.match === "matched") where.push("t.eligible=1");
        if (input.day) {
          where.push("date(t.checked_at,'unixepoch','+9 hours')=?");
          values.push(input.day);
        }
        if (input.q) {
          where.push(
            "(instr(lower(json_extract(t.payload,'$.title') || char(10) || json_extract(t.payload,'$.body')),lower(?))>0 OR EXISTS(SELECT 1 FROM json_each(t.payload,'$.comments') c WHERE instr(lower(json_extract(c.value,'$.text')),lower(?))>0))",
          );
          values.push(input.q, input.q);
        }
        if (input.keyword) {
          where.push(
            "(EXISTS(SELECT 1 FROM json_each(t.payload,'$.match.included') k WHERE k.value=?) OR EXISTS(SELECT 1 FROM json_each(t.payload,'$.comments') c, json_each(c.value,'$.match.included') k WHERE k.value=?))",
          );
          values.push(input.keyword, input.keyword);
        }
        const ceiling =
          cursor?.ceiling ||
          String(
            db
              .prepare(
                `SELECT t.id FROM threads t WHERE ${where.join(" AND ")} ORDER BY length(t.id) DESC,t.id DESC LIMIT 1`,
              )
              .get(...values)?.id || "1",
          );
        where.push(
          "(length(t.id)<length(?) OR (length(t.id)=length(?) AND t.id<=?))",
        );
        values.push(ceiling, ceiling, ceiling);
        const total = Number(
          db
            .prepare(
              `SELECT count(*) n FROM threads t WHERE ${where.join(" AND ")}`,
            )
            .get(...values)?.n ?? 0,
        );
        if (cursor) {
          where.push(
            "(length(t.id)<length(?) OR (length(t.id)=length(?) AND t.id<?))",
          );
          values.push(cursor.last, cursor.last, cursor.last);
        }
        // Only the bounded page's payloads are decoded; excerpts omit full comments.
        const rows = db
          .prepare(
            `SELECT t.id,t.payload,t.checked_at FROM threads t WHERE ${where.join(" AND ")} ORDER BY length(t.id) DESC,t.id DESC LIMIT ?`,
          )
          .all(...values, input.limit + 1);
        const items = rows
          .slice(0, input.limit)
          .map((r) =>
            post(
              String(r.id),
              JSON.parse(String(r.payload)),
              Number(r.checked_at),
            ),
          );
        const last = items.at(-1);
        return {
          items,
          total,
          summary,
          nextCursor:
            rows.length > input.limit && last
              ? encodePokergosuCursor({
                  last: last.id,
                  ceiling,
                  scope: pokergosuScope(input),
                })
              : null,
        };
      },
    );
  }
  async detail(id: string): Promise<PokergosuDetail | null> {
    return this.read<PokergosuDetail | null>(null, (db) => {
      const row = db
        .prepare(
          "SELECT payload,checked_at FROM threads WHERE id=? AND payload IS NOT NULL",
        )
        .get(id);
      if (!row) return null;
      const value: Payload = JSON.parse(String(row.payload));
      return {
        post: post(id, value, Number(row.checked_at)),
        body: value.body,
        images: (value.images || []).map(image),
        imagesSkipped: value.images_skipped || 0,
        comments: value.comments.slice(0, 100).map((c) => ({
          id: c.id,
          images: (c.images || []).map(image),
          imagesSkipped: c.images_skipped || 0,
          text: c.text,
          author: c.author || "",
          publishedAt: c.published_at || null,
          hasMedia: !!c.has_media,
          keywords: c.match?.included || [],
        })),
        commentsLimited: value.comments.length > 100,
        coverage: value.comment_coverage || "unknown",
        reportedComments: value.reported_comments ?? null,
        skippedComments: value.skipped_comments?.length || 0,
        unavailableComments: value.unavailable_comments || 0,
      };
    });
  }
}
