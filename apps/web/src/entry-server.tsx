import { PassThrough } from "node:stream";
import {
  dehydrate,
  HydrationBoundary,
  QueryClientProvider,
} from "@tanstack/react-query";
import { renderToPipeableStream } from "react-dom/server";
import { StaticRouter } from "react-router-dom";
import type { MonitoringQueries } from "../../../packages/application/src/queries";
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
export async function render(
  url: string,
  queries: MonitoringQueries,
  writesEnabled: boolean,
) {
  const requestUrl = new URL(url, "http://localhost"),
    scope = scopeFrom(requestUrl.search),
    label = requestUrl.searchParams.get("label") || "",
    client = createQueryClient();
  await preloadRoute(requestUrl.pathname);
  const listInput = listSchema.parse({ ...scope, label });
  const detail = /^\/conversations\/([^/]+)$/.exec(requestUrl.pathname);
  if (detail)
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
      requestUrl.pathname === "/reviews"
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
  const state = dehydrate(client);
  const tree = (
    <RuntimeContext.Provider value={{ writesEnabled }}>
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
    state: { queryState: state, writesEnabled },
    queryBytes: Buffer.byteLength(JSON.stringify(state)),
  };
}
