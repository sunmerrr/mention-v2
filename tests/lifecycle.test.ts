import Fastify from "fastify";
import { describe, expect, it } from "vitest";
import { Lifecycle } from "../apps/read-api/src/lifecycle";

describe("web graceful shutdown", () => {
  it("drains accepted requests and background jobs before closing dependencies", async () => {
    const lifecycle = new Lifecycle(),
      events: string[] = [];
    let finishRequest!: () => void, finishJob!: () => void;
    const app = Fastify();
    app.get("/save", async () => {
      await new Promise<void>((resolve) => {
        finishRequest = resolve;
      });
      events.push("saved");
      return { ok: true };
    });
    await app.ready();
    const request = app.inject("/save").then((response) => response.statusCode);
    await new Promise((resolve) => setImmediate(resolve));
    const job = lifecycle.run(
      () =>
        new Promise<void>((resolve) => {
          finishJob = resolve;
        }),
    );
    await new Promise((resolve) => setImmediate(resolve));
    const options = {
      stopAccepting: async () => {
        await app.close();
        events.push("http-drained");
      },
      drainAdapters: async () => {
        events.push("adapters-drained");
      },
      cleanup: async () => {
        events.push("closed");
      },
      timeoutMs: 1000,
      onTimeout: () => {
        events.push("timeout");
      },
    };
    const shutdown = lifecycle.stop(options);
    expect(lifecycle.stop(options)).toBe(shutdown);
    expect(lifecycle.draining).toBe(true);
    await lifecycle.run(async () => {
      events.push("new-job");
    });
    expect(events).toEqual([]);
    finishRequest();
    expect(await request).toBe(200);
    expect(events).not.toContain("closed");
    finishJob();
    await job;
    expect(await shutdown).toBe(true);
    expect(events).toEqual([
      "saved",
      "http-drained",
      "adapters-drained",
      "closed",
    ]);
  });
  it("enforces a deadline without claiming interrupted work succeeded", async () => {
    const lifecycle = new Lifecycle();
    let timeout = false,
      cleaned = false;
    await lifecycle.run(async () => {});
    const clean = await lifecycle.stop({
      stopAccepting: () => new Promise(() => {}),
      drainAdapters: async () => {},
      cleanup: async () => {
        cleaned = true;
      },
      timeoutMs: 10,
      onTimeout: () => {
        timeout = true;
      },
    });
    expect({ clean, timeout, cleaned }).toEqual({
      clean: false,
      timeout: true,
      cleaned: true,
    });
  });
});
