import Fastify from "fastify";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { registerApi } from "../apps/read-api/src/routes";
import { FakeReader } from "./fakes";

let app: ReturnType<typeof Fastify>;
let reader: FakeReader;
beforeEach(() => {
  app = Fastify();
  reader = new FakeReader();
  registerApi(app, reader, reader, {
    origin: "http://127.0.0.1:8790",
    writesEnabled: false,
  });
});
afterEach(async () => {
  await app.close();
});
describe("public read and protected write API", () => {
  it("provides bounded pages and validation errors", async () => {
    const response = await app.inject("/api/conversations?limit=3");
    expect(response.statusCode).toBe(200);
    expect(response.json().data.items).toHaveLength(3);
    expect(response.headers["cache-control"]).toContain("no-store");
    expect((await app.inject("/api/conversations?limit=9999")).statusCode).toBe(
      400,
    );
  });
  it("does not forward any writes from a read-only preview", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/api/classifications/correct",
      headers: { origin: "http://127.0.0.1:8790" },
      payload: {},
    });
    expect(response.statusCode).toBe(403);
    expect(reader.writes).toHaveLength(0);
  });
  it("requires origin even for an explicit refresh", async () => {
    expect(
      (await app.inject({ method: "POST", url: "/api/refresh", payload: {} }))
        .statusCode,
    ).toBe(403);
    expect(
      (
        await app.inject({
          method: "POST",
          url: "/api/refresh",
          headers: { origin: "http://127.0.0.1:8790" },
          payload: {},
        })
      ).statusCode,
    ).toBe(200);
  });
  it("validates corrections and preserves their conflict/version contract", async () => {
    await app.close();
    app = Fastify();
    registerApi(app, reader, reader, {
      origin: "http://127.0.0.1:8790",
      writesEnabled: true,
    });
    const payload = {
      id: "source",
      service: "샘플 A",
      verdict: "negative",
      summary: "합성 수정",
      expected: "synthetic-revision",
      request_id: "d93c6248-b2d8-4ed4-a010-5215c46a74c6",
    };
    expect(
      (
        await app.inject({
          method: "POST",
          url: "/api/classifications/correct",
          headers: { origin: "http://127.0.0.1:8790" },
          payload,
        })
      ).statusCode,
    ).toBe(200);
    expect(reader.writes).toEqual([payload]);
    expect(
      (
        await app.inject({
          method: "POST",
          url: "/api/classifications/correct",
          headers: { origin: "http://127.0.0.1:8790", "x-monitor-public": "1" },
          payload,
        })
      ).statusCode,
    ).toBe(403);
  });
});

describe("local AI batches", () => {
  it("requires local write authorization and preserves per-item outcomes", async () => {
    const payload = {
      id: "source",
      service: "샘플 A",
      verdict: "neutral",
      summary: "합성 AI 근거",
      expected: "synthetic-revision",
      request_id: "cc87d0d9-3b9e-46c4-a74f-af47d53c2e94",
      origin: "ai",
      evidence: [{ log_id: "synthetic-1", quote: "합성" }],
    };
    expect(
      (
        await app.inject({
          method: "POST",
          url: "/api/classifications/ai-batch",
          headers: { origin: "http://127.0.0.1:8790" },
          payload: [payload],
        })
      ).statusCode,
    ).toBe(403);
    await app.close();
    app = Fastify();
    registerApi(app, reader, reader, {
      origin: "http://127.0.0.1:8790",
      writesEnabled: true,
    });
    const result = await app.inject({
      method: "POST",
      url: "/api/classifications/ai-batch",
      headers: { origin: "http://127.0.0.1:8790" },
      payload: [payload],
    });
    expect(result.statusCode).toBe(200);
    expect(result.json().data.results[0].state).toBe("saved");
    expect(reader.writes[0]).toMatchObject({
      origin: "ai",
      evidence: payload.evidence,
    });
    expect(
      (
        await app.inject({
          method: "POST",
          url: "/api/classifications/ai-batch",
          headers: { origin: "https://example.invalid" },
          payload: [payload],
        })
      ).statusCode,
    ).toBe(403);
  });
});
