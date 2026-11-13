/** Real unpacked-extension test in an isolated Chrome profile, synthetic site only.
 * Uses a separate loopback port18791. Never points at production storage.
 */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import {
  appendFile,
  copyFile,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { chromium } from "@playwright/test";

const port = 18791;
const root = await mkdtemp(`${tmpdir()}/mention-extension-e2e-`);
const folder = `${root}/extension`;
await mkdir(folder);
for (const name of ["manifest.json", "background.mjs", "control.mjs"])
  await copyFile(`tools/pokergosu/extension/${name}`, `${folder}/${name}`);
await copyFile("tools/pokergosu/extractor.mjs", `${folder}/extractor.mjs`);
await copyFile("tools/pokergosu/extension/trial.mjs", `${folder}/trial.mjs`);
await copyFile(
  "tools/pokergosu/extension/monitor.mjs",
  `${folder}/monitor.mjs`,
);
// Redirect only the disposable package to a separate synthetic receiver so the
// real collector can keep running while this test exercises native Chrome.
for (const name of ["background.mjs", "manifest.json"]) {
  const path = `${folder}/${name}`;
  await writeFile(
    path,
    (await readFile(path, "utf8")).replaceAll(":8791", `:${port}`),
  );
}
// Persistent permission is pregranted only in this isolated synthetic profile.
const fixtureManifest = JSON.parse(
  await readFile(`${folder}/manifest.json`, "utf8"),
);
fixtureManifest.host_permissions.push("https://www.pokergosu.com/*");
await writeFile(`${folder}/manifest.json`, JSON.stringify(fixtureManifest));
// Test-only CDP handle in the isolated fixture, never in the user package.
await appendFile(
  `${folder}/background.mjs`,
  "\nglobalThis.__mentionTrialForTest = trial; globalThis.__mentionMonitorForTest = monitor; globalThis.__mentionControlForTest = control;\n",
);
const token = randomBytes(32).toString("hex");
await writeFile(
  `${folder}/connection.json`,
  JSON.stringify({ endpoint: `http://127.0.0.1:${port}`, token }),
  { mode: 0o600 },
);
let received, context;
const captures = [];
let controlCommand = null;
const controlReceipts = [];
const server = createServer(async (req, res) => {
  if (
    req.headers.authorization !== `Bearer ${token}` ||
    !/^[a-p]{32}$/.test(req.headers["x-mention-extension"] || "")
  ) {
    res.writeHead(403);
    res.end();
    return;
  }
  res.setHeader("Content-Type", "application/json");
  if (req.url === "/control/poll" || req.url === "/control/ack") {
    let body = "";
    for await (const chunk of req) body += chunk;
    const data = JSON.parse(body);
    if (req.url === "/control/ack") {
      controlReceipts.push(data);
      res.end('{"acknowledged":true}');
    } else {
      const command = controlCommand;
      controlCommand = null;
      res.end(JSON.stringify({ command }));
    }
    return;
  }
  if (req.url === "/status") {
    res.end('{"threads":0,"matched":0}');
    return;
  }
  if (req.url.startsWith("/strategy?cycle=")) {
    res.end(
      JSON.stringify({
        mode: "search",
        term: "APL",
        scope: "1",
        url: "https://www.pokergosu.com/free/search?s=1&v=APL",
        expiresAt: Date.now() + 3600000,
      }),
    );
    return;
  }
  if (req.url === "/search/plan") {
    let body = "";
    for await (const chunk of req) body += chunk;
    const data = JSON.parse(body);
    assert.deepEqual(data, {
      url: "https://www.pokergosu.com/free/search?s=1&v=APL",
      ids: ["124"],
    });
    res.end(
      JSON.stringify({
        queue: [{ id: "124", url: "https://www.pokergosu.com/free/124" }],
        pending_threads: 1,
      }),
    );
    return;
  }
  if (req.url === "/plan") {
    res.end(
      JSON.stringify({
        queue: [{ id: "124", url: "https://www.pokergosu.com/free/124" }],
        pending_threads: 1,
      }),
    );
    return;
  }
  if (req.url === "/capture") {
    let body = "";
    for await (const chunk of req) body += chunk;
    received = JSON.parse(body);
    captures.push(received);
    if (received.operation === "monitor") {
      const validation = spawnSync(
        "python3",
        [
          "-c",
          "import sys,json;sys.path.insert(0,'tools/pokergosu');from monitor_policy import monitor_record;monitor_record(json.load(sys.stdin))",
        ],
        { input: JSON.stringify(received.data), encoding: "utf8" },
      );
      if (validation.status !== 0) {
        res.writeHead(400);
        res.end(JSON.stringify({ error: "INVALID_MONITOR" }));
        return;
      }
    }
    res.end(
      JSON.stringify(
        received.operation === "list"
          ? { discovered: 1 }
          : received.operation === "trial"
            ? { trial_saved: true }
            : received.operation === "monitor"
              ? { monitor_saved: true }
              : {
                  comments: received.data.comments.length,
                  eligible: true,
                  comment_summary: {
                    saved: received.data.comments.length,
                    media_only: received.data.comments.filter(
                      (c) => c.content_kind === "media_only",
                    ).length,
                    skipped: received.data.skipped_comments?.length || 0,
                    unavailable: received.data.unavailable_comments ?? 0,
                    coverage: received.data.comment_coverage,
                  },
                },
      ),
    );
    return;
  }
  res.writeHead(404);
  res.end();
});
try {
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, "127.0.0.1", resolve);
  });
  context = await chromium.launchPersistentContext(`${root}/profile`, {
    executablePath:
      process.env.MENTION_CHROME ||
      "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    headless: true,
    ignoreDefaultArgs: ["--disable-extensions"],
    args: ["--enable-unsafe-extension-debugging"],
  });
  // CDP initial loading bypasses the developer-mode gate; ordinary reload does
  // not. Enable it only inside this disposable test profile, as a user would.
  const setupPage = context.pages()[0];
  await setupPage.goto("chrome://extensions");
  await setupPage.evaluate(async () =>
    chrome.developerPrivate.updateProfileConfiguration({
      inDeveloperMode: true,
    }),
  );
  const cdp = await context.browser().newBrowserCDPSession();
  const { id } = await cdp.send("Extensions.loadUnpacked", { path: folder });
  const worker =
    context.serviceWorkers()[0] ||
    (await context.waitForEvent("serviceworker", { timeout: 10000 }));
  await worker.evaluate(() => chrome.runtime.id);
  const page = context.pages()[0];
  let navigations = 0;
  await context.route("https://www.pokergosu.com/**", (route) => {
    // The synthetic pages have no subframes. A newly created tab may issue its
    // first navigation before Playwright exposes a Frame object.
    if (route.request().isNavigationRequest()) navigations++;
    return route.fulfill({
      status: 200,
      contentType: "text/html; charset=utf-8",
      body:
        new URL(route.request().url()).pathname === "/free/search"
          ? '<title>검색 - 포커고수</title><div><div class="lg:px-6"><p>"APL" 검색결과 1개</p><div class="boarddocument"><table><tr><td><a href="/free/124?s=1&v=APL">synthetic result</a></td></tr></table></div></div></div>'
          : new URL(route.request().url()).pathname === "/free"
            ? '<div class="col-main"><h1>자유 게시판</h1><article><table><tr><td><a href="/free/123">synthetic topic</a></td></tr></table></article></div>'
            : '<h1>synthetic</h1><article><div class="post-content">ordinary</div></article><span data-comment-count="3">댓글 수 3</span><div id="comment_42"><div class="comment-content">APL 광고</div></div><div id="comment_43"><div class="comment-content"><img src="/synthetic.png"></div></div><div id="comment_44"><div class="comment-content"></div></div>',
    });
  });
  let firstPopulatedMs;
  await page.goto("https://www.pokergosu.com/free/123");
  const { targetInfos } = await cdp.send("Target.getTargets", {
    filter: [{ type: "tab", exclude: false }, { exclude: true }],
  });
  const targetInfo = targetInfos.find((info) => info.url === page.url());
  assert.ok(targetInfo, "Synthetic page must have a browser tab target");
  await cdp.send("Extensions.triggerAction", {
    id,
    targetId: targetInfo.targetId,
  });
  const deadline = Date.now() + 15000;
  while (!received && Date.now() < deadline)
    await new Promise((resolve) => setTimeout(resolve, 100));
  assert.ok(
    received,
    "Actual extension action must reach the authenticated loopback receiver",
  );
  assert.equal(received.operation, "thread");
  assert.equal(received.data.comments[0].text, "APL 광고");
  const result = await worker.evaluate(async () => {
    const { lastResult } = await chrome.storage.local.get("lastResult");
    return lastResult;
  });
  assert.ok(result.text.includes("포함 키워드 발견"));
  await page.goto("https://www.pokergosu.com/free");
  await worker.evaluate(async () => {
    const trial = globalThis.__mentionTrialForTest;
    const [tab] = await chrome.tabs.query({
      active: true,
      lastFocusedWindow: true,
    });
    await trial.start(tab);
  });
  const armed = await worker.evaluate(async () => {
    const { trial } = await chrome.storage.local.get("trial");
    const alarm = await chrome.alarms.get("mention-pokergosu-trial");
    return { trial, alarm, now: Date.now() };
  });
  assert.equal(armed.trial.attempted, 0);
  assert.ok(
    armed.alarm.scheduledTime - armed.now >= 890000 &&
      armed.alarm.scheduledTime - armed.now <= 1800000,
  );
  const beforeReload = navigations;
  const single = await worker.evaluate(async () => {
    const trial = globalThis.__mentionTrialForTest;
    const state = (await chrome.storage.local.get("trial")).trial;
    state.nextAt = Date.now() - 1;
    await chrome.storage.local.set({ trial: state });
    await trial.tick();
    const result = (await chrome.storage.local.get("trial")).trial;
    await trial.stop();
    return result;
  });
  assert.equal(single.attempted, 1);
  assert.equal(single.successful, 1);
  assert.equal(navigations, beforeReload + 1);
  assert.equal(
    await worker.evaluate(async () =>
      Boolean(await chrome.alarms.get("mention-pokergosu-trial")),
    ),
    false,
  );
  await worker.evaluate(async () => {
    const monitor = globalThis.__mentionMonitorForTest;
    const [tab] = await chrome.tabs.query({
      active: true,
      lastFocusedWindow: true,
    });
    await monitor.start(tab);
  });
  const monitorStart = await worker.evaluate(
    async () => (await chrome.storage.local.get("monitor")).monitor,
  );
  assert.equal(monitorStart.phase, "board");
  const beforeAuto = navigations;
  const autoStartedAt = Date.now();
  for (let i = 0; i < 3; i++) {
    await worker.evaluate(async () => {
      const state = (await chrome.storage.local.get("monitor")).monitor;
      state.nextAt = Date.now();
      await chrome.storage.local.set({ monitor: state });
      // Accelerated alarm timing exists only in this isolated test profile.
      await chrome.alarms.create("mention-pokergosu-monitor", {
        when: Date.now() + 1000,
      });
    });
    const deadline = Date.now() + 45000;
    let completed = false;
    while (Date.now() < deadline) {
      const state = await worker.evaluate(
        async () => (await chrome.storage.local.get("monitor")).monitor,
      );
      if (state.navigations === i + 1 && !state.inFlight) {
        completed = true;
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    assert.ok(
      completed,
      "Native Chrome alarm must advance automatic collection without a click",
    );
    if (i === 1) firstPopulatedMs = Date.now() - autoStartedAt - 2000;
  }
  const auto = await worker.evaluate(
    async () => (await chrome.storage.local.get("monitor")).monitor,
  );
  assert.equal(auto.threadsSaved, 1);
  assert.equal(
    auto.history[0].url,
    "https://www.pokergosu.com/free/search?s=1&v=APL",
  );
  assert.ok(
    captures.some(
      (c) =>
        c.operation === "list" &&
        c.page_url === "https://www.pokergosu.com/free/search?s=1&v=APL",
    ),
  );
  assert.deepEqual(
    auto.history.find((e) => e.url.endsWith("/124")).comment_summary,
    {
      saved: 2,
      media_only: 1,
      skipped: 1,
      unavailable: 0,
      coverage: "partial",
    },
  );
  assert.equal(auto.cyclesCompleted, 1);
  assert.equal(auto.phase, "rest");
  assert.equal(navigations, beforeAuto + 3);
  assert.ok(
    captures.some(
      (c) =>
        c.operation === "thread" &&
        c.data.id === "124" &&
        c.data.comments[0].text === "APL 광고",
    ),
  );
  assert.ok(
    auto.nextAt - auto.cycleStartedAt >= 1800000 &&
      auto.nextAt - auto.cycleStartedAt <= 3600000,
  );
  await worker.evaluate(async () => globalThis.__mentionMonitorForTest.stop());
  assert.equal(
    await worker.evaluate(async () =>
      Boolean(await chrome.alarms.get("mention-pokergosu-monitor")),
    ),
    false,
  );
  // No extension action is triggered after this point. Simulate the already
  // granted site permission, then exercise the authenticated local command path.
  const anchor = await context.newPage();
  await anchor.goto("about:blank");
  await page.close();
  await worker.evaluate(async () => {
    await globalThis.__mentionControlForTest.grant(true);
  });
  const issue = async (action, targetVersion = null) => {
    controlCommand = {
      id: `synthetic-${action}`,
      action,
      targetVersion,
      createdAt: Date.now(),
      expiresAt: Date.now() + 120000,
    };
    await worker.evaluate(async () =>
      globalThis.__mentionControlForTest.poll(),
    );
  };
  await issue("resume");
  assert.equal(controlReceipts.at(-1).result.code, "STARTED");
  const remoteState = await worker.evaluate(
    async () => (await chrome.storage.local.get("monitor")).monitor,
  );
  assert.equal(remoteState.status, "running");
  assert.ok(remoteState.tabId);
  assert.equal(
    context.pages().length,
    2,
    "Local start creates its own inactive tab",
  );
  await issue("stop");
  assert.equal(controlReceipts.at(-1).result.code, "STOPPED");
  const beforeRemoteReload = navigations;
  fixtureManifest.version = "0.5.2";
  await writeFile(`${folder}/manifest.json`, JSON.stringify(fixtureManifest));
  controlCommand = {
    id: "synthetic-reload",
    action: "reload",
    targetVersion: "0.5.2",
    createdAt: Date.now(),
    expiresAt: Date.now() + 120000,
  };
  try {
    await worker.evaluate(async () =>
      globalThis.__mentionControlForTest.poll(),
    );
  } catch (error) {
    if (!/closed|destroyed|context/i.test(String(error))) throw error;
  }
  const reloadDeadline = Date.now() + 20000;
  while (
    !controlReceipts.some((r) => r.id === "synthetic-reload") &&
    Date.now() < reloadDeadline
  )
    await new Promise((resolve) => setTimeout(resolve, 100));
  assert.equal(
    controlReceipts.find((r) => r.id === "synthetic-reload")?.result.code,
    "RELOADED",
  );
  assert.equal(navigations, beforeRemoteReload, "Reload preserves manual stop");
  console.log(
    JSON.stringify({
      local_start_stop_reload_without_action_clicks: true,
      unpacked_extension_loaded: true,
      active_tab_action: true,
      authenticated_capture: true,
      site_requests_intercepted: true,
      native_alarm_armed: true,
      one_native_reload: true,
      stopped_cleanly: true,
      automatic_thread_and_comment_capture: true,
      unreadable_comment_skipped_without_stopping: true,
      advanced_by_native_alarms_without_action_clicks: true,
      automatic_return_and_next_cycle: true,
      keyword_search_and_result_only_plan: true,
      first_populated_after_due_ms: firstPopulatedMs,
      populated_capture_bytes: Buffer.byteLength(
        JSON.stringify(
          captures.find(
            (c) => c.operation === "thread" && c.data.id === "124",
          ) || {},
        ),
      ),
    }),
  );
} finally {
  if (context) await context.close();
  server.closeAllConnections();
  await new Promise((resolve) => server.close(resolve));
  await rm(root, { recursive: true, force: true });
}
