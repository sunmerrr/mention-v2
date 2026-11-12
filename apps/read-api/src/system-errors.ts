import { chmodSync, mkdirSync } from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

/** Operational metadata only: never persist query strings, bodies or exception text. */
export class SystemErrors {
  private db: DatabaseSync;
  constructor(filename: string) {
    if (filename !== ":memory:")
      mkdirSync(path.dirname(filename), { recursive: true, mode: 0o700 });
    this.db = new DatabaseSync(filename);
    if (filename !== ":memory:") chmodSync(filename, 0o600);
    this.db.exec(`CREATE TABLE IF NOT EXISTS system_error_logs (
      id INTEGER PRIMARY KEY, at TEXT NOT NULL, method TEXT NOT NULL,
      route TEXT NOT NULL, status INTEGER NOT NULL
    )`);
  }
  record(method: string, route: string, status: number) {
    this.db
      .prepare(
        "INSERT INTO system_error_logs(at,method,route,status) VALUES(?,?,?,?)",
      )
      .run(new Date().toISOString(), method, route, status);
  }
  close() {
    this.db.close();
  }
}
