import assert from "node:assert/strict";
import {
  createTrial,
  TRIAL_ALARM,
} from "../tools/pokergosu/extension/trial.mjs";

function setup({ failAt = 0, reloadHook } = {}) {
  let clock = 1000000,
    data = {},
    alarms = new Map(),
    reloads = 0,
    captures = 0,
    offline = false,
    missing = false;
  const tab = { id: 7, url: "https://www.pokergosu.com/free" };
  const reports = [];
  const chrome = {
    storage: {
      local: {
        get: async () => structuredClone(data),
        set: async (value) => {
          data = { ...data, ...structuredClone(value) };
        },
      },
    },
    alarms: {
      clear: async (key) => alarms.delete(key),
      create: async (key, value) => alarms.set(key, value),
    },
    tabs: {
      get: async () => {
        if (missing) throw new Error("closed");
        return { ...tab };
      },
    },
  };
  const options = {
    chrome,
    now: () => clock,
    random: () => 0.5,
    makeId: () => "12345678-1234-1234-1234-123456789abc",
    local: async (_path, body) => {
      if (offline) throw new Error("offline");
      if (body) reports.push(structuredClone(body.data));
      return {};
    },
    capture: async () => {
      captures++;
      return captures > 1 && captures - 1 === failAt
        ? { ok: false, reason: "ACCESS_RESTRICTED" }
        : { ok: true, operation: "list" };
    },
    show: async () => {},
    settle: async () => {},
    reload: async () => {
      reloads++;
      await reloadHook?.();
    },
  };
  return {
    trial: createTrial(options),
    options,
    tab,
    reports,
    alarms,
    state: () => data.trial,
    reloads: () => reloads,
    captures: () => captures,
    due: () => {
      clock = data.trial.nextAt;
    },
    late: () => {
      clock = data.trial.nextAt + 86400000;
    },
    clock: () => clock,
    offline: () => {
      offline = true;
    },
    close: () => {
      missing = true;
    },
    seed: (value) => {
      data = { trial: structuredClone(value) };
    },
  };
}
let checks = 0;
{
  const f = setup();
  await f.trial.start(f.tab);
  assert.equal(f.reloads(), 0);
  assert.equal(f.state().attempted, 0);
  checks++;
  for (let i = 1; i <= 15; i++) {
    const gap = f.state().nextAt - f.clock();
    assert.ok(gap >= 900000 && gap <= 1800000);
    f.due();
    await f.trial.tick();
    assert.equal(f.state().attempted, i);
  }
  assert.equal(f.reloads(), 15);
  assert.equal(f.state().successful, 15);
  assert.equal(f.state().status, "completed");
  checks++;
  assert.equal(f.state().history.length, 15);
  assert.equal(f.alarms.has(TRIAL_ALARM), false);
  checks++;
  await f.trial.tick();
  await createTrial(f.options).restore();
  assert.equal(f.reloads(), 15);
  assert.equal(f.alarms.has(TRIAL_ALARM), false);
  checks++;
  assert.ok(f.reports.some((r) => r.inFlight && r.attempted === 15));
  checks++;
}
{
  const f = setup({ failAt: 3 });
  await f.trial.start(f.tab);
  for (let i = 0; i < 3; i++) {
    f.due();
    await f.trial.tick();
  }
  assert.equal(f.state().status, "stopped");
  assert.equal(f.state().reason, "ACCESS_RESTRICTED");
  assert.equal(f.reloads(), 3);
  assert.equal(f.state().successful, 2);
  checks++;
  await f.trial.tick();
  assert.equal(f.reloads(), 3);
  assert.equal(f.alarms.size, 0);
  checks++;
}
{
  const f = setup();
  await f.trial.start(f.tab);
  await f.trial.tick();
  assert.equal(f.reloads(), 0);
  checks++;
  f.offline();
  f.due();
  await f.trial.tick();
  assert.equal(f.reloads(), 0);
  assert.equal(f.state().reason, "LOCAL_UNAVAILABLE");
  checks++;
}
{
  const f = setup();
  await f.trial.start(f.tab);
  const state = f.state();
  state.attempted = 1;
  state.nextAt = null;
  state.inFlight = true;
  state.history = [
    {
      sequence: 1,
      startedAt: f.clock(),
      finishedAt: null,
      outcome: "inflight",
      reason: null,
    },
  ];
  f.seed(state);
  await createTrial(f.options).restore();
  assert.equal(f.reloads(), 0);
  assert.equal(f.state().history[0].outcome, "unknown");
  assert.equal(f.state().reason, "WORKER_INTERRUPTED");
  checks++;
}
{
  const f = setup();
  await f.trial.start(f.tab);
  f.close();
  f.due();
  await f.trial.tick();
  assert.equal(f.reloads(), 0);
  assert.equal(f.state().reason, "TAB_CLOSED");
  checks++;
  const g = setup();
  await g.trial.start(g.tab);
  g.tab.url = "https://www.pokergosu.com/free/123";
  g.due();
  await g.trial.tick();
  assert.equal(g.reloads(), 0);
  assert.equal(g.state().reason, "TAB_CHANGED_OR_PERMISSION_LOST");
  checks++;
}
{
  let release;
  let entered;
  const gate = new Promise((resolve) => {
    release = resolve;
  });
  const signal = new Promise((resolve) => {
    entered = resolve;
  });
  const f = setup({
    reloadHook: async () => {
      entered();
      await gate;
    },
  });
  await f.trial.start(f.tab);
  f.due();
  const pending = f.trial.tick();
  await signal;
  await f.trial.stop();
  release();
  await pending;
  assert.equal(f.state().status, "stopped");
  assert.equal(f.reloads(), 1);
  assert.equal(f.captures(), 1);
  checks++;
}
{
  let release;
  let entered;
  const gate = new Promise((resolve) => {
    release = resolve;
  });
  const signal = new Promise((resolve) => {
    entered = resolve;
  });
  const f = setup({
    reloadHook: async () => {
      entered();
      await gate;
    },
  });
  await f.trial.start(f.tab);
  f.due();
  const pending = f.trial.tick();
  await signal;
  await f.trial.tick();
  release();
  await pending;
  assert.equal(f.reloads(), 1);
  assert.equal(f.state().successful, 1);
  checks++;
}
{
  const f = setup();
  await f.trial.start(f.tab);
  const id = f.state().id;
  await f.trial.start(f.tab);
  assert.equal(f.state().id, id);
  assert.equal(f.captures(), 1);
  checks++;
  f.late();
  await f.trial.tick();
  assert.equal(f.reloads(), 1);
  assert.ok(f.state().nextAt - f.clock() >= 900000);
  checks++;
}
{
  const f = setup();
  f.offline();
  await f.trial.start(f.tab);
  assert.equal(f.reloads(), 0);
  assert.equal(f.state().status, "stopped");
  checks++;
  const g = setup();
  g.tab.url = "https://www.pokergosu.com/free/123";
  await g.trial.start(g.tab);
  assert.equal(g.state(), undefined);
  assert.equal(g.captures(), 0);
  checks++;
}
console.log(
  JSON.stringify({ checks, site_requests: 0, maximum_trial_reloads: 15 }),
);
