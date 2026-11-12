import assert from "node:assert/strict";
import { copyFile, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { pathToFileURL } from "node:url";
import { chromium } from "@playwright/test";

const browser = await chromium.launch({
  executablePath:
    process.env.MENTION_CHROME ||
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  headless: true,
});
const folder = await mkdtemp(`${tmpdir()}/mention-extension-test-`);
await copyFile(
  "tools/pokergosu/extension/background.mjs",
  `${folder}/background.mjs`,
);
await copyFile("tools/pokergosu/extractor.mjs", `${folder}/extractor.mjs`);
await copyFile("tools/pokergosu/extension/trial.mjs", `${folder}/trial.mjs`);
await copyFile(
  "tools/pokergosu/extension/monitor.mjs",
  `${folder}/monitor.mjs`,
);
await copyFile(
  "tools/pokergosu/extension/control.mjs",
  `${folder}/control.mjs`,
);
let checks = 0;
const originalFetch = globalThis.fetch;
try {
  const page = await browser.newPage();
  let markup = "";
  let websiteRequests = 0;
  await page.route("**/*", (route) => {
    websiteRequests++;
    return route.fulfill({
      status: 200,
      contentType: "text/html; charset=utf-8",
      body: markup,
    });
  });
  let installedListener;
  const menus = [];
  const calls = [],
    titles = [],
    badges = [];
  globalThis.chrome = {
    runtime: {
      id: "a".repeat(32),
      getURL: (path) => `chrome-extension://${"a".repeat(32)}/${path}`,
      onInstalled: {
        addListener(fn) {
          installedListener = fn;
        },
      },
      onStartup: { addListener() {} },
    },
    action: {
      onClicked: { addListener() {} },
      setTitle: async (x) => titles.push(x.title),
      setBadgeText: async (x) => badges.push(x.text),
    },
    contextMenus: {
      onClicked: { addListener() {} },
      removeAll: (fn) => fn(),
      create(properties) {
        menus.push(properties);
      },
    },
    storage: { local: { set: async () => {}, get: async () => ({}) } },
    alarms: { clear: async () => {}, onAlarm: { addListener() {} } },
    scripting: {
      executeScript: async ({ func, args }) => [
        { result: await page.evaluate(func, args?.[0]) },
      ],
    },
  };
  let offline = false;
  globalThis.fetch = async (url, options) => {
    if (String(url).endsWith("connection.json"))
      return new Response(
        JSON.stringify({
          endpoint: "http://127.0.0.1:8791",
          token: "synthetic-token",
        }),
      );
    assert.ok(String(url).startsWith("http://127.0.0.1:8791/"));
    if (offline) throw new Error("offline");
    calls.push({ url, options });
    return new Response(
      JSON.stringify(
        String(url).endsWith("/capture")
          ? { comments: 1, eligible: true, discovered: 1 }
          : { threads: 0, matched: 0 },
      ),
    );
  };
  const { capture } = await import(
    pathToFileURL(`${folder}/background.mjs`).href
  );
  installedListener();
  assert.ok(menus.filter((m) => !m.parentId).length <= 6);
  checks++;
  assert.equal(menus.find((m) => m.id === "trial-stop").parentId, "trial");
  checks++;
  assert.equal(menus.find((m) => m.id === "monitor-stop").parentId, undefined);
  checks++;
  async function load(html, path = "/free/123") {
    markup = html;
    await page.goto(`https://www.pokergosu.com${path}`);
  }
  await load(
    '<h1>synthetic</h1><article><div class="post-content">ordinary</div></article><span data-comment-count="1">댓글 수 1</span><div id="comment_42"><div class="comment-content">APL 광고</div></div>',
  );
  const tab = { id: 1, url: page.url() };
  await capture(tab);
  let saved = JSON.parse(calls.at(-1).options.body);
  assert.equal(saved.operation, "thread");
  checks++;
  assert.equal(saved.data.comments[0].text, "APL 광고");
  checks++;
  assert.equal(badges.at(-1), "발견");
  checks++;
  assert.equal(
    calls[0].options.headers.Authorization,
    "Bearer synthetic-token",
  );
  checks++;
  assert.equal(calls.length, 2);
  checks++;
  assert.equal(websiteRequests, 1);
  checks++;
  calls.length = 0;
  await Promise.all([capture(tab), capture(tab)]);
  assert.equal(calls.filter((c) => c.url.endsWith("/capture")).length, 1);
  checks++;
  calls.length = 0;
  await capture({ id: 1, url: "https://evil.invalid/" });
  assert.equal(calls.length, 0);
  checks++;
  await load(
    '<h1>unknown markup</h1><div class="new-post"><input type="hidden" value="synthetic-private-value">ordinary</div>',
  );
  await capture(tab);
  saved = JSON.parse(calls.at(-1).options.body);
  assert.equal(saved.operation, "diagnostic");
  checks++;
  assert.ok(!JSON.stringify(saved).includes("synthetic-private-value"));
  checks++;
  calls.length = 0;
  await load("<title>Just a moment...</title><h1>Challenge</h1>");
  await capture(tab);
  assert.equal(calls.filter((c) => c.url.endsWith("/capture")).length, 0);
  checks++;
  assert.ok(titles.at(-1).includes("보안") && titles.at(-1).includes("봇"));
  checks++;
  offline = true;
  calls.length = 0;
  await capture(tab);
  assert.equal(calls.length, 0);
  checks++;
  assert.equal(badges.at(-1), "!");
  checks++;
  console.log(JSON.stringify({ checks, unintercepted_site_requests: 0 }));
} finally {
  globalThis.fetch = originalFetch;
  delete globalThis.chrome;
  await browser.close();
  await rm(folder, { recursive: true, force: true });
}
