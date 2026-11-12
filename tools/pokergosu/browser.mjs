/** Public browser adapter. No stealth, proxy rotation, login or challenge solving. */

import { createInterface } from "node:readline";
import { pathToFileURL } from "node:url";
import { chromium } from "@playwright/test";
import { extractDocument } from "./extractor.mjs";

const origin = "https://www.pokergosu.com";
export async function extract(page, operation) {
  return page.evaluate(extractDocument, operation);
}

async function main() {
  const directory = process.argv[2];
  if (!directory) throw new Error("Runtime directory required");
  const setup = process.argv.includes("--setup");
  const context = await chromium.launchPersistentContext(
    `${directory}/browser-profile`,
    {
      executablePath:
        process.env.MENTION_CHROME ||
        "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
      headless: !setup,
      acceptDownloads: false,
      locale: "ko-KR",
      timezoneId: "Asia/Seoul",
    },
  );
  // Read-only monitoring never downloads attachments or opens popups.
  for (const signal of ["SIGTERM", "SIGINT"]) {
    process.once(signal, () => {
      void context.close().finally(() => process.exit(0));
    });
  }
  const page = context.pages()[0] || (await context.newPage());
  context.on("page", (popup) => {
    if (popup !== page) void popup.close();
  });
  try {
    if (setup) {
      await page.goto(`${origin}/free`, {
        waitUntil: "domcontentloaded",
        timeout: 45000,
      });
      process.stderr.write(
        "공개 게시판을 확인한 뒤 이 브라우저 창을 닫으세요. 로그인은 필요 없습니다.\n",
      );
      await new Promise((resolve) => context.once("close", resolve));
      return;
    }
    const lines = createInterface({ input: process.stdin });
    for await (const line of lines) {
      let reply;
      try {
        const request = JSON.parse(line);
        let url;
        if (request.operation === "robots") url = `${origin}/robots.txt`;
        else if (
          request.operation === "list" &&
          Number.isInteger(request.page) &&
          request.page >= 1 &&
          request.page <= 3
        )
          url = `${origin}/free?page=${request.page}`;
        else if (
          request.operation === "thread" &&
          /^[1-9][0-9]{0,18}$/.test(request.id)
        )
          url = `${origin}/free/${request.id}`;
        else throw new Error("INVALID_REQUEST");
        const response = await page.goto(url, {
          waitUntil: "domcontentloaded",
          timeout: 45000,
        });
        await page.waitForTimeout(1500);
        const status = response?.status();
        const title = await page.title();
        if (
          [401, 403, 429].includes(status) ||
          /just a moment|attention required|access denied/i.test(title) ||
          (await page
            .locator(
              '#challenge-running,#challenge-stage,iframe[src*="challenges.cloudflare.com"]',
            )
            .count())
        ) {
          reply = { paused: "ACCESS_RESTRICTED" };
        } else if (
          new URL(page.url()).origin !== origin ||
          /\/login/.test(new URL(page.url()).pathname)
        ) {
          reply = { paused: "UNEXPECTED_REDIRECT" };
        } else if (request.operation === "robots" && status === 404) {
          reply = { data: { status, text: "" } };
        } else if (status !== 200) {
          reply = { error: `HTTP_${status || "UNKNOWN"}` };
        } else if (request.operation === "robots") {
          const text = (await page.locator("body").textContent()) || "";
          reply = /<html|보안 확인|enable javascript and cookies/i.test(text)
            ? { paused: "ROBOTS_UNAVAILABLE" }
            : { data: { status, text } };
        } else {
          reply = await extract(page, request.operation);
        }
      } catch {
        reply = { error: "BROWSER_NAVIGATION_FAILED" };
      }
      process.stdout.write(`${JSON.stringify(reply)}\n`);
    }
  } finally {
    await context.close().catch(() => {});
  }
}
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  main().catch(() => {
    process.stderr.write("Browser adapter failed\n");
    process.exitCode = 1;
  });
}
