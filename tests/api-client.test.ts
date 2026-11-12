import { afterEach, describe, expect, it, vi } from "vitest";
import { api } from "../apps/web/src/queries";

afterEach(() => vi.unstubAllGlobals());
describe("API transport failures", () => {
  it("does not expose proxy HTML or network exception details", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValue(
          new Response("<html>private proxy failure</html>", { status: 502 }),
        ),
    );
    await expect(api("/api/test")).rejects.toMatchObject({
      status: 502,
      message: "서버 응답을 확인하지 못했습니다. 잠시 후 다시 시도해 주세요.",
    });
    vi.stubGlobal(
      "fetch",
      vi.fn().mockRejectedValue(new Error("private connection details")),
    );
    await expect(api("/api/test")).rejects.toMatchObject({
      status: 0,
      message: "서버에 연결하지 못했습니다. 연결 상태를 확인해 주세요.",
    });
  });
  it("rejects invalid envelopes and handles null as an explicit mutation body", async () => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(Response.json({ data: 1 }))
      .mockResolvedValueOnce(
        Response.json({ success: false, error: { message: "확인 필요" } }),
      )
      .mockResolvedValueOnce(Response.json({ success: true, data: 7 }));
    vi.stubGlobal("fetch", fetch);
    await expect(api("/api/test")).rejects.toMatchObject({ status: 502 });
    await expect(api("/api/test")).rejects.toMatchObject({
      status: 502,
      message: "확인 필요",
    });
    expect(await api("/api/test", null)).toBe(7);
    expect(fetch.mock.calls[2][1]).toMatchObject({
      method: "POST",
      body: "null",
    });
  });
});
