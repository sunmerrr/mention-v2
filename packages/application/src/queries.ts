import { createHash } from "node:crypto";
import type {
  Classification,
  ListInput,
  Metadata,
  Page,
} from "../../contracts/src/api";
import type { Conversation, Dataset, Scope } from "../../domain/src/model";
import {
  koreanDay,
  scopedConversations,
  summarize,
} from "../../domain/src/model";
import type { MonitoringReader } from "./ports";
export class InvalidCursor extends Error {}
function cursorKey(input: ListInput): string {
  return createHash("sha256")
    .update(JSON.stringify([input.day, input.target, input.label]))
    .digest("hex")
    .slice(0, 16);
}
function paginate<T extends { id: string; at: number }>(
  items: T[],
  input: ListInput,
  capturedAt: string,
  source: Dataset["source"],
): Page<T> {
  const sorted = [...items].sort(
    (a, b) => b.at - a.at || b.id.localeCompare(a.id),
  );
  let remaining = sorted;
  if (input.cursor) {
    let decoded: { at: number; id: string; scope: string };
    try {
      decoded = JSON.parse(Buffer.from(input.cursor, "base64url").toString());
      if (
        !Number.isFinite(decoded.at) ||
        typeof decoded.id !== "string" ||
        decoded.scope !== cursorKey(input)
      )
        throw Error();
    } catch {
      throw new InvalidCursor(
        "이 조건에 맞지 않는 페이지입니다. 처음부터 다시 조회해 주세요.",
      );
    }
    remaining = sorted.filter(
      (i) =>
        i.at < decoded.at ||
        (i.at === decoded.at && i.id.localeCompare(decoded.id) < 0),
    );
  }
  const page = remaining.slice(0, input.limit),
    last = page.at(-1);
  const nextCursor =
    remaining.length > input.limit && last
      ? Buffer.from(
          JSON.stringify({ at: last.at, id: last.id, scope: cursorKey(input) }),
        ).toString("base64url")
      : null;
  return { items: page, nextCursor, total: sorted.length, capturedAt, source };
}
export class MonitoringQueries {
  constructor(private readonly reader: MonitoringReader) {}
  async overview(scope: Scope) {
    const dataset = await this.reader.read();
    return {
      overview: summarize(dataset, scope),
      metadata: this.metadata(dataset),
    };
  }
  async conversations(input: ListInput): Promise<Page<Conversation>> {
    const data = await this.reader.read();
    const items = scopedConversations(data, input).filter(
      (c) =>
        !input.label ||
        Object.entries(c.evaluations).some(
          ([target, e]) =>
            (!input.target || target === input.target) &&
            (e.stale ? "unreviewed" : e.label) === input.label,
        ),
    );
    return paginate(items, input, data.capturedAt, data.source);
  }
  async classifications(input: ListInput): Promise<Page<Classification>> {
    const items = await this.reader.classifications(),
      data = await this.reader.read();
    return paginate(
      items.filter(
        (i) =>
          (!input.day || koreanDay(i.at) === input.day) &&
          (!input.target || i.target === input.target) &&
          (!input.label || i.label === input.label),
      ),
      input,
      data.capturedAt,
      data.source,
    );
  }
  detail(id: string) {
    return this.reader.detail(id);
  }
  refresh() {
    return this.reader.refresh();
  }
  private metadata(data: Dataset): Metadata {
    return {
      targets: data.targets.map((t) => ({ name: t.name, aliases: t.aliases })),
      days: [...new Set(data.conversations.map((c) => koreanDay(c.at)))]
        .sort()
        .reverse(),
      source: data.source,
    };
  }
}
