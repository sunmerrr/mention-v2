import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { readConfig } from "../apps/read-api/src/config";
import { isPagePath } from "../apps/read-api/src/page-paths";
import {
  GlobalRenderFailure,
  isChunkFailure,
  PageRenderFailure,
} from "../apps/web/src/components/RenderFailure";
import { DesignSystemProvider } from "../apps/web/src/design-system";

describe("template request and render boundaries", () => {
  it("allows product routes and rejects scanner, missing asset and malformed detail paths", () => {
    for (const path of ["/", "/keywords", "/conversations/abc-123", "/reviews"])
      expect(isPagePath(path)).toBe(true);
    for (const path of [
      "/wso.php",
      "/.env",
      "/.git/config",
      "/robots.txt",
      "/sitemap.xml",
      "/assets/missing.js",
      "/conversations/a/b",
      "/not-a-page",
    ])
      expect(isPagePath(path)).toBe(false);
  });
  it("hides internal render errors and offers a distinct chunk refresh action", () => {
    const error = new Error("private internal detail");
    const html = renderToStaticMarkup(
      <DesignSystemProvider>
        <PageRenderFailure error={error} resetErrorBoundary={() => {}} />
      </DesignSystemProvider>,
    );
    expect(html).not.toContain(error.message);
    expect(html).toContain("다시 시도");
    expect(
      isChunkFailure(new Error("Failed to fetch dynamically imported module")),
    ).toBe(true);
    expect(isChunkFailure(error)).toBe(false);
    expect(renderToStaticMarkup(<GlobalRenderFailure />)).toContain("새로고침");
  });
});

describe("boot configuration", () => {
  it("preserves defaults and rejects malformed overrides without exposing values", () => {
    expect(readConfig({})).toEqual({
      port: 8790,
      keepAliveTimeoutMs: 970000,
      buildId: "development",
      runtimeDir: undefined,
      listenHost: "127.0.0.1",
      writesEnabled: undefined,
      legacyUrl: "http://127.0.0.1:8766",
    });
    expect(readConfig({ MENTION_ENABLE_WRITES: "0" }).writesEnabled).toBe(
      false,
    );
    for (const value of ["0", "65536", "NaN", ""])
      expect(() => readConfig({ MENTION_PORT: value })).toThrow("MENTION_PORT");
    expect(() => readConfig({ MENTION_ENABLE_WRITES: "yes" })).toThrow(
      "MENTION_ENABLE_WRITES",
    );
    expect(() =>
      readConfig({ MENTION_LEGACY_URL: "private-invalid-value" }),
    ).toThrow(/^Invalid configuration fields: MENTION_LEGACY_URL$/);
  });
});
