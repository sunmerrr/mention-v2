import { execFile } from "node:child_process";
import path from "node:path";
import { promisify } from "node:util";
import type { WorkspaceQueries } from "../../../../packages/application/src/workspace";
import { sharedPolicy } from "../../../../packages/contracts/src/keyword-policy";

const execute = promisify(execFile);
/** Canonical settings stay at the existing native writer; forum refresh is local. */
export class KeywordPolicies {
  private cached?: {
    until: number;
    value: Awaited<ReturnType<KeywordPolicies["load"]>>;
  };
  private flight?: ReturnType<KeywordPolicies["load"]>;
  constructor(
    private readonly workspace: WorkspaceQueries,
    private readonly root: string,
    private readonly legacyRoot: string,
    private readonly forumDirectory: string,
  ) {}
  private async load() {
    const data = await this.workspace.read("keywords", "", false);
    return {
      policy: sharedPolicy(data),
      token: String(data.keyword_policy_token || ""),
      supported: data.keyword_policy_supported === true,
    };
  }
  async read() {
    if (this.cached && this.cached.until > Date.now()) return this.cached.value;
    if (this.flight) return this.flight;
    const flight = this.load();
    this.flight = flight;
    try {
      const value = await flight;
      this.cached = { until: Date.now() + 5000, value };
      return value;
    } finally {
      if (this.flight === flight) this.flight = undefined;
    }
  }
  private job: Promise<unknown> = Promise.resolve();
  private processing = { state: "idle", updated: 0 };
  drain() {
    return this.job;
  }
  status() {
    return this.processing;
  }
  refreshForum() {
    this.cached = undefined;
    this.processing = { state: "queued", updated: 0 };
    this.job = this.job
      .catch(() => {})
      .then(async () => {
        this.processing = { state: "running", updated: 0 };
        this.processing = await this.reindex();
      });
    return Promise.resolve({ state: "queued", updated: 0 });
  }
  private async reindex() {
    try {
      const { stdout } = await execute(
        path.join(this.legacyRoot, ".venv/bin/python"),
        [
          path.join(this.root, "tools/source_keywords/reindex.py"),
          "--legacy-root",
          this.legacyRoot,
          "--directory",
          this.forumDirectory,
        ],
        { timeout: 30000, maxBuffer: 100000 },
      );
      return JSON.parse(stdout) as { state: string; updated: number };
    } catch {
      return { state: "failed", updated: 0 };
    }
  }
}
