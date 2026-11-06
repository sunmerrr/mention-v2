import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import compress from "@fastify/compress";
import middie from "@fastify/middie";
import fastifyStatic from "@fastify/static";
import Fastify from "fastify";
import { CollectorTransport } from "./adapters/collector";
import { LegacyReader } from "./adapters/legacy";
import { registerApi } from "./routes";

const root = fileURLToPath(new URL("../../../", import.meta.url)),
  production = process.argv.includes("--production");
let deployment: { legacyRoot?: string; publicOrigin?: string } = {};
try {
  deployment = JSON.parse(
    await readFile(path.join(root, "runtime/deployment.json"), "utf8"),
  );
} catch {}
const port = Number(process.env.MENTION_PORT || 8790),
  host = "127.0.0.1",
  origin = `http://${host}:${port}`,
  writesEnabled = process.env.MENTION_ENABLE_WRITES === "1";
const app = Fastify({
  logger: { level: "info" },
  bodyLimit: 16000,
  trustProxy: false,
});
if (production) await app.register(compress);
const reader = new LegacyReader(
  process.env.MENTION_LEGACY_URL || "http://127.0.0.1:8766",
  (message) => app.log.warn({ event: "snapshot_refresh_failed" }, message),
  30000,
  deployment.legacyRoot
    ? new CollectorTransport(deployment.legacyRoot, writesEnabled)
    : undefined,
);
const queries = registerApi(app, reader, reader, {
  origin,
  writesEnabled,
  publicOrigin: deployment.publicOrigin,
});
app.addHook("onRequest", async (request, reply) => {
  if (
    request.headers.host !== `${host}:${port}` &&
    request.headers.host !== `localhost:${port}`
  )
    return reply.code(403).send("Invalid host");
});
app.get("/health", async () => ({
  role: "mention-web",
  writesEnabled,
  source: "legacy",
  pid: process.pid,
}));
let vite: import("vite").ViteDevServer | undefined;
if (!production) {
  await app.register(middie);
  const { createServer } = await import("vite");
  vite = await createServer({
    configFile: path.join(root, "vite.config.ts"),
    server: { middlewareMode: true, hmr: { port: port + 1, host } },
    appType: "custom",
  });
  app.use(vite.middlewares);
} else
  await app.register(fastifyStatic, {
    root: path.join(root, "dist/client"),
    prefix: "/",
    wildcard: false,
    index: false,
  });
app.get("/*", async (request, reply) => {
  if (request.url.startsWith("/api/"))
    return reply.code(404).send({
      success: false,
      data: null,
      error: { message: "존재하지 않는 API입니다." },
    });
  const started = performance.now();
  try {
    let template = await readFile(
      path.join(
        root,
        production ? "dist/client/index.html" : "apps/web/index.html",
      ),
      "utf8",
    );
    if (vite) {
      template = template.replace(
        "</head>",
        `<link rel="stylesheet" href="/@fs/${path.join(root, "node_modules/@radix-ui/themes/styles.css")}?direct"><link rel="stylesheet" href="/src/style.css?direct"></head>`,
      );
      template = await vite.transformIndexHtml(request.url, template);
    }
    const entry = production
      ? await import(path.join(root, "dist/server/entry-server.js"))
      : await vite?.ssrLoadModule("/src/entry-server.tsx");
    const page = await entry.render(request.url, queries, writesEnabled);
    const state = JSON.stringify(page.state)
      .replace(/</g, "\\u003c")
      .replace(/>/g, "\\u003e")
      .replace(/&/g, "\\u0026");
    const html = template
      .replace("<!--app-html-->", () => page.html)
      .replace(
        "<!--app-state-->",
        () =>
          `<script id="mention-state" type="application/json">${state}</script>`,
      );
    reply.header(
      "Server-Timing",
      `ssr;dur=${Math.round(performance.now() - started)}`,
    );
    return reply.type("text/html").send(html);
  } catch (error) {
    if (vite && error instanceof Error) vite.ssrFixStacktrace(error);
    app.log.error(
      {
        event: "ssr_failed",
        errorType: error instanceof Error ? error.name : "unknown",
      },
      "SSR failed",
    );
    return reply
      .code(503)
      .type("text/html")
      .send(
        '<!doctype html><html lang="ko"><meta charset="utf-8"><title>Mention</title><body><h1>데이터를 불러오지 못했습니다.</h1><p>기존 수집 서비스 연결을 확인한 뒤 새로고침해 주세요.</p><a href="/">다시 조회</a></body></html>',
      );
  }
});
async function shutdown() {
  await app.close();
  await vite?.close();
  process.exit(0);
}
process.once("SIGTERM", shutdown);
process.once("SIGINT", shutdown);
await app.listen({ host, port });
