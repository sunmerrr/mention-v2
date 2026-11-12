import { spawnSync } from "node:child_process";
import { expect, it } from "vitest";

it("promotes and rolls back immutable images using synthetic Docker and metadata only", () => {
  const result = spawnSync("python3", ["tests/release_check.py"], {
    encoding: "utf8",
    env: { ...process.env, PYTHONDONTWRITEBYTECODE: "1" },
  });
  expect(result.status, result.stderr).toBe(0);
  expect(result.stdout).toContain("failure rollback");
});
