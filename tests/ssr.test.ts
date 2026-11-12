import { describe, expect, it } from "vitest";
import { render } from "../apps/web/src/entry-server";
import { MonitoringQueries } from "../packages/application/src/queries";
import { WorkspaceQueries } from "../packages/application/src/workspace";
import { FakeReader } from "./fakes";

describe("native React SSR", () => {
  it("identifies inherited promotion reactions without claiming a literal keyword hit", async () => {
    const reader = new FakeReader();
    reader.data.conversations[0].keywords = {};
    const original = reader.detail.bind(reader);
    reader.detail = async (id) => {
      const detail = await original(id);
      detail.messages[0].promotionReference = {
        logId: "123",
        at: detail.conversation.at - 1000,
        keywords: ["샘플 A"],
        targets: ["샘플 A"],
        method: "topic_candidate",
        ambiguousTargets: false,
      };
      return detail;
    };
    const page = await render(
      "/conversations/" + "0".repeat(32),
      new MonitoringQueries(reader),
      false,
    );
    expect(page.html).toContain("광고 후속 반응 후보");
    expect(page.html).toContain("연결 대상 확인 필요");
    expect(page.html).toContain("광고 후속 반응 구간");
    expect(page.html).not.toContain("키워드가 나온 구간");
  });

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
    ).toEqual(["overview"]);
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
  it("preserves Korean form values across streamed SSR chunks and renders external save controls without JS", async () => {
    const keywords = Array.from(
      { length: 90 },
      (_, i) => `러너포커 합성 키워드 ${i}`,
    );
    const workspace = new WorkspaceQueries({
      request: async () => ({
        keywords,
        exclude_keywords: [],
        keyword_groups: [],
      }),
    });
    const result = await render(
      "/keywords",
      new MonitoringQueries(new FakeReader()),
      true,
      workspace,
      true,
    );
    expect(result.html).not.toContain("�");
    expect(result.html).not.toContain("\0");
    expect(result.html).toContain(keywords.join("\n"));
    expect(result.html).toContain('form="page-save-keyword-settings"');
    expect(result.html).toContain('id="page-save-keyword-settings"');
  });
  it("does not inject NUL characters at production SSR buffer boundaries", async () => {
    for (let count = 20; count < 30; count++) {
      const keywords = Array.from(
        { length: count },
        (_, i) => `러너포커 합성 키워드 ${i}`,
      );
      const workspace = new WorkspaceQueries({
        request: async () => ({
          keywords,
          exclude_keywords: [],
          keyword_groups: [],
        }),
      });
      const result = await render(
        "/keywords",
        new MonitoringQueries(new FakeReader()),
        true,
        workspace,
        true,
      );
      expect(result.html).not.toContain("\0");
      expect(result.html).toContain(keywords.join("\n"));
    }
  });
});
