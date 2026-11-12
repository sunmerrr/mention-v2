import assert from "node:assert/strict";
import {
  afterQuietHours,
  createMonitor,
  MONITOR_ALARM,
  nextMonitorTime,
} from "../tools/pokergosu/extension/monitor.mjs";

function fixture({ count = 2, navHook, deniedAt = 0, access } = {}) {
  let clock = 1000000,
    store = {},
    navigations = [],
    alarms = new Map(),
    offline = false,
    closed = false,
    heads = ["103", "102"];
  const tab = { id: 7, url: "https://www.pokergosu.com/free" };
  const posts = Array.from({ length: count }, (_, i) => ({
    id: String(103 + i),
    url: `https://www.pokergosu.com/free/${103 + i}`,
  }));
  const reports = [];
  const chrome = {
    storage: {
      local: {
        get: async () => structuredClone(store),
        set: async (x) => {
          store = { ...store, ...structuredClone(x) };
        },
      },
    },
    alarms: {
      clear: async (k) => alarms.delete(k),
      create: async (k, v) => alarms.set(k, v),
    },
    tabs: {
      get: async () => {
        if (closed) throw new Error("closed");
        return { ...tab };
      },
    },
  };
  const options = {
    chrome,
    now: () => clock,
    random: () => 0.5,
    makeId: () => "12345678-1234-1234-1234-123456789abc",
    show: async () => {},
    settle: async () => {},
    local: async (path, body) => {
      if (offline) throw new Error("offline");
      if (body) reports.push(structuredClone(body.data));
      return path === "/plan" ? { queue: posts, pending_threads: 9 } : {};
    },
    capture: async (t) =>
      navigations.length && navigations.length === deniedAt
        ? {
            ok: false,
            reason: access ? "BOT_CHALLENGE" : "ACCESS_RESTRICTED",
            access,
          }
        : /^\/free\/?$/.test(new URL(t.url).pathname)
          ? {
              ok: true,
              operation: "list",
              data: heads.map((id) => ({
                id,
                url: `https://www.pokergosu.com/free/${id}`,
              })),
              saved: { discovered: heads.length },
            }
          : {
              ok: true,
              operation: "thread",
              data: { id: new URL(t.url).pathname.split("/").at(-1) },
              saved: { eligible: true, metadata_missing: true },
            },
    navigate: async (_id, url) => {
      navigations.push(url);
      await navHook?.();
      tab.url = url;
    },
  };
  return {
    monitor: createMonitor(options),
    options,
    tab,
    reports,
    alarms,
    state: () => store.monitor,
    nav: () => navigations,
    due: () => {
      clock = store.monitor.nextAt;
    },
    clock: () => clock,
    setClock: (value) => {
      clock = value;
    },
    offline: () => {
      offline = true;
    },
    close: () => {
      closed = true;
    },
    heads: (ids) => {
      heads = ids;
    },
    seed: (x) => {
      store.monitor = structuredClone(x);
    },
    trial: () => {
      store.trial = { status: "running" };
    },
  };
}
let checks = 0;
{
  const f = fixture();
  await f.monitor.start(f.tab);
  assert.equal(f.nav().length, 0);
  assert.equal(f.state().phase, "board");
  checks++;
  for (let i = 0; i < 4; i++) {
    const gap = f.state().nextAt - f.clock();
    assert.ok(gap >= 30000 && gap <= 45000);
    f.due();
    await f.monitor.tick();
  }
  assert.deepEqual(f.nav(), [
    "https://www.pokergosu.com/free",
    "https://www.pokergosu.com/free/103",
    "https://www.pokergosu.com/free/104",
    "https://www.pokergosu.com/free",
  ]);
  checks++;
  assert.equal(f.state().threadsSaved, 2);
  assert.equal(f.state().matchedThreads, 2);
  assert.equal(f.state().metadataWarnings, 2);
  checks++;
  assert.equal(f.state().cyclesCompleted, 1);
  assert.equal(f.state().phase, "rest");
  assert.ok(
    f.state().nextAt - f.state().cycleStartedAt >= 1800000 &&
      f.state().nextAt - f.state().cycleStartedAt <= 3600000,
  );
  checks++;
  const prev = f.nav().length;
  await f.monitor.tick();
  assert.equal(f.nav().length, prev);
  checks++;
  await createMonitor(f.options).restore();
  assert.ok(f.alarms.has(MONITOR_ALARM));
  checks++;
}
{
  const f = fixture({ count: 6 });
  await f.monitor.start(f.tab);
  for (let i = 0; i < 8; i++) {
    f.due();
    await f.monitor.tick();
  }
  f.heads(["999"]);
  for (let i = 0; i < 12; i++) {
    f.due();
    await f.monitor.tick();
  }
  assert.equal(f.state().cyclesCompleted, 2);
  assert.equal(f.state().cycleRequests, 12);
  assert.equal(f.state().discoveryGaps, 1);
  checks++;
  assert.equal(f.nav().filter((u) => u.includes("?page=")).length, 4);
  checks++;
  assert.equal(f.nav().length, 20);
  assert.equal(f.state().threadsSaved, 12);
  checks++;
}
{
  const f = fixture({ deniedAt: 1 });
  await f.monitor.start(f.tab);
  f.due();
  await f.monitor.tick();
  assert.equal(f.state().status, "paused");
  assert.equal(f.state().reason, "ACCESS_RESTRICTED");
  assert.equal(f.state().history.at(-1).reason, "ACCESS_RESTRICTED");
  checks++;
  await f.monitor.tick();
  assert.equal(f.nav().length, 1);
  assert.equal(f.alarms.size, 0);
  checks++;
}
{
  const f = fixture();
  await f.monitor.start(f.tab);
  f.offline();
  f.due();
  await f.monitor.tick();
  assert.equal(f.nav().length, 0);
  assert.equal(f.state().reason, "LOCAL_UNAVAILABLE");
  checks++;
  const g = fixture();
  await g.monitor.start(g.tab);
  g.tab.url = "https://www.pokergosu.com/free/999";
  g.due();
  await g.monitor.tick();
  assert.equal(g.nav().length, 0);
  assert.equal(g.state().reason, "TAB_CHANGED_OR_PERMISSION_LOST");
  checks++;
  const h = fixture();
  await h.monitor.start(h.tab);
  h.close();
  h.due();
  await h.monitor.tick();
  assert.equal(h.nav().length, 0);
  assert.equal(h.state().reason, "TAB_CLOSED");
  checks++;
}
{
  const f = fixture();
  await f.monitor.start(f.tab);
  const s = f.state();
  s.navigations = 1;
  s.cycleRequests = 1;
  s.inFlight = true;
  s.nextAt = null;
  s.history = [
    {
      sequence: 1,
      cycle: 1,
      url: "https://www.pokergosu.com/free",
      startedAt: f.clock(),
      finishedAt: null,
      outcome: "inflight",
      reason: null,
    },
  ];
  f.seed(s);
  await createMonitor(f.options).restore();
  assert.equal(f.nav().length, 0);
  assert.equal(f.state().reason, "WORKER_INTERRUPTED");
  assert.equal(f.state().history[0].outcome, "unknown");
  checks++;
}
{
  let release, entered;
  const gate = new Promise((resolve) => {
    release = resolve;
  });
  const started = new Promise((resolve) => {
    entered = resolve;
  });
  const f = fixture({
    navHook: async () => {
      entered();
      await gate;
    },
  });
  await f.monitor.start(f.tab);
  f.due();
  const pending = f.monitor.tick();
  await started;
  await f.monitor.tick();
  assert.equal(f.nav().length, 1);
  checks++;
  await f.monitor.stop();
  release();
  await pending;
  assert.equal(f.state().status, "stopped");
  assert.equal(f.state().threadsSaved, 0);
  assert.equal(f.alarms.size, 0);
  checks++;
}
{
  const f = fixture();
  f.trial();
  await f.monitor.start(f.tab);
  assert.equal(f.state(), undefined);
  assert.equal(f.nav().length, 0);
  checks++;
  const g = fixture();
  await g.monitor.start(g.tab);
  await g.monitor.start(g.tab);
  assert.equal(g.state().navigations, 0);
  assert.equal(g.reports.length, 1);
  checks++;
}
{
  const f = fixture({ count: 0 });
  await f.monitor.start(f.tab);
  f.due();
  await f.monitor.tick();
  assert.equal(f.state().phase, "rest");
  assert.equal(f.state().cyclesCompleted, 1);
  assert.equal(f.nav().length, 1);
  checks++;
  const g = fixture({ count: 7 });
  await g.monitor.start(g.tab);
  g.due();
  await g.monitor.tick();
  assert.equal(g.state().reason, "INVALID_PLAN");
  assert.equal(g.nav().length, 1);
  checks++;
}
{
  const access = {
    kind: "bot_challenge",
    title: "Just a moment...",
    indicators: ["challenge-page-title"],
    basis: "visible-page",
    http_status: null,
    account_ban_confirmed: false,
  };
  const f = fixture({ deniedAt: 1, access });
  await f.monitor.start(f.tab);
  f.due();
  await f.monitor.tick();
  assert.equal(f.state().history[0].access.kind, "bot_challenge");
  assert.equal(f.reports.at(-1).history[0].access.account_ban_confirmed, false);
  checks++;
}

