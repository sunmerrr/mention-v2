import assert from "node:assert/strict";
import {
  createControl,
  SITE_PERMISSION,
} from "../tools/pokergosu/extension/control.mjs";

function fixture() {
  let data = {},
    permission = true,
    clock = 10000,
    queue = [],
    acks = [],
    created = 0,
    starts = 0,
    stops = 0,
    reloads = 0,
    version = "0.4.0";
  const tabs = new Map();
  const chrome = {
    storage: {
      local: {
        get: async () => structuredClone(data),
        set: async (x) => {
          data = { ...data, ...structuredClone(x) };
        },
        remove: async (key) => {
          delete data[key];
        },
      },
    },
    permissions: {
      contains: async (value) => {
        assert.deepEqual(value, SITE_PERMISSION);
        return permission;
      },
      remove: async () => {
        permission = false;
      },
    },
    alarms: { create: async () => {}, clear: async () => {} },
    runtime: {
      getManifest: () => ({ version }),
      reload: async () => {
        reloads++;
      },
    },
    tabs: {
      get: async (id) => {
        if (!tabs.has(id)) throw new Error("closed");
        return { ...tabs.get(id) };
      },
      create: async () => {
        const tab = { id: ++created, url: "about:blank" };
        tabs.set(tab.id, tab);
        return tab;
      },
    },
  };
  const monitor = {
    start: async (tab) => {
      starts++;
      data.monitor = {
        id: "new",
        status: "running",
        tabId: tab.id,
        expectedUrl: tab.url,
      };
    },
    stop: async (reason) => {
      stops++;
      if (data.monitor?.status === "running")
        data.monitor = {
          ...data.monitor,
          status: "stopped",
          reason,
          finishedAt: clock,
        };
    },
  };
  const options = {
    chrome,
    monitor,
    show: async () => {},
    now: () => clock,
    settle: async () => {},
    navigate: async (id, url) => {
      tabs.get(id).url = url;
    },
    local: async (path, body) => {
      if (path === "/control/ack") {
        acks.push(structuredClone(body));
        return {};
      }
      return { command: queue.shift() || null };
    },
  };
  const control = createControl(options);
  const command = (action, overrides = {}) => ({
    id: `command-${queue.length}-${acks.length}`,
    action,
    createdAt: clock - 1,
    expiresAt: clock + 120000,
    ...overrides,
  });
  return {
    control,
    options,
    data: () => data,
    queue: (cmd) => queue.push(cmd),
    command,
    acks,
    tabs,
    created: () => created,
    starts: () => starts,
    stops: () => stops,
    reloads: () => reloads,
    permission: (v) => {
      permission = v;
    },
    seed: (x) => {
      data = { ...data, ...structuredClone(x) };
    },
    version: (v) => {
      version = v;
    },
    time: (v) => {
      clock = v;
    },
  };
}
let checks = 0;
{
  const f = fixture();
  await f.control.grant(true);
  assert.equal(f.starts(), 0);
  assert.equal(f.created(), 0);
  checks++;
  f.queue(f.command("start"));
  await f.control.poll();
  assert.equal(f.created(), 1);
  assert.equal(f.starts(), 1);
  assert.equal(f.acks.at(-1).result.code, "STARTED");
  checks++;
  f.queue(f.command("start"));
  await f.control.poll();
  assert.equal(f.created(), 1);
  assert.equal(f.starts(), 1);
  assert.equal(f.acks.at(-1).result.code, "ALREADY_RUNNING");
  checks++;
  f.queue(f.command("stop"));
  await f.control.poll();
  assert.equal(f.data().monitor.status, "stopped");
  checks++;
  await createControl(f.options).restore();
  assert.equal(f.starts(), 1);
  checks++;
}
{
  const f = fixture();
  await f.control.grant(false);
  assert.equal(f.data().localControlEnabled, undefined);
  assert.equal(f.created(), 0);
  checks++;
  const g = fixture();
  await g.control.grant(true);
  g.permission(false);
  g.queue(g.command("start"));
  await g.control.poll();
  assert.equal(g.created(), 0);
  assert.equal(g.acks.at(-1).result.code, "SITE_PERMISSION_REQUIRED");
  checks++;
}
{
  const f = fixture();
  f.seed({
    localControlEnabled: true,
    monitor: { status: "paused", reason: "BOT_CHALLENGE" },
  });
  f.queue(f.command("resume"));
  await f.control.poll();
  assert.equal(f.starts(), 0);
  assert.equal(f.created(), 0);
  assert.equal(f.acks.at(-1).result.code, "HUMAN_ACCESS_CHECK_REQUIRED");
  checks++;
  const g = fixture();
  g.seed({
    localControlEnabled: true,
    lastManualStopRequestedAt: 10000,
    monitor: { status: "stopped", reason: "USER_STOP", finishedAt: 10000 },
  });
  g.queue(g.command("start"));
  await g.control.poll();
  assert.equal(g.starts(), 0);
  assert.equal(g.acks.at(-1).result.code, "USER_STOP_SUPERSEDES_COMMAND");
  checks++;
  g.time(11000);
  g.queue(g.command("resume"));
  await g.control.poll();
  assert.equal(g.starts(), 1);
  checks++;
}
{
  const f = fixture();
  f.seed({
    localControlEnabled: true,
    monitor: { status: "paused", reason: "COMMENT_ID_OR_TEXT_UNKNOWN" },
  });
  f.queue(f.command("resume"));
  await f.control.poll();
  assert.equal(f.starts(), 1);
  checks++;
  const g = fixture();
  g.seed({ localControlEnabled: true });
  g.queue(g.command("start", { expiresAt: 0 }));
  await g.control.poll();
  assert.equal(g.created(), 0);
  assert.equal(g.acks.at(-1).result.code, "COMMAND_EXPIRED_NO_ACTION");
  checks++;
}
{
  const f = fixture();
  f.seed({
    localControlEnabled: true,
    controlReceipt: { command: f.command("start"), result: null },
  });
  await f.control.restore();
  assert.equal(f.starts(), 0);
  assert.equal(f.acks[0].result.code, "INTERRUPTED_UNKNOWN_NO_RETRY");
  checks++;
  const g = fixture();
  g.seed({
    localControlEnabled: true,
    controlReceipt: {
      command: g.command("stop"),
      result: { ok: true, code: "STOPPED" },
    },
  });
  await g.control.restore();
  assert.equal(g.stops(), 0);
  assert.equal(g.acks[0].result.code, "STOPPED");
  checks++;
}
{
  const f = fixture();
  f.seed({ localControlEnabled: true });
  f.queue(f.command("reload", { targetVersion: "0.4.1" }));
  await f.control.poll();
  assert.equal(f.reloads(), 1);
  assert.ok(f.data().controlReceipt);
  checks++;
  f.version("0.4.1");
  await createControl(f.options).restore();
  assert.equal(f.acks[0].result.code, "RELOADED");
  assert.equal(f.data().controlReceipt, undefined);
  checks++;
}
{
  const f = fixture();
  await f.control.grant(true);
  f.queue(f.command("start"));
  await f.control.poll();
  f.permission(false);
  await f.control.poll();
  assert.equal(f.data().monitor.reason, "SITE_PERMISSION_REVOKED");
  checks++;
}
{
  const f = fixture();
  f.time(Date.parse("2026-11-13T04:00:00+09:00"));
  await f.control.grant(true);
  f.queue(f.command("resume"));
  await f.control.poll();
  assert.equal(f.acks.at(-1).result.code, "QUIET_HOURS_NO_START");
  assert.equal(f.starts(), 0);
  assert.equal(f.created(), 0);
  checks++;
}
console.log(JSON.stringify({ checks, site_requests: 0, per_post_clicks: 0 }));
