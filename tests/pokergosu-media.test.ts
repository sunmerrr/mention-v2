import { createHash } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import Fastify from "fastify";
import { afterEach, expect, it, vi } from "vitest";
import { PokergosuSqliteReader } from "../apps/read-api/src/adapters/pokergosu";
import {
  PokergosuMediaCache,
  rasterType,
} from "../apps/read-api/src/adapters/pokergosu-media";
import { registerPokergosu } from "../apps/read-api/src/pokergosu-routes";
import { registerApi } from "../apps/read-api/src/routes";
import { PokergosuQueries } from "../packages/application/src/pokergosu";
import type { PokergosuImage } from "../packages/contracts/src/pokergosu";
import { supportedPokergosuImage } from "../packages/domain/src/pokergosu-media";
import { FakeReader } from "./fakes";
import { pokergosuFixture } from "./pokergosu-fixture";

const png = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+kO3sAAAAASUVORK5CYII=",
  "base64",
);
const cleanup: (() => void)[] = [];
afterEach(() => {
  for (const close of cleanup.splice(0)) close();
});
function cache(request: typeof fetch) {
  const directory = mkdtempSync(path.join(tmpdir(), "mention-media-"));
  cleanup.push(() => rmSync(directory, { recursive: true, force: true }));
  return new PokergosuMediaCache(directory, request);
}
function image(
  url = "https://www.ipokergosu.com/uploads/synthetic.png",
): PokergosuImage {
  return {
    key: createHash("sha256").update(url).digest("hex"),
    url,
    alt: "합성 사진",
    width: 1,
    height: 1,
    state: "not_cached",
  };
}
it("never fetches on describe or cached GET; explicit load is deduplicated and retained", async () => {
  const request = vi.fn(
      async () =>
        new Response(png, { headers: { "Content-Type": "image/png" } }),
    ),
    store = cache(request),
    asset = image();
  expect(store.describe(asset).state).toBe("not_cached");
  expect(await store.file(asset.key)).toBeNull();
  expect(request).not.toHaveBeenCalled();
  const [a, b] = await Promise.all([store.load(asset), store.load(asset)]);
  expect(a.state).toBe("cached");
  expect(b.state).toBe("cached");
  expect(request).toHaveBeenCalledTimes(1);
  expect(store.describe(asset).state).toBe("cached");
  expect((await store.file(asset.key))?.bytes).toEqual(png);
  expect((await store.file(asset.key))?.mime).toBe("image/png");
  await store.load(asset);
  expect(request).toHaveBeenCalledTimes(1);
});
it("does not fetch arbitrary hosts, credentials, local addresses or redirects to them", async () => {
  const request = vi.fn(
      async () =>
        new Response(null, {
          status: 302,
          headers: { Location: "http://127.0.0.1/private" },
        }),
    ),
    store = cache(request);
  for (const url of [
    "http://www.pokergosu.com/a",
    "https://127.0.0.1/a",
    "https://www.pokergosu.com.evil.invalid/a",
    "https://user:password@www.pokergosu.com/a",
    "https://www.pokergosu.com:444/a",
  ]) {
    expect(supportedPokergosuImage(url)).toBe(false);
    expect((await store.load(image(url))).state).toBe("unsupported");
  }
  expect(request).not.toHaveBeenCalled();
  expect((await store.load(image())).state).toBe("failed");
  expect(request).toHaveBeenCalledTimes(1);
});
it("keeps failed receipts and holds further downloads after HTTP403 without claiming an account ban", async () => {
  const request = vi.fn(async () => new Response(null, { status: 403 })),
    store = cache(request),
    asset = image();
  expect((await store.load(asset)).state).toBe("failed");
  await store.load(asset);
  expect(request).toHaveBeenCalledTimes(1);
  expect(
    (await store.load(image("https://www.ipokergosu.com/other.jpg"))).message,
  ).toContain("접근 제한");
  expect(request).toHaveBeenCalledTimes(1);
});
it("rejects HTML, SVG and oversized responses while retaining references", async () => {
  for (const response of [
    new Response("<html>blocked</html>", {
      headers: { "Content-Type": "text/html" },
    }),
    new Response("<svg></svg>", {
      headers: { "Content-Type": "image/svg+xml" },
    }),
    new Response(png, {
      headers: {
        "Content-Type": "image/png",
        "Content-Length": String(9 * 1024 * 1024),
      },
    }),
  ]) {
    const store = cache(vi.fn(async () => response));
    expect((await store.load(image())).state).toBe("failed");
    expect(await store.file(image().key)).toBeNull();
  }
  expect(rasterType(png)).toBe("image/png");
  expect(rasterType(Buffer.from("<script>bad()</script>"))).toBeNull();
});
it("requires approved POST origin and a retained image, and serves cached bytes without external requests", async () => {
  const fixture = pokergosuFixture();
  cleanup.push(fixture.close);
  const asset = image(),
    raw = JSON.parse(
      String(
        fixture.db.prepare("SELECT payload FROM threads WHERE id='25'").get()
          ?.payload,
      ),
    );
  raw.images = [{ url: asset.url, alt: asset.alt, width: 1, height: 1 }];
  fixture.db
    .prepare("UPDATE threads SET payload=? WHERE id='25'")
    .run(JSON.stringify(raw));
  const request = vi.fn(
      async () =>
        new Response(png, { headers: { "Content-Type": "image/png" } }),
    ),
    store = cache(request),
    queries = new PokergosuQueries(
      new PokergosuSqliteReader(fixture.filename),
      store,
    );
  const app = Fastify(),
    legacy = new FakeReader();
  registerApi(app, legacy, legacy, {
    origin: "http://localhost",
    writesEnabled: false,
  });
  registerPokergosu(app, queries, ["http://localhost"]);
  try {
    expect(
      (await app.inject(`/api/pokergosu/media/${asset.key}`)).statusCode,
    ).toBe(404);
    expect(request).not.toHaveBeenCalled();
    expect(
      (
        await app.inject({
          method: "POST",
          url: `/api/pokergosu/25/media/${asset.key}`,
          headers: { origin: "https://evil.invalid" },
          payload: {},
        })
      ).statusCode,
    ).toBe(403);
    const loaded = await app.inject({
      method: "POST",
      url: `/api/pokergosu/25/media/${asset.key}`,
      headers: { origin: "http://localhost" },
      payload: {},
    });
    expect(loaded.statusCode).toBe(200);
    expect(loaded.json().data.state).toBe("cached");
    const file = await app.inject(`/api/pokergosu/media/${asset.key}`);
    expect(file.statusCode).toBe(200);
    expect(file.headers["content-type"]).toContain("image/png");
    expect(file.headers["x-content-type-options"]).toBe("nosniff");
    expect(file.rawPayload).toEqual(png);
    expect(request).toHaveBeenCalledTimes(1);
    expect(
      (
        await app.inject({
          method: "POST",
          url: `/api/pokergosu/1/media/${asset.key}`,
          headers: { origin: "http://localhost" },
          payload: {},
        })
      ).statusCode,
    ).toBe(404);
    expect(request).toHaveBeenCalledTimes(1);
  } finally {
    await app.close();
  }
});