{
  const f = fixture();
  await f.monitor.start(f.tab);
  f.heads(["999"]);
  for (let i = 0; i < 3; i++) {
    f.due();
    await f.monitor.tick();
  }
  assert.equal(f.state().page, 4);
  f.heads(["103"]);
  await createMonitor(f.options).restore();
  f.due();
  await f.monitor.tick();
  assert.equal(f.state().discoveryGaps, 0);
  assert.equal(f.state().phase, "thread");
  assert.equal(f.nav().length, 4);
  checks++;
}
assert.equal(
  nextMonitorTime(1000, 2000, () => 0),
  1801000,
);
assert.equal(
  nextMonitorTime(1000, 2000, () => 1),
  3601000,
);
assert.equal(
  nextMonitorTime(1000, 4000000, () => 0),
  5800000,
);
{
  const f = fixture();
  await f.monitor.start(f.tab);
  for (let i = 0; i < 4; i++) {
    f.due();
    await f.monitor.tick();
  }
  const legacy = f.state();
  delete legacy.schedulePolicy;
  delete legacy.cycleStartedAt;
  legacy.nextAt = f.clock() + 60000;
  f.seed(legacy);
  await createMonitor(f.options).restore();
  assert.equal(f.state().schedulePolicy, 2);
  assert.equal(f.nav().length, 4);
  assert.ok(f.state().nextAt - f.state().cycleStartedAt >= 1800000);
  assert.ok(f.state().nextAt - f.state().cycleStartedAt <= 3600000);
  checks++;
}
const kst = (time) => Date.parse(`2026-11-13T${time}+09:00`);
{
  for (const time of ["01:59:59", "08:00:00", "23:59:59"])
    assert.equal(afterQuietHours(kst(time)), kst(time));
  for (const time of ["02:00:00", "05:30:00", "07:59:59"])
    assert.equal(afterQuietHours(kst(time)), kst("08:00:00"));
  checks++;
}
{
  const f = fixture();
  f.setClock(kst("01:59:50"));
  await f.monitor.start(f.tab);
  assert.equal(f.state().nextAt, kst("08:00:00"));
  assert.equal(f.reports.at(-1).nextAt, kst("08:00:00"));
  checks++;
  f.setClock(kst("03:00:00"));
  await f.monitor.tick();
  assert.equal(f.nav().length, 0);
  assert.equal(f.state().navigations, 0);
  checks++;
  f.due();
  await f.monitor.tick();
  assert.equal(f.nav().length, 1);
  assert.equal(f.state().phase, "thread");
  checks++;
}
{
  const f = fixture();
  await f.monitor.start(f.tab);
  f.setClock(kst("03:00:00"));
  await createMonitor(f.options).restore();
  assert.equal(f.alarms.get(MONITOR_ALARM).when, kst("08:00:00"));
  assert.equal(f.nav().length, 0);
  await f.monitor.stop();
  f.setClock(kst("08:00:00"));
  await createMonitor(f.options).restore();
  await f.monitor.tick();
  assert.equal(f.state().status, "stopped");
  assert.equal(f.alarms.size, 0);
  checks++;
}
{
  const f = fixture({ deniedAt: 1 });
  await f.monitor.start(f.tab);
  f.due();
  await f.monitor.tick();
  f.setClock(kst("08:00:00"));
  await createMonitor(f.options).restore();
  await f.monitor.tick();
  assert.equal(f.state().reason, "ACCESS_RESTRICTED");
  assert.equal(f.nav().length, 1);
  checks++;
}
{
  const f = fixture();
  f.setClock(kst("04:00:00"));
  await f.monitor.start(f.tab);
  assert.equal(f.reports.length, 0);
  assert.equal(f.state(), undefined);
  checks++;
}
console.log(
  JSON.stringify({
    checks,
    site_requests: 0,
    automatic_thread_reads: true,
    max_threads_per_cycle: 6,
    max_pages_per_cycle: 5,
  }),
);
