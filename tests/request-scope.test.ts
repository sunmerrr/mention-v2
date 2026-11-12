import Fastify from "fastify";
import { expect, it } from "vitest";
import { isLocalRequest } from "../apps/read-api/src/request-scope";
import { registerApi } from "../apps/read-api/src/routes";
import { FakeReader } from "./fakes";

it("remote peers and forwarded requests cannot claim local capabilities using Origin", async () => {
  const app = Fastify();
  const reader = new FakeReader();
  registerApi(app, reader, reader, {
    origin: "http://127.0.0.1:8790",
    writesEnabled: true,
  });
  app.get("/scope", async (request) => ({ local: isLocalRequest(request) }));
  expect((await app.inject("/scope")).json().local).toBe(true);
  expect(
    (await app.inject({ url: "/scope", remoteAddress: "192.0.2.20" })).json()
      .local,
  ).toBe(false);
  for (const headers of [
    { origin: "http://127.0.0.1:8790", "cf-ray": "synthetic" },
    { origin: "http://127.0.0.1:8790", "x-forwarded-for": "127.0.0.1" },
  ]) {
    const response = await app.inject({
      url: "/api/classifications/ai-batch",
      method: "POST",
      headers,
      payload: [],
    });
    expect(response.statusCode).toBe(403);
  }
  const remote = await app.inject({
    url: "/api/classifications/request-state/cc87d0d9-3b9e-46c4-a74f-af47d53c2e94",
    remoteAddress: "192.0.2.20",
    headers: { origin: "http://127.0.0.1:8790" },
  });
  expect(remote.statusCode).toBe(403);
  const missing = await app.inject({
    method: "POST",
    url: "/api/not-a-route",
    payload: {},
  });
  expect(missing.statusCode).toBe(404);
  expect(missing.json()).toMatchObject({
    success: false,
    data: null,
    error: { code: "NOT_FOUND" },
  });
  await app.close();
});
