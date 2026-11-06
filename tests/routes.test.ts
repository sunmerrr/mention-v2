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
