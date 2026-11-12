import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { expect, it } from "vitest";
import { SystemErrors } from "../apps/read-api/src/system-errors";

it("retains UTC failure metadata across restart without transcript or exception fields", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "mention-errors-"));
  try {
    const file = path.join(dir, "errors.db");
    const errors = new SystemErrors(file);
    errors.record("POST", "/api/actions/:action", 502);
    errors.close();
    const db = new DatabaseSync(file);
    const rows = db.prepare("SELECT * FROM system_error_logs").all();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      method: "POST",
      route: "/api/actions/:action",
      status: 502,
    });
    expect(rows[0].at).toMatch(/Z$/);
    expect(Object.keys(rows[0]).sort()).toEqual([
      "at",
      "id",
      "method",
      "route",
      "status",
    ]);
    db.close();
  } finally {
    rmSync(dir, { recursive: true });
  }
});
