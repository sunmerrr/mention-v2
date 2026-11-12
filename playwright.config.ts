import { defineConfig } from "@playwright/test";
export default defineConfig({
  testDir: "tests/browser",
  workers: 1,
  testMatch:
    process.env.MENTION_LIVE_E2E === "1"
      ? "workspace.spec.ts"
      : "synthetic.spec.ts",
  webServer:
    process.env.MENTION_LIVE_E2E === "1"
      ? undefined
      : {
          command: "bash scripts/dev.sh test",
          url: "http://127.0.0.1:8798/health",
          reuseExistingServer: false,
          timeout: 30000,
        },
  use: {
    baseURL:
      process.env.MENTION_LIVE_E2E === "1"
        ? process.env.MENTION_TEST_URL || "http://127.0.0.1:8790"
        : "http://127.0.0.1:8798",
    headless: true,
    launchOptions: {
      executablePath:
        process.env.MENTION_CHROME ||
        (process.platform === "darwin"
          ? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
          : undefined),
    },
  },
  reporter: "list",
});
