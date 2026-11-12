import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import compress from "@fastify/compress";
import middie from "@fastify/middie";
import fastifyStatic from "@fastify/static";
import Fastify from "fastify";
import { PokergosuQueries } from "../../../packages/application/src/pokergosu";
import { WorkspaceQueries } from "../../../packages/application/src/workspace";
import { AliasSuggestions } from "./adapters/alias-suggestions";
import { AnalyticsTransport } from "./adapters/analytics";
import { CollectorTransport } from "./adapters/collector";
import { JudgmentExclusions } from "./adapters/judgment-exclusions";
import { LegacyReader } from "./adapters/legacy";
import { PokergosuSqliteReader } from "./adapters/pokergosu";
import { PokergosuMediaCache } from "./adapters/pokergosu-media";
import { MonitoringReadModel } from "./adapters/read-model";
import { readConfig } from "./config";
import { Lifecycle, registerDrainHeaders } from "./lifecycle";
import { isPagePath } from "./page-paths";
import { registerPokergosu } from "./pokergosu-routes";
import { registerApi } from "./routes";
import { SystemErrors } from "./system-errors";
import { isLocalRequest, registerWorkspace } from "./workspace-routes";

const root = fileURLToPath(new URL("../../../", import.meta.url)),
  production = process.argv.includes("--production");
const config = readConfig(process.env);
const runtimeDir = config.runtimeDir
  ? path.resolve(config.runtimeDir)
  : path.join(root, "runtime");
let deployment: {
  legacyRoot?: string;
  publicOrigin?: string;
  writesEnabled?: boolean;
} = {};
try {
  deployment = JSON.parse(
    await readFile(path.join(runtimeDir, "deployment.json"), "utf8"),
  );
} catch {}
const port = config.port,
  host = "127.0.0.1",
  origin = `http://${host}:${port}`,
  writesEnabled = config.writesEnabled ?? deployment.writesEnabled === true;
const app = Fastify({
  logger: { level: "info" },
  bodyLimit: 131072,
  trustProxy: false,
  keepAliveTimeout: config.keepAliveTimeoutMs,
});
app.server.headersTimeout = config.keepAliveTimeoutMs + 10000;
const systemErrors = new SystemErrors(
  path.join(runtimeDir, "system-errors.db"),
);
app.addHook("onResponse", async (request, reply) => {
  if (reply.statusCode < 500) return;
  try {
    systemErrors.record(
      request.method,
      request.routeOptions.url || "unmatched",
      reply.statusCode,
    );
  } catch {
    app.log.error(
      { event: "system_error_record_failed" },
      "Could not retain web failure metadata",
    );
  }
});
if (production) await app.register(compress);
const transport = deployment.legacyRoot
  ? new CollectorTransport(deployment.legacyRoot, writesEnabled)
  : undefined;
const analytics =
  transport && deployment.legacyRoot
    ? new AnalyticsTransport(deployment.legacyRoot, transport, (metrics) =>
        app.log.info(
          { event: "analytics_read", ...metrics },
          "Read-only analytics completed",
        ),
      )
    : undefined;
const aliases = analytics
  ? new AliasSuggestions(
      analytics,
      path.join(runtimeDir, "alias-suggestions.json"),
    )
  : undefined;
const workspace = transport
  ? new WorkspaceQueries(aliases || analytics || transport)
  : undefined;
const sourceReader = new LegacyReader(
  config.legacyUrl,
  (message) => app.log.warn({ event: "snapshot_refresh_failed" }, message),
  30000,
  analytics || transport,
);
const reader = new JudgmentExclusions(
  sourceReader,
  path.join(runtimeDir, "judgment-decisions.db"),
);
const readModel = new MonitoringReadModel(
  reader,
  path.join(runtimeDir, "public-read-model.db"),
);
const queries = registerApi(
  app,
  reader,
  reader,
  {
    origin,
    writesEnabled,
    publicOrigin: deployment.publicOrigin,
  },
  readModel,
);
const pokergosu = new PokergosuQueries(
  new PokergosuSqliteReader(path.join(runtimeDir, "pokergosu/monitor.sqlite3")),
  new PokergosuMediaCache(path.join(runtimeDir, "pokergosu/media")),
);
registerPokergosu(app, pokergosu, [
  origin,
  ...(deployment.publicOrigin ? [deployment.publicOrigin] : []),
]);
const lifecycle = new Lifecycle();
registerDrainHeaders(app, lifecycle);
const refreshReadModel = () =>
  lifecycle.run(() =>
    readModel
      .refresh()
      .catch(() =>
        app.log.warn(
          { event: "read_model_refresh_failed" },
          "Public read model retained its last successful generation",
        ),
      ),
  );
