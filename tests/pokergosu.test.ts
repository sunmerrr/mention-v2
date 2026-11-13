import { spawnSync } from "node:child_process";
import { expect, it } from "vitest";

it("validates public collection policy and read-only settings with synthetic state", () => {
  const result = spawnSync("python3", ["tests/pokergosu_check.py"], {
    encoding: "utf8",
    timeout: 20000,
    env: { ...process.env, PYTHONDONTWRITEBYTECODE: "1" },
  });
  expect(result.status, result.stderr).toBe(0);
  expect(result.stderr).toContain("Ran 15 tests");
});

it("extracts posts/replies and preserves skipped and partial comment coverage", () => {
  const result = spawnSync("node", ["tests/pokergosu-browser-check.mjs"], {
    encoding: "utf8",
    timeout: 30000,
  });
  expect(result.status, result.stderr).toBe(0);
  expect(JSON.parse(result.stdout)).toEqual({
    checks: 38,
    external_requests: 0,
  });
}, 35000);

it("accepts authenticated local extension captures and rejects cross-origin or incomplete data", () => {
  const result = spawnSync("python3", ["tests/pokergosu_extension_check.py"], {
    encoding: "utf8",
    timeout: 20000,
    env: { ...process.env, PYTHONDONTWRITEBYTECODE: "1" },
  });
  expect(result.status, result.stderr).toBe(0);
  expect(result.stderr).toContain("Ran 10 tests");
});

it("reads only an explicitly selected page and handles diagnostics, challenges and receiver failure", () => {
  const result = spawnSync(
    "node",
    ["tests/pokergosu-extension-browser-check.mjs"],
    {
      encoding: "utf8",
      timeout: 30000,
    },
  );
  expect(result.status, result.stderr).toBe(0);
  expect(JSON.parse(result.stdout)).toEqual({
    checks: 17,
    unintercepted_site_requests: 0,
  });
}, 35000);

it("limits the board trial to fifteen reloads, restores safely and stops on access errors", () => {
  const result = spawnSync("node", ["tests/pokergosu-trial-check.mjs"], {
    encoding: "utf8",
    timeout: 20000,
  });
  expect(result.status, result.stderr).toBe(0);
  expect(JSON.parse(result.stdout)).toEqual({
    checks: 18,
    site_requests: 0,
    maximum_trial_reloads: 15,
  });
});

it("automatically reads threads/comments across bounded alarm-driven cycles and stops safely", () => {
  const result = spawnSync("node", ["tests/pokergosu-monitor-check.mjs"], {
    encoding: "utf8",
    timeout: 20000,
  });
  expect(result.status, result.stderr).toBe(0);
  expect(JSON.parse(result.stdout)).toEqual({
    checks: 40,
    site_requests: 0,
    automatic_thread_reads: true,
    max_threads_per_cycle: 6,
    max_pages_per_cycle: 7,
  });
});

it("plans bounded new/recent threads, validates source/audit history and caches unchanged keyword policy", () => {
  const result = spawnSync("python3", ["tests/pokergosu_monitor_check.py"], {
    encoding: "utf8",
    timeout: 20000,
    env: { ...process.env, PYTHONDONTWRITEBYTECODE: "1" },
  });
  expect(result.status, result.stderr).toBe(0);
  expect(result.stderr).toContain("Ran 10 tests");
});

it("reports exact failure ordinals and distinguishes access evidence without inventing account bans", () => {
  const result = spawnSync("python3", ["tests/pokergosu_log_check.py"], {
    encoding: "utf8",
    timeout: 20000,
    env: { ...process.env, PYTHONDONTWRITEBYTECODE: "1" },
  });
  expect(result.status, result.stderr).toBe(0);
  expect(result.stderr).toContain("Ran 7 tests");
});

it("leases local commands once and preserves permission and owner boundaries", () => {
  const result = spawnSync("python3", ["tests/pokergosu_control_check.py"], {
    encoding: "utf8",
    timeout: 20000,
    env: { ...process.env, PYTHONDONTWRITEBYTECODE: "1" },
  });
  expect(result.status, result.stderr).toBe(0);
  expect(result.stderr).toContain("Ran 6 tests");
});
it("controls collection without per-post clicks and preserves manual/security stops", () => {
  const result = spawnSync("node", ["tests/pokergosu-control-check.mjs"], {
    encoding: "utf8",
    timeout: 20000,
  });
  expect(result.status, result.stderr).toBe(0);
  expect(JSON.parse(result.stdout)).toEqual({
    checks: 20,
    site_requests: 0,
    per_post_clicks: 0,
  });
});

it("repairs missing metadata from retained headers without changing checked times or existing fields", () => {
  const result = spawnSync("python3", ["tests/pokergosu_metadata_check.py"], {
    encoding: "utf8",
    timeout: 20000,
    env: { ...process.env, PYTHONDONTWRITEBYTECODE: "1" },
  });
  expect(result.status, result.stderr).toBe(0);
  expect(result.stderr).toContain("Ran 5 tests");
});

it("rotates expiring forum searches and keeps result queues isolated from the general backlog", () => {
  const result = spawnSync("python3", ["tests/pokergosu_search_check.py"], {
    encoding: "utf8",
    timeout: 20000,
    env: { ...process.env, PYTHONDONTWRITEBYTECODE: "1" },
  });
  expect(result.status, result.stderr).toBe(0);
  expect(result.stderr).toContain("Ran 6 tests");
});
