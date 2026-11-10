import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { expect, it } from "vitest";

let root = process.env.MENTION_LEGACY_ROOT;
try {
  root ||= JSON.parse(
    readFileSync("runtime/deployment.json", "utf8"),
  ).legacyRoot;
} catch {}
it.skipIf(!root)(
  "audits a first classification with optional empty memo, rejects conflicts and replays the same request without duplicate history",
  () => {
    const result = spawnSync(
      path.join(root as string, ".venv/bin/python"),
      ["tests/classification_initial_check.py", root as string],
      {
        encoding: "utf8",
        env: { ...process.env, PYTHONDONTWRITEBYTECODE: "1" },
        timeout: 20000,
      },
    );
    expect(result.status, result.stderr).toBe(0);
  },
);
