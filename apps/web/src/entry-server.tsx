import {
  dehydrate,
  HydrationBoundary,
  QueryClientProvider,
} from "@tanstack/react-query";
import { renderToReadableStream } from "react-dom/server.browser";
import { StaticRouter } from "react-router-dom";
import {
  PokergosuPostNotFound,
  type PokergosuQueries,
} from "../../../packages/application/src/pokergosu";
import type { MonitoringQueries } from "../../../packages/application/src/queries";
import type { WorkspaceQueries } from "../../../packages/application/src/workspace";
import { listSchema } from "../../../packages/contracts/src/api";
import { pokergosuListSchema } from "../../../packages/contracts/src/pokergosu";
import { App, preloadRoute } from "./App";
import {
  pokergosuDetailQuery,
  pokergosuFilters,
  pokergosuQuery,
} from "./pokergosu-query";
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
  pokergosu?: PokergosuQueries,
) {
  const requestUrl = new URL(url, "http://localhost"),
    scope = scopeFrom(requestUrl.search),
    label = requestUrl.searchParams.get("label") || "",
    client = createQueryClient();
  await preloadRoute(requestUrl.pathname);
  const conversationLabel = label === "unreviewed" ? "" : label;
  const conversationStatus =
    requestUrl.searchParams.get("status") ||
    (label === "unreviewed" ? "pending" : "");
  const listInput = listSchema.parse({
    ...scope,
    label: requestUrl.pathname === "/conversations" ? conversationLabel : label,
    status: requestUrl.pathname === "/conversations" ? conversationStatus : "",
  });
  const detail = /^\/conversations\/([^/]+)$/.exec(requestUrl.pathname);
  const feature = routeFeature(requestUrl.pathname);
  const pokergosuId = /^\/pokergosu\/([1-9][0-9]{0,18})$/.exec(
    requestUrl.pathname,
  )?.[1];
  if (pokergosuId && pokergosu) {
    await client.fetchQuery({
      ...pokergosuDetailQuery(pokergosuId),
      queryFn: async () => {
        const result = await pokergosu.detail(pokergosuId);
        if (!result) throw new PokergosuPostNotFound("Post not found");
        return result;
      },
    });
  } else if (requestUrl.pathname === "/pokergosu" && pokergosu) {
    await client.fetchInfiniteQuery({
      ...pokergosuQuery(requestUrl.search),
      queryFn: () =>
        pokergosu.list(
          pokergosuListSchema.parse(pokergosuFilters(requestUrl.search)),
        ),
    });
  } else if (feature && workspace) {
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
              ...conversationsQuery(
                scope,
                conversationLabel,
                conversationStatus,
              ),
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
  // React 18's Node byte-packing path can insert NUL padding between Korean
  // characters. Its Web Streams renderer encodes strings before packing bytes.
  let renderError: unknown;
  const stream = await renderToReadableStream(tree, {
    signal: AbortSignal.timeout(10000),
    onError(error) {
      renderError = error;
    },
  });
  await stream.allReady;
  if (renderError) {
    await stream.cancel();
    throw renderError;
  }
  const html = await new Response(stream).text();
  client.clear();
  return {
    html,
    state: { queryState: state, writesEnabled, local },
    queryBytes: Buffer.byteLength(JSON.stringify(state)),
  };
}
