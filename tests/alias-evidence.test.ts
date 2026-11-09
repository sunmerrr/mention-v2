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
  "removes promotion templates and schedule ads while preserving real opinions and explicit alias targets",
  () => {
    const result = spawnSync(
      path.join(root as string, ".venv/bin/python"),
      ["tests/alias_evidence_check.py", root as string],
      {
        encoding: "utf8",
        env: { ...process.env, PYTHONDONTWRITEBYTECODE: "1" },
        timeout: 20000,
      },
    );
    expect(result.status, result.stderr).toBe(0);
    expect(JSON.parse(result.stdout)).toEqual({ checks: 7, source_writes: 0 });
  },
);
