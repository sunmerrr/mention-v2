import { describe, expect, it } from "vitest";
import { MonitoringQueries } from "../packages/application/src/queries";
import { listSchema } from "../packages/contracts/src/api";
import { summarize } from "../packages/domain/src/model";
import { FakeReader } from "./fakes";

describe("read contracts", () => {
  it("does not classify unknown as neutral or mix one target with another", () => {
    const reader = new FakeReader();
    const overview = summarize(reader.data, { day: "", target: "샘플 B" });
    expect(overview.classified).toBe(0);
    expect(overview.targets[0].counts.neutral).toBe(0);
    expect(overview.unclassified).toBe(29);
  });
  it("excludes stale evaluations from confirmed counts", () => {
    const r = new FakeReader();
    r.data.conversations[0].evaluations["샘플 A"].stale = true;
    const o = summarize(r.data, { day: "", target: "샘플 A" });
    expect(o.targets[0].counts.positive).toBe(4);
    expect(o.targets[0].counts.unreviewed).toBe(5);
  });
  it("traverses tied timestamps without missing or duplicating items", async () => {
    const query = new MonitoringQueries(new FakeReader());
    const ids: string[] = [];
    let cursor: string | undefined;
    do {
      const page = await query.conversations(
        listSchema.parse({ limit: 7, cursor }),
      );
      ids.push(...page.items.map((i) => i.id));
      cursor = page.nextCursor || undefined;
    } while (cursor);
    expect(ids).toHaveLength(29);
    expect(new Set(ids).size).toBe(29);
  });
  it("binds cursors to filters and rejects malformed cursors", async () => {
    const query = new MonitoringQueries(new FakeReader());
    const page = await query.conversations(listSchema.parse({ limit: 2 }));
    await expect(
      query.conversations(
        listSchema.parse({ target: "샘플 A", cursor: page.nextCursor }),
      ),
    ).rejects.toThrow();
    await expect(
      query.conversations(listSchema.parse({ cursor: "garbage" })),
    ).rejects.toThrow();
  });
  it("returns only a capped page with no context transcripts", async () => {
    const query = new MonitoringQueries(new FakeReader());
    const p = await query.conversations(listSchema.parse({ limit: 12 }));
    expect(p.items).toHaveLength(12);
    expect(p.items[0]).not.toHaveProperty("messages");
    expect(
      JSON.stringify(await query.overview({ day: "", target: "" })),
    ).not.toContain("합성 발언");
    expect(() => listSchema.parse({ limit: 1000 })).toThrow();
  });
});
