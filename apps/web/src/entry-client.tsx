import "@radix-ui/themes/styles.css";
import "./style.css";
import type { DehydratedState } from "@tanstack/react-query";
import { HydrationBoundary, QueryClientProvider } from "@tanstack/react-query";
import { hydrateRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import { App, preloadRoute } from "./App";
import { createQueryClient } from "./query-client";
import { RuntimeContext } from "./runtime";

async function hydrate() {
  const element = document.getElementById("mention-state"),
    root = document.getElementById("root");
  if (!element || !root) throw new Error("Missing SSR bootstrap");
  const state = JSON.parse(element.textContent || "") as {
    queryState: DehydratedState;
    writesEnabled: boolean;
    local: boolean;
  };
  await preloadRoute(location.pathname);
  hydrateRoot(
    root,
    <RuntimeContext.Provider
      value={{ writesEnabled: state.writesEnabled, local: state.local }}
    >
      <QueryClientProvider client={createQueryClient()}>
        <HydrationBoundary state={state.queryState}>
          <BrowserRouter>
            <App />
          </BrowserRouter>
        </HydrationBoundary>
      </QueryClientProvider>
    </RuntimeContext.Provider>,
    {
      onRecoverableError(error) {
        console.error(
          "Hydration failed",
          error instanceof Error ? error.message : "unknown",
        );
      },
    },
  );
  document.documentElement.dataset.hydrated = "true";
}
hydrate().catch(() => {
  const message = document.createElement("p");
  message.textContent =
    "화면 조작 기능을 연결하지 못했습니다. 새로고침해 주세요.";
  document.body.append(message);
});
