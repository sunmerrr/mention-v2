import Fastify from "fastify";
import { afterEach, expect, it } from "vitest";
import { PokergosuSqliteReader } from "../apps/read-api/src/adapters/pokergosu";
import { registerPokergosu } from "../apps/read-api/src/pokergosu-routes";
import { registerApi } from "../apps/read-api/src/routes";
import { render } from "../apps/web/src/entry-server";
import { PokergosuQueries } from "../packages/application/src/pokergosu";
import { MonitoringQueries } from "../packages/application/src/queries";
import { pokergosuListSchema } from "../packages/contracts/src/pokergosu";
import { FakeReader } from "./fakes";
import { pokergosuFixture } from "./pokergosu-fixture";

const fixtures: ReturnType<typeof pokergosuFixture>[] = [];
afterEach(() => {
  for (const f of fixtures.splice(0)) f.close();
});
function fixture() {
  const f = pokergosuFixture();
  fixtures.push(f);
  return {
    ...f,
    queries: new PokergosuQueries(new PokergosuSqliteReader(f.filename)),
  };
}
const input = (values: Record<string, unknown> = {}) =>
  pokergosuListSchema.parse(values);
it("returns bounded previews, distinct discovery/read totals and no private runtime state", async () => {
  const f = fixture(),
    before = f.db.prepare("SELECT count(*) n FROM state").get();
  const page = await f.queries.list(input({ limit: 5 }));
  expect(page.items.map((p) => p.id)).toEqual(["25", "24", "23", "22", "21"]);
  expect(page.summary).toMatchObject({
    available: true,
    discovered: 27,
    collected: 25,
    pending: 2,
    comments: 50,
    matched: 13,
    keywords: ["APL", "룰루"],
  });
  expect(page.total).toBe(25);
  expect(page.nextCursor).toBeTruthy();
  expect(JSON.stringify(page)).not.toContain("SYNTHETIC_PRIVATE");
  expect(page.items[0]).not.toHaveProperty("body");
  expect(page.items[0]).not.toHaveProperty("comments");
  expect(f.db.prepare("SELECT count(*) n FROM state").get()).toEqual(before);
  expect(Buffer.byteLength(JSON.stringify(page))).toBeLessThan(10000);
});
it("paginates numerically with a scoped ceiling despite new arrivals and rejects cursor reuse under other filters", async () => {
  const f = fixture(),
    first = await f.queries.list(input({ limit: 5 }));
  f.insert("999");
  const next = await f.queries.list(
    input({ limit: 5, cursor: first.nextCursor }),
  );
  expect(next.items.map((p) => p.id)).toEqual(["20", "19", "18", "17", "16"]);
  expect(next.total).toBe(25);
  await expect(
    f.queries.list(input({ q: "changed", cursor: first.nextCursor })),
  ).rejects.toThrow("필터");
  await expect(f.queries.list(input({ cursor: "invalid" }))).rejects.toThrow(
    "페이지",
  );
  let cursor = first.nextCursor;
  const ids = first.items.map((p) => p.id);
  while (cursor) {
    const page = await f.queries.list(input({ limit: 5, cursor }));
    ids.push(...page.items.map((p) => p.id));
    cursor = page.nextCursor;
  }
  expect(new Set(ids).size).toBe(25);
  expect(ids).not.toContain("999");
});
it("matches comments independently, escapes SQL search input and scopes Korean checked dates", async () => {
  const f = fixture();
  expect(
    (await f.queries.list(input({ keyword: "룰루" }))).items.map((p) => p.id),
  ).toEqual(["25"]);
  expect((await f.queries.list(input({ q: "댓글만" }))).total).toBe(1);
  expect((await f.queries.list(input({ q: "%' OR 1=1 --" }))).total).toBe(0);
  expect(
    (await f.queries.list(input({ day: "2026-11-12", match: "matched" })))
      .total,
  ).toBe(13);
  expect((await f.queries.list(input({ day: "2026-11-11" }))).total).toBe(0);
  const detail = await f.queries.detail("25");
  expect(detail).toMatchObject({
    coverage: "partial",
    skippedComments: 1,
    reportedComments: 3,
    commentsLimited: false,
  });
  expect(detail?.comments[1]).toMatchObject({ text: "", hasMedia: true });
  expect(await f.queries.detail("99999")).toBeNull();
});
it("handles an absent source without creating a database or pretending that collection ran", async () => {
  const result = await new PokergosuQueries(
    new PokergosuSqliteReader("/nonexistent/mention/synthetic.db"),
  ).list(input());
  expect(result).toMatchObject({
    items: [],
    total: 0,
    summary: { available: false, monitor: null },
  });
});
it("validates public API contracts and exposes reads only", async () => {
  const f = fixture(),
    app = Fastify(),
    legacy = new FakeReader();
  registerApi(app, legacy, legacy, {
    origin: "http://localhost",
    writesEnabled: false,
  });
  registerPokergosu(app, f.queries);
  try {
    for (const url of [
      "/api/pokergosu?limit=0",
      "/api/pokergosu?limit=100",
      "/api/pokergosu?day=2026-02-31",
      "/api/pokergosu?cursor=invalid",
      "/api/pokergosu/abc",
    ])
      expect((await app.inject(url)).statusCode).toBe(400);
    const response = await app.inject(
      `/api/pokergosu?keyword=${encodeURIComponent("룰루")}`,
    );
    expect(response.statusCode).toBe(200);
    expect(response.json().data.total).toBe(1);
    expect(response.headers["cache-control"]).toContain("no-store");
    expect((await app.inject("/api/pokergosu/99999")).statusCode).toBe(404);
    expect(
      (await app.inject({ method: "POST", url: "/api/pokergosu", payload: {} }))
        .statusCode,
    ).toBe(404);
    expect(legacy.writes).toHaveLength(0);
  } finally {
    await app.close();
  }
});
it("SSR contains populated source data with only the active page query and escapes untrusted post text", async () => {
  const f = fixture(),
    monitoring = new MonitoringQueries(new FakeReader());
  const payload = JSON.parse(
    String(
      f.db.prepare("SELECT payload FROM threads WHERE id='25'").get()?.payload,
    ),
  );
  payload.title = "<script>synthetic_attack()</script>";
  f.db
    .prepare("UPDATE threads SET payload=? WHERE id='25'")
    .run(JSON.stringify(payload));
  const result = await render(
    `/posts?keyword=${encodeURIComponent("룰루")}`,
    monitoring,
    false,
    undefined,
    false,
    f.queries,
  );
  expect(result.html).toContain("포커고수 여론");
  expect(result.html).toContain("&lt;script&gt;");
  expect(result.html).not.toContain("<script>synthetic_attack");
  expect(result.html).not.toContain("SYNTHETIC_PRIVATE");
  expect(result.state.queryState.queries.map((q) => q.queryKey[0])).toEqual([
    "pokergosu",
  ]);
  expect(result.queryBytes).toBeLessThan(15000);
  const detail = await render(
    "/posts/25",
    monitoring,
    false,
    undefined,
    false,
    f.queries,
  );
  expect(detail.html).toContain("룰루에 대한 댓글만 일치");
  expect(detail.html).toContain("이미지·미디어 댓글");
  expect(detail.state.queryState.queries.map((q) => q.queryKey[0])).toEqual([
    "pokergosu-post",
  ]);
});

it("renders opinion summary without loading or exposing post rows", async () => {
  const f = fixture();
  const result = await render(
    "/pokergosu",
    new MonitoringQueries(new FakeReader()),
    false,
    undefined,
    false,
    f.queries,
  );
  expect(result.html).toContain("포커고수 여론");
  expect(result.html).toContain("발견된 관심 키워드");
  expect(result.html).not.toContain("합성 포커고수 게시글 25");
  expect(result.state.queryState.queries.map((q) => q.queryKey[0])).toEqual([
    "pokergosu-summary",
  ]);
  expect(result.state.queryState.queries[0].state.data).not.toHaveProperty(
    "items",
  );
  expect(result.queryBytes).toBeLessThan(3000);
});
