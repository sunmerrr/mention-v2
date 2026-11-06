import { defineConfig } from "@playwright/test";
export default defineConfig({
  testDir: "tests/browser",
  workers: 1,
  use: {
    baseURL: process.env.MENTION_TEST_URL || "http://127.0.0.1:8790",
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
