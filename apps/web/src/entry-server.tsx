import { PassThrough } from "node:stream";
import {
  dehydrate,
  HydrationBoundary,
  QueryClientProvider,
} from "@tanstack/react-query";
import { renderToPipeableStream } from "react-dom/server";
import { StaticRouter } from "react-router-dom";
import type { MonitoringQueries } from "../../../packages/application/src/queries";
import type { WorkspaceQueries } from "../../../packages/application/src/workspace";
import { listSchema } from "../../../packages/contracts/src/api";
import { App, preloadRoute } from "./App";
import {
  classificationQuery,
  conversationsQuery,
  detailQuery,
  overviewQuery,
  scopeFrom,
} from "./queries";
import { createQueryClient } from "./query-client";
import { RuntimeContext } from "./runtime";
import { routeFeature, workspaceQuery } from "./workspace-query";
export async function render(
  url: string,
  queries: MonitoringQueries,
  writesEnabled: boolean,
  workspace?: WorkspaceQueries,
  local = false,
) {
  const requestUrl = new URL(url, "http://localhost"),
    scope = scopeFrom(requestUrl.search),
    label = requestUrl.searchParams.get("label") || "",
    client = createQueryClient();
  await preloadRoute(requestUrl.pathname);
  const listInput = listSchema.parse({ ...scope, label });
  const detail = /^\/conversations\/([^/]+)$/.exec(requestUrl.pathname);
  const feature = routeFeature(requestUrl.pathname);
  if (feature && workspace) {
    await client.fetchQuery({
      ...workspaceQuery(feature, requestUrl.search),
      queryFn: () => workspace.read(feature, requestUrl.search, local),
    });
  } else if (detail)
    await client.fetchQuery({
      ...detailQuery(detail[1]),
      queryFn: () => queries.detail(detail[1]),
    });
  else if (["/", "/conversations", "/reviews"].includes(requestUrl.pathname)) {
    await Promise.all([
      client.fetchQuery({
        ...overviewQuery(scope),
        queryFn: () => queries.overview(scope),
      }),
      requestUrl.pathname === "/"
        ? Promise.resolve()
        : requestUrl.pathname === "/reviews"
          ? client.fetchInfiniteQuery({
              ...classificationQuery(scope, label),
              queryFn: () => queries.classifications(listInput),
            })
          : client.fetchInfiniteQuery({
              ...conversationsQuery(scope, label),
              queryFn: () => queries.conversations(listInput),
            }),
    ]);
  }
  if (workspace) {
    const extra: { feature: "bookmarks" | "delivery"; search: string }[] = [];
    if (requestUrl.pathname === "/briefing")
      extra.push({ feature: "delivery", search: "" });
    const sourceId =
      detail?.[1] ||
      (feature === "episode" ? requestUrl.searchParams.get("id") : null);
    if (sourceId)
      extra.push({
        feature: "bookmarks",
        search: `?kind=${detail ? "conversation" : "episode"}&source_id=${sourceId}`,
      });
    await Promise.all(
      extra.map(({ feature, search }) =>
        client.fetchQuery({
          ...workspaceQuery(feature, search),
          queryFn: () => workspace.read(feature, search, local),
        }),
      ),
    );
  }
  const state = dehydrate(client);
  const tree = (
    <RuntimeContext.Provider value={{ writesEnabled, local }}>
      <QueryClientProvider client={client}>
        <HydrationBoundary state={state}>
          <StaticRouter location={url}>
            <App />
          </StaticRouter>
        </HydrationBoundary>
      </QueryClientProvider>
    </RuntimeContext.Provider>
  );
  const html = await new Promise<string>((resolve, reject) => {
    const output = new PassThrough();
    let body = "";
    output.on("data", (chunk) => {
      body += chunk.toString();
    });
    output.on("end", () => resolve(body));
    output.on("error", reject);
    const stream = renderToPipeableStream(tree, {
      onAllReady() {
        stream.pipe(output);
      },
      onShellError: reject,
      onError(error) {
        reject(error);
      },
    });
    const timer = setTimeout(() => {
      stream.abort();
      reject(new Error("SSR timeout"));
    }, 10000);
    output.on("close", () => clearTimeout(timer));
  });
  client.clear();
  return {
    html,
    state: { queryState: state, writesEnabled, local },
    queryBytes: Buffer.byteLength(JSON.stringify(state)),
  };
}
