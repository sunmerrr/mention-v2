// Synthetic browser integration host. It cannot access collector runtime or IPC.
import { readFile } from "node:fs/promises";
import path from "node:path";
import fastifyStatic from "@fastify/static";
import Fastify from "fastify";
import { ForumOpinions } from "../apps/read-api/src/adapters/forum-opinions";
import { PokergosuSqliteReader } from "../apps/read-api/src/adapters/pokergosu";
import { PokergosuMediaCache } from "../apps/read-api/src/adapters/pokergosu-media";
import { isPagePath } from "../apps/read-api/src/page-paths";
import { registerPokergosu } from "../apps/read-api/src/pokergosu-routes";
import { registerApi } from "../apps/read-api/src/routes";
import { CombinedQueries } from "../packages/application/src/combined";
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
const forumReader = new PokergosuSqliteReader(pgFixture.filename);
const policies = {
  read: async () => ({
    policy: {
      version: 1 as const,
      keywords: ["APL", "룰루", "A", "에이", "B"],
      keyword_groups: [
        { id: "apl", name: "APL", kind: "event" as const, keywords: ["APL"] },
        {
          id: "lulu",
          name: "포커룰루",
          kind: "service" as const,
          keywords: ["룰루"],
        },
        {
          id: "a",
          name: "샘플 A",
          kind: "service" as const,
          keywords: ["A", "에이"],
        },
        { id: "b", name: "샘플 B", kind: "service" as const, keywords: ["B"] },
      ],
      sources: { kakao: { disabled: [] }, pokergosu: { disabled: [] } },
    },
    token: "test",
    supported: true,
  }),
};
const forumOpinions = new ForumOpinions(
  path.join(path.dirname(pgFixture.filename), "opinions.sqlite3"),
  forumReader,
  policies,
);
const combined = new CombinedQueries({
  kakao: (scope) => queries.overview(scope),
  forum: (scope) => forumOpinions.summary(scope),
  policy: () => policies.read(),
});
app.get("/api/combined", async () => ({
  success: true,
  data: await combined.read({ day: "", target: "" }),
  error: null,
}));
const pokergosu = new PokergosuQueries(
  forumReader,
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
  forumOpinions,
);
registerPokergosu(
  app,
  pokergosu,
  ["http://127.0.0.1:8798"],
  forumOpinions,
  true,
);
app.addHook("onClose", async () => {
  forumOpinions.close();
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
    combined,
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
