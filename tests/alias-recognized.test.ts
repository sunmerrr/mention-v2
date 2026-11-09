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
  "suppresses already recognized inflections with the collector matcher while retaining unseen spellings",
  () => {
    const result = spawnSync(
      path.join(root as string, ".venv/bin/python"),
      ["tests/alias_recognized_check.py", root as string],
      {
        encoding: "utf8",
        env: { ...process.env, PYTHONDONTWRITEBYTECODE: "1" },
        timeout: 20000,
      },
    );
    expect(result.status, result.stderr).toBe(0);
    expect(JSON.parse(result.stdout)).toEqual({
      covered: 11,
      preserved: 4,
      real_pipeline: true,
      collection_rules_changed: false,
    });
  },
);
