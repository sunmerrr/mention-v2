import { describe, expect, it } from "vitest";
import { render } from "../apps/web/src/entry-server";
import { MonitoringQueries } from "../packages/application/src/queries";
import { FakeReader } from "./fakes";

describe("native React SSR", () => {
  it("includes useful data in HTML and dehydrates only the active route", async () => {
    const result = await render(
      "/",
      new MonitoringQueries(new FakeReader()),
      false,
    );
    expect(result.html).toContain("여론·동향");
    expect(result.html).toContain("샘플 A");
    expect(result.html).toContain("합성 분류 근거");
    expect(
      result.state.queryState.queries.map((q) => q.queryKey[0]).sort(),
    ).toEqual(["conversations", "overview"]);
    expect(result.queryBytes).toBeLessThan(25000);
  });
  it("keeps query state isolated between server requests", async () => {
    const one = new FakeReader(),
      two = new FakeReader();
    two.data.targets[0].name = "독립 요청";
    two.data.conversations = [];
    const [a, b] = await Promise.all([
      render("/", new MonitoringQueries(one), false),
      render("/", new MonitoringQueries(two), false),
    ]);
    expect(a.html).not.toContain("독립 요청");
    expect(b.html).toContain("독립 요청");
    expect(b.html).not.toContain("합성 발언");
  });
  it("only loads detail for a direct detail request", async () => {
    const reader = new FakeReader();
    const result = await render(
      `/conversations/${reader.data.conversations[0].id}`,
      new MonitoringQueries(reader),
      false,
    );
    expect(result.html).toContain("합성 메시지");
    expect(result.state.queryState.queries.map((q) => q.queryKey[0])).toEqual([
      "conversation",
    ]);
  });
});