void refreshReadModel();
const refreshAliases = () =>
  lifecycle.run(async () =>
    aliases
      ?.refresh()
      .catch(() =>
        app.log.warn(
          { event: "alias_refresh_failed" },
          "Alias suggestions retained their last successful generation",
        ),
      ),
  );
void refreshAliases();
const aliasTimer = setInterval(refreshAliases, 60000);
aliasTimer.unref();
const readModelTimer = setInterval(refreshReadModel, 30000);
readModelTimer.unref();
if (workspace)
  registerWorkspace(
    app,
    workspace,
    { origin, publicOrigin: deployment.publicOrigin, writesEnabled },
    () => {
      reader.invalidate();
      return queries.refresh();
    },
  );
app.addHook("onRequest", async (request, reply) => {
  if (
    request.headers.host !== `${host}:${port}` &&
    request.headers.host !== `localhost:${port}`
  )
    return reply.code(403).send("Invalid host");
});
app.get("/health", async (_request, reply) => {
  if (lifecycle.draining) reply.code(503);
  return {
    status: lifecycle.draining ? "draining" : "ok",
    build: config.buildId,
    role: "mention-web",
    writesEnabled,
    source: "legacy",
    pid: process.pid,
  };
});
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
app.get("/conversation", async (request, reply) => {
  const id = new URL(request.url, origin).searchParams.get("id");
  return reply.redirect(
    id ? `/conversations/${encodeURIComponent(id)}` : "/conversations",
  );
});
app.get("/*", async (request, reply) => {
  if (request.url.startsWith("/api/"))
    return reply.code(404).send({
      success: false,
      data: null,
      error: { code: "NOT_FOUND", message: "존재하지 않는 API입니다." },
    });
  if (!isPagePath(new URL(request.url, origin).pathname))
    return reply
      .code(404)
      .type("text/html")
      .send(
        '<!doctype html><html lang="ko"><meta charset="utf-8"><title>Mention</title><h1>페이지를 찾을 수 없어요.</h1><a href="/">홈으로 돌아가기</a></html>',
      );
  reply.header("Cache-Control", "no-store");
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
    const page = await entry.render(
      request.url,
      queries,
      writesEnabled,
      workspace,
      isLocalRequest(request),
      pokergosu,
    );
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
    if (
      error instanceof Error &&
      "statusCode" in error &&
      error.statusCode === 404
    )
      return reply
        .code(404)
        .type("text/html")
        .send(
          '<!doctype html><html lang="ko"><meta charset="utf-8"><title>Mention</title><h1>저장된 게시글을 찾을 수 없습니다.</h1><a href="/pokergosu">포커고수 여론으로 돌아가기</a></html>',
        );
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
  clearInterval(readModelTimer);
  clearInterval(aliasTimer);
  app.log.info(
    { event: "shutdown_started" },
    "Draining web requests and read jobs",
  );
  try {
    const clean = await lifecycle.stop({
      stopAccepting: () => app.close(),
      drainAdapters: async () => {
        await Promise.all([readModel.drain(), aliases?.drain()]);
        await analytics?.drain();
      },
      cleanup: async () => {
        analytics?.close();
        await vite?.close();
        readModel.close();
        reader.close();
        systemErrors.close();
      },
      timeoutMs: 25000,
      onTimeout: () =>
        app.log.error(
          { event: "shutdown_timeout" },
          "Web drain exceeded deadline; interrupted writes must be reconciled from receipts",
        ),
    });
    app.log.info(
      { event: "shutdown_complete", clean },
      "Web shutdown completed",
    );
    process.exit(clean ? 0 : 1);
  } catch {
    app.log.error({ event: "shutdown_failed" }, "Web cleanup failed");
    process.exit(1);
  }
}
process.once("SIGTERM", shutdown);
process.once("SIGINT", shutdown);
await app.listen({ host: config.listenHost, port });
