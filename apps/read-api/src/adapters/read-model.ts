import { chmodSync, mkdirSync } from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import type {
  MonitoringProjection,
  MonitoringReader,
} from "../../../../packages/application/src/ports";
import {
  cursorKey,
  InvalidCursor,
} from "../../../../packages/application/src/queries";
import type {
  ListInput,
  Metadata,
  OverviewPayload,
  Page,
} from "../../../../packages/contracts/src/api";
import {
  type Conversation,
  type Dataset,
  koreanDay,
  reviewState,
  type Scope,
  summarize,
} from "../../../../packages/domain/src/model";

// This is a rebuildable public projection, never a connection to the collector DB.
export class MonitoringReadModel implements MonitoringProjection {
  private db: DatabaseSync;
  private flight?: Promise<void>;
  constructor(
    private readonly reader: MonitoringReader,
    filename: string,
  ) {
    if (filename !== ":memory:")
      mkdirSync(path.dirname(filename), { recursive: true, mode: 0o700 });
    this.db = new DatabaseSync(filename);
    if (filename !== ":memory:") chmodSync(filename, 0o600);
    this.db.exec(`
      PRAGMA journal_mode=DELETE;
      CREATE TABLE IF NOT EXISTS info (key TEXT PRIMARY KEY, value TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS summaries (day TEXT, target TEXT, body TEXT NOT NULL, PRIMARY KEY(day,target));
      CREATE TABLE IF NOT EXISTS conversations (id TEXT PRIMARY KEY, at REAL NOT NULL, day TEXT NOT NULL, body TEXT NOT NULL);
      CREATE INDEX IF NOT EXISTS conversations_order ON conversations(at DESC,id DESC);
      CREATE INDEX IF NOT EXISTS conversations_day ON conversations(day,at DESC,id DESC);
      CREATE TABLE IF NOT EXISTS labels (id TEXT, target TEXT, label TEXT NOT NULL, PRIMARY KEY(id,target));
      CREATE INDEX IF NOT EXISTS labels_scope ON labels(target,label,id);
      CREATE INDEX IF NOT EXISTS labels_verdict ON labels(label,id);
    `);
    const columns = this.db.prepare("PRAGMA table_info(labels)").all();
    if (!columns.some((column) => column.name === "review_state"))
      this.db.exec(
        "ALTER TABLE labels ADD COLUMN review_state TEXT NOT NULL DEFAULT 'unclassified'",
      );
    this.db.exec(
      "CREATE INDEX IF NOT EXISTS labels_state ON labels(review_state,target,id)",
    );
  }
  private value<T>(key: string): T | undefined {
    const row = this.db.prepare("SELECT value FROM info WHERE key=?").get(key);
    return row ? JSON.parse(row.value as string) : undefined;
  }
  private required<T>(key: string): T {
    const value = this.value<T>(key);
    if (value === undefined) throw new Error("Read model is not initialized");
    return value;
  }
  private async ready() {
    if (!this.value("capturedAt") || this.value("projectionVersion") !== 7)
      await this.refresh();
  }
  async info() {
    await this.ready();
    return {
      capturedAt: this.required<string>("capturedAt"),
      source: this.required<Dataset["source"]>("source"),
    };
  }
  async refresh(fresh = false): Promise<void> {
    if (fresh && this.flight) await this.flight.catch(() => {});
    if (this.flight) return this.flight;
    this.flight = (async () => this.replace(await this.reader.refresh()))();
    try {
      await this.flight;
    } finally {
      this.flight = undefined;
    }
  }
  replace(dataset: Dataset) {
    // Partition once; grouping, sentiment counts and highlight selection never run in a page request.
    const days = new Map<string, Conversation[]>();
    for (const conversation of dataset.conversations) {
      const day = koreanDay(conversation.at);
      if (!days.has(day)) days.set(day, []);
      days.get(day)?.push(conversation);
    }
    const metadata: Metadata = {
      targets: dataset.targets.map(({ name, aliases }) => ({ name, aliases })),
      days: [...days.keys()].sort().reverse(),
      source: dataset.source,
    };
    const summaries: [string, string, string][] = [];
    for (const [day, conversations] of [
      ["", dataset.conversations],
      ...days,
    ] as [string, Conversation[]][]) {
      const partition = { ...dataset, conversations };
      for (const target of ["", ...dataset.targets.map((t) => t.name)]) {
        summaries.push([
          day,
          target,
          JSON.stringify(summarize(partition, { day: "", target })),
        ]);
      }
    }
    this.db.exec("BEGIN IMMEDIATE");
    try {
      this.db.exec(
        "DELETE FROM summaries; DELETE FROM labels; DELETE FROM conversations; DELETE FROM info;",
      );
      const summary = this.db.prepare("INSERT INTO summaries VALUES(?,?,?)");
      for (const row of summaries) summary.run(...row);
      const insert = this.db.prepare(
        "INSERT INTO conversations VALUES(?,?,?,?)",
      );
      const label = this.db.prepare(
        "INSERT INTO labels(id,target,label,review_state) VALUES(?,?,?,?)",
      );
      for (const c of dataset.conversations) {
        insert.run(c.id, c.at, koreanDay(c.at), JSON.stringify(c));
        for (const target of c.targets) {
          const e = c.evaluations[target];
          label.run(
            c.id,
            target,
            e ? (e.stale ? "unreviewed" : e.label) : "unreviewed",
            reviewState(e),
          );
        }
      }
      const info = this.db.prepare("INSERT INTO info VALUES(?,?)");
      for (const [key, value] of Object.entries({
        projectionVersion: 7,
        capturedAt: dataset.capturedAt,
        source: dataset.source,
        metadata,
        empty: summarize(
          { ...dataset, conversations: [] },
          { day: "", target: "" },
        ),
      }))
        info.run(key, JSON.stringify(value));
      this.db.exec("COMMIT");
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }
  async overview(scope: Scope): Promise<OverviewPayload> {
    await this.ready();
    const row = this.db
      .prepare("SELECT body FROM summaries WHERE day=? AND target=?")
      .get(scope.day, scope.target);
    const overview = row
      ? JSON.parse(row.body as string)
      : this.required<OverviewPayload["overview"]>("empty");
    if (!row && scope.target)
      overview.targets = overview.targets.filter(
        (t: { name: string }) => t.name === scope.target,
      );
    return { overview, metadata: this.required<Metadata>("metadata") };
  }
  async conversations(input: ListInput): Promise<Page<Conversation>> {
    await this.ready();
    const conditions: string[] = [],
      params: (string | number)[] = [];
    if (input.day) {
      conditions.push("c.day=?");
      params.push(input.day);
    }
    if (input.target || input.label || input.status) {
      const filters = ["l.id=c.id"];
      if (input.target) {
        filters.push("l.target=?");
        params.push(input.target);
      }
      if (input.label) {
        filters.push("l.label=?");
        params.push(input.label);
      }
      if (input.status === "pending")
        filters.push("l.review_state IN ('unclassified','recheck')");
      else if (input.status) {
        filters.push("l.review_state=?");
        params.push(input.status);
      }
      conditions.push(
        `EXISTS(SELECT 1 FROM labels l WHERE ${filters.join(" AND ")})`,
      );
    }
    const where = () =>
      conditions.length ? ` WHERE ${conditions.join(" AND ")}` : "";
    const total = Number(
      this.db
        .prepare(`SELECT count(*) AS n FROM conversations c${where()}`)
        .get(...params)?.n,
    );
    if (input.cursor) {
      try {
        const cursor = JSON.parse(
          Buffer.from(input.cursor, "base64url").toString(),
        );
        if (
          !Number.isFinite(cursor.at) ||
          typeof cursor.id !== "string" ||
          cursor.scope !== cursorKey(input)
        )
          throw Error();
        conditions.push("(c.at, c.id) < (?, ?)");
        params.push(cursor.at, cursor.id);
      } catch {
        throw new InvalidCursor(
          "이 조건에 맞지 않는 페이지입니다. 처음부터 다시 조회해 주세요.",
        );
      }
    }
    const rows = this.db
      .prepare(
        `SELECT body FROM conversations c${where()} ORDER BY c.at DESC,c.id DESC LIMIT ?`,
      )
      .all(...params, input.limit + 1);
    const items = rows
      .slice(0, input.limit)
      .map((row) => JSON.parse(row.body as string) as Conversation);
    const last = items.at(-1);
    return {
      items,
      total,
      nextCursor:
        rows.length > input.limit && last
          ? Buffer.from(
              JSON.stringify({
                at: last.at,
                id: last.id,
                scope: cursorKey(input),
              }),
            ).toString("base64url")
          : null,
      ...(await this.info()),
    };
  }
  close() {
    this.db.close();
  }
}
