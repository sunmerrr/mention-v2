import Fastify from "fastify";
import { describe, expect, it, vi } from "vitest";
import { registerWorkspace } from "../apps/read-api/src/workspace-routes";
import { render } from "../apps/web/src/entry-server";
import { MonitoringQueries } from "../packages/application/src/queries";
import {
  type WorkspaceFeature,
  WorkspaceQueries,
  workspaceReads,
} from "../packages/application/src/workspace";
import { FakeReader } from "./fakes";

const origin = "http://127.0.0.1:8790",
  publicOrigin = "https://synthetic.example";
function fakePort() {
  return {
    request: vi.fn(
      async (
        path: string,
        input?: unknown,
        local?: boolean,
      ): Promise<unknown> => {
        if (path.startsWith("/download/"))
          return {
            binary: Buffer.from("합성 CSV").toString("base64"),
            contentType: "text/csv",
            disposition: 'attachment; filename="synthetic.csv"',
          };
        if (input !== undefined) return { ok: true };
        if (path.startsWith("/api/keywords"))
          return {
            keywords: ["합성 포함"],
            exclude_keywords: ["합성 제외"],
            keyword_groups: [],
          };
        if (path.startsWith("/api/rooms"))
          return {
            rooms: [
              { id: "123", name: "합성 채팅방", excluded: false, count: 5 },
            ],
            page: 1,
            pages: 1,
            total: 1,
          };
        if (path.startsWith("/api/briefing-delivery"))
          return { enabled: false, local };
        if (path.startsWith("/api/briefing"))
          return {
            report: {
              day: "2026-11-06",
              targets: [],
              coverage: { counts: {} },
            },
            history: [],
          };
        if (path.startsWith("/api/operations"))
          return {
            coverage: {
              intervals: [],
              recoveries: [],
              counts: {},
              page: 1,
              pages: 1,
              total: 0,
            },
            backup: { backups: [] },
            health: { state: "monitoring" },
          };
        return {
          items: [],
          guides: [],
          available_rooms: [],
          messages: [],
          campaigns: [],
          rooms: [],
          targets: [],
          options: [],
          rows: [],
          candidates: [],
          decisions: [],
          groups: [],
          days: [],
          page: 1,
          pages: 1,
          total: 0,
        };
      },
    ),
  };
}
describe("workspace parity boundary", () => {
  it("maps every restored read without exposing arbitrary collector endpoints", async () => {
    const port = fakePort(),
      queries = new WorkspaceQueries(port);
    for (const feature of Object.keys(workspaceReads))
      await queries.read(
        feature as WorkspaceFeature,
        "?room=all&target=all",
        false,
      );
    expect(
      port.request.mock.calls.every(
        ([path]) => !path.includes("room=all") && !path.includes("target=all"),
      ),
    ).toBe(true);
    const app = Fastify();
    registerWorkspace(
      app,
      queries,
      { origin, publicOrigin, writesEnabled: true },
      async () => {},
    );
    for (const feature of ["runtime", "assistant", "__proto__", "constructor"])
      expect((await app.inject(`/api/workspace/${feature}`)).statusCode).toBe(
        404,
      );
    await app.close();
  });
  it("preserves local-only actions and origin checks, including forged loopback origins through Cloudflare", async () => {
    const port = fakePort(),
      app = Fastify();
    registerWorkspace(
      app,
      new WorkspaceQueries(port),
      { origin, publicOrigin, writesEnabled: true },
      async () => {},
    );
    for (const headers of [
      { origin: publicOrigin },
      { origin, "cf-ray": "synthetic" },
      { origin, "x-forwarded-for": "192.0.2.1" },
      {},
    ]) {
      expect(
        (
          await app.inject({
            method: "POST",
            url: "/api/actions/campaign-send",
            headers,
            payload: { request_id: "keep-this-id" },
          })
        ).statusCode,
      ).toBe(403);
    }
    expect(port.request).not.toHaveBeenCalled();
    const payload = { room_ids: ["123"], excluded: true };
    expect(
      (
        await app.inject({
          method: "POST",
          url: "/api/actions/room-settings",
          headers: { origin: publicOrigin, "cf-ray": "synthetic" },
          payload,
        })
      ).statusCode,
    ).toBe(200);
    expect(port.request).toHaveBeenCalledWith("/room-settings", payload, false);
    expect(
      (
        await app.inject({
          method: "POST",
          url: "/api/actions/campaign-send",
          headers: { origin },
          payload: { request_id: "same-receipt" },
        })
      ).statusCode,
    ).toBe(200);
    expect(port.request).toHaveBeenLastCalledWith(
      "/campaign-send",
      { request_id: "same-receipt" },
      true,
    );
    await app.close();
  });
  it("never turns a committed action into a save failure when refresh fails; binary downloads remain intact", async () => {
    const port = fakePort(),
      app = Fastify();
    registerWorkspace(
      app,
      new WorkspaceQueries(port),
      { origin, writesEnabled: true },
      async () => {
        throw Error("synthetic read failure");
      },
    );
    expect(
      (
        await app.inject({
          method: "POST",
          url: "/api/actions/bookmark-save",
          headers: { origin },
          payload: { source_id: "synthetic" },
        })
      ).statusCode,
    ).toBe(200);
    const asset = await app.inject("/download/2026-11-06.csv");
    expect(asset.statusCode).toBe(200);
    expect(asset.body).toBe("합성 CSV");
    expect(asset.headers["content-disposition"]).toContain("attachment");
    await app.close();
  });
  it("rejects writes in explicit read-only mode without forwarding them", async () => {
    const port = fakePort(),
      app = Fastify();
    registerWorkspace(
      app,
      new WorkspaceQueries(port),
      { origin, writesEnabled: false },
      async () => {},
    );
    expect(
      (
        await app.inject({
          method: "POST",
          url: "/api/actions/keyword-settings",
          headers: { origin },
          payload: { keywords: [] },
        })
      ).statusCode,
    ).toBe(403);
    expect(port.request).not.toHaveBeenCalled();
    await app.close();
  });
  it("server-renders restored routes with data and only their own query state", async () => {
    const queries = new MonitoringQueries(new FakeReader()),
      workspace = new WorkspaceQueries(fakePort());
    for (const [path, content] of [
      ["/keywords", "합성 포함"],
      ["/rooms", "합성 채팅방"],
      ["/guide", "가이드 관리 방"],
      ["/messages", "메시지 기록"],
      ["/trends", "날짜별 여론과 근거"],
      ["/campaigns", "새 반응 관찰"],
      ["/responses", "비교할 질문 선택"],
      ["/briefing", "2026-11-06 일일 브리핑"],
      ["/bookmarks", "중요 대화"],
      ["/aliases", "새 별칭 후보"],
      ["/operations", "수집 공백 기록"],
    ]) {
      const result = await render(path, queries, true, workspace, false);
      expect(result.html).toContain(content);
      expect(
        result.state.queryState.queries.every(
          (q) => q.queryKey[0] === "workspace",
        ),
      ).toBe(true);
      expect(result.html).not.toContain("데이터를 불러오는 중입니다.");
    }
  });
});
