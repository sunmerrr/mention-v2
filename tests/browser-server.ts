// Synthetic browser integration host. It cannot access collector runtime or IPC.
import { readFile } from "node:fs/promises";
import path from "node:path";
import fastifyStatic from "@fastify/static";
import Fastify from "fastify";
import { PokergosuSqliteReader } from "../apps/read-api/src/adapters/pokergosu";
import { PokergosuMediaCache } from "../apps/read-api/src/adapters/pokergosu-media";
import { isPagePath } from "../apps/read-api/src/page-paths";
import { registerPokergosu } from "../apps/read-api/src/pokergosu-routes";
import { registerApi } from "../apps/read-api/src/routes";
import { PokergosuQueries } from "../packages/application/src/pokergosu";
import { FakeReader } from "./fakes";
import { pokergosuFixture } from "./pokergosu-fixture";

const app = Fastify();
const reader = new FakeReader();
const queries = registerApi(app, reader, reader, {
  origin: "http://127.0.0.1:8798",
  writesEnabled: true,
});
const pgFixture = pokergosuFixture();
const pokergosu = new PokergosuQueries(
  new PokergosuSqliteReader(pgFixture.filename),
  new PokergosuMediaCache(
    path.join(path.dirname(pgFixture.filename), "media"),
    async () =>
      new Response(
        Buffer.from(
          "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+kO3sAAAAASUVORK5CYII=",
          "base64",
        ),
        { headers: { "Content-Type": "image/png" } },
      ),
  ),
);
registerPokergosu(app, pokergosu, ["http://127.0.0.1:8798"]);
app.addHook("onClose", async () => {
  pgFixture.close();
});
app.get("/health", async () => ({ status: "ok", source: "synthetic" }));
await app.register(fastifyStatic, {
  root: path.resolve("dist/client"),
  index: false,
  wildcard: false,
});
app.get("/*", async (request, reply) => {
  if (!isPagePath(new URL(request.url, "http://localhost").pathname))
    return reply.code(404).send("Not found");
  const entry = await import(path.resolve("dist/server/entry-server.js"));
  const result = await entry.render(
    request.url,
    queries,
    true,
    undefined,
    true,
    pokergosu,
  );
  const template = await readFile("dist/client/index.html", "utf8");
  const state = JSON.stringify(result.state)
    .replace(/</g, "\\u003c")
    .replace(/>/g, "\\u003e")
    .replace(/&/g, "\\u0026");
  return reply
    .type("text/html")
    .send(
      template
        .replace("<!--app-html-->", () => result.html)
        .replace(
          "<!--app-state-->",
          () =>
            `<script id="mention-state" type="application/json">${state}</script>`,
        ),
    );
});
process.once("SIGTERM", () => {
  void app.close();
});
process.once("SIGINT", () => {
  void app.close();
});
await app.listen({ host: "127.0.0.1", port: 8798 });
