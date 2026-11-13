import { randomUUID } from "node:crypto";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { ForumOpinions } from "../apps/read-api/src/adapters/forum-opinions";
import { PokergosuSqliteReader } from "../apps/read-api/src/adapters/pokergosu";
import type { KeywordPolicy } from "../packages/contracts/src/keyword-policy";
import { pokergosuFixture } from "./pokergosu-fixture";

const policy: KeywordPolicy = {
  version: 1,
  keywords: ["APL", "룰루"],
  keyword_groups: [
    { id: "apl", name: "APL", kind: "event", keywords: ["APL"] },
    { id: "lulu", name: "포커룰루", kind: "service", keywords: ["룰루"] },
  ],
  sources: { kakao: { disabled: [] }, pokergosu: { disabled: [] } },
};
function setup() {
  const fixture = pokergosuFixture();
  const reader = new PokergosuSqliteReader(fixture.filename);
  const opinions = new ForumOpinions(
    path.join(path.dirname(fixture.filename), "reviews.sqlite3"),
    reader,
    { read: async () => ({ policy, token: "test", supported: true }) },
  );
  return {
    fixture,
    reader,
    opinions,
    close() {
      opinions.close();
      fixture.close();
    },
  };
}
describe("retained forum context reviews", () => {
  it("never treats retained but unclassified posts as neutral, counts comment-only targets", async () => {
    const f = setup();
    try {
      const result = await f.opinions.summary({ day: "", target: "" });
      expect(result.units).toBe(13);
      expect(
        result.targets.find((t) => t.id === "lulu")?.counts.unreviewed,
      ).toBe(1);
      expect(result.targets.find((t) => t.id === "apl")?.counts.neutral).toBe(
        0,
      );
    } finally {
      f.close();
    }
  });
  it("preserves idempotence, prevents concurrent memo loss and AI overwrite of human review", async () => {
    const f = setup();
    try {
      const detail = await f.reader.detail("24");
      if (!detail) throw Error();
      const [item] = await f.opinions.options(detail);
      const input = {
        id: "24",
        service: "APL",
        verdict: "positive" as const,
        summary: "가격이 저렴하다는 의견",
        expected: item.expected,
        request_id: randomUUID(),
        origin: "human" as const,
      };
      expect(await f.opinions.save(input)).toEqual(
        await f.opinions.save(input),
      );
      await expect(
        f.opinions.save({
          ...input,
          summary: "다른 메모",
          request_id: randomUUID(),
        }),
      ).rejects.toThrow("변경");
      const [current] = await f.opinions.options(detail);
      await expect(
        f.opinions.save({
          ...input,
          origin: "ai",
          expected: current.expected,
          request_id: randomUUID(),
        }),
      ).rejects.toThrow("사람");
      expect(
        (await f.opinions.summary({ day: "", target: "APL" })).targets[0].counts
          .positive,
      ).toBe(1);
    } finally {
      f.close();
    }
  });
  it("invalidates a verdict when the saved source context changes", async () => {
    const f = setup();
    try {
      const detail = await f.reader.detail("24");
      if (!detail) throw Error();
      const [item] = await f.opinions.options(detail);
      await f.opinions.save({
        id: "24",
        service: "APL",
        verdict: "negative",
        summary: "운영 불만",
        expected: item.expected,
        request_id: randomUUID(),
        origin: "ai",
      });
      const row = f.fixture.db
        .prepare("SELECT payload FROM threads WHERE id='24'")
        .get();
      const payload = JSON.parse(String(row?.payload));
      payload.body += "새 댓글 맥락";
      f.fixture.db
        .prepare("UPDATE threads SET payload=? WHERE id='24'")
        .run(JSON.stringify(payload));
      const next = await f.reader.detail("24");
      if (!next) throw Error();
      expect((await f.opinions.options(next))[0].stale).toBe(true);
    } finally {
      f.close();
    }
  });
  it("uses Korean publication dates, excludes undated posts for dated queries", async () => {
    const f = setup();
    try {
      expect(
        (await f.opinions.summary({ day: "2026-11-12", target: "" })).units,
      ).toBe(13);
      expect(
        (await f.opinions.summary({ day: "2026-11-13", target: "" })).units,
      ).toBe(0);
    } finally {
      f.close();
    }
  });
});
