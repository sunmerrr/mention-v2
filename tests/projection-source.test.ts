import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { expect, it } from "vitest";

let root = process.env.MENTION_LEGACY_ROOT;
try {
  root ||= JSON.parse(
    readFileSync("runtime/deployment.json", "utf8"),
  ).legacyRoot;
} catch {}
it.skipIf(!root || !existsSync(path.join(root, "monitor/context.py")))(
  "matches existing analytics on synthetic state, preserves corrections and reuses unchanged rooms without source writes or operational constructors",
  () => {
    const result = spawnSync(
      path.join(root as string, ".venv/bin/python"),
      ["tests/projection_source_check.py", root as string],
      {
        encoding: "utf8",
        env: { ...process.env, PYTHONDONTWRITEBYTECODE: "1" },
        timeout: 20000,
      },
    );
    expect(result.status, result.stderr).toBe(0);
    expect(JSON.parse(result.stdout)).toEqual({
      checks: 25,
      source_writes: 0,
      operational_constructors: 0,
    });
  },
);
