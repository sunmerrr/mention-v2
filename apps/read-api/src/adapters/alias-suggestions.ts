import { chmodSync, readFileSync } from "node:fs";
import { rename, writeFile } from "node:fs/promises";
import type {
  RecordData,
  WorkspacePort,
} from "../../../../packages/application/src/workspace";
import { UpstreamError } from "./legacy";

interface Snapshot {
  version: 2;
  capturedAt: string;
  data: RecordData;
}
export class AliasSuggestions implements WorkspacePort {
  private snapshot?: Snapshot;
  private revision = 0;
  private flight?: Promise<void>;
  constructor(
    private readonly upstream: WorkspacePort,
    private readonly filename: string,
  ) {
    try {
      const saved = JSON.parse(readFileSync(filename, "utf8"));
      if (
        saved.version === 2 &&
        Array.isArray(saved.data?.candidates) &&
        Array.isArray(saved.data?.decisions) &&
        Array.isArray(saved.data?.groups) &&
        typeof saved.capturedAt === "string"
      )
        this.snapshot = saved;
      chmodSync(filename, 0o600);
    } catch {}
  }
  async drain() {
    await this.flight?.catch(() => {});
  }
  async refresh(fresh = false) {
    if (fresh && this.flight) await this.flight.catch(() => {});
    if (this.flight) return this.flight;
    const revision = this.revision;
    this.flight = (async () => {
      const data = (await this.upstream.request("/api/aliases")) as RecordData;
      if (
        !Array.isArray(data.candidates) ||
        !Array.isArray(data.decisions) ||
        !Array.isArray(data.groups)
      )
        throw new Error("Invalid alias candidates");
      const snapshot: Snapshot = {
        version: 2,
        capturedAt: new Date().toISOString(),
        data,
      };
      if (revision !== this.revision) return;
      await writeFile(`${this.filename}.tmp`, JSON.stringify(snapshot), {
        mode: 0o600,
      });
      await rename(`${this.filename}.tmp`, this.filename);
      if (revision === this.revision) this.snapshot = snapshot;
    })();
    try {
      await this.flight;
    } finally {
      this.flight = undefined;
    }
  }
  async request(
    endpoint: string,
    input?: unknown,
    local = false,
  ): Promise<unknown> {
    const url = new URL(endpoint, "http://localhost");
    if (
      url.pathname === "/api/aliases" &&
      input === undefined &&
      (!url.searchParams.has("days") || url.searchParams.get("days") === "14")
    ) {
      const page = Number(url.searchParams.get("page") || 1);
      if (!Number.isSafeInteger(page) || page < 1)
        throw new UpstreamError("페이지 조건을 확인해 주세요.", 400);
      if (!this.snapshot) await this.refresh();
      if (!this.snapshot) throw new Error("Alias projection unavailable");
      const data = this.snapshot.data;
      const candidates = data.candidates as RecordData[];
      const pages = Math.max(1, Math.ceil(candidates.length / 12));
      const current = Math.min(page, pages);
      return {
        ...data,
        candidates: candidates.slice((current - 1) * 12, current * 12),
        page: current,
        pages,
        total: candidates.length,
        captured_at: this.snapshot.capturedAt,
      };
    }
    const result = await this.upstream.request(endpoint, input, local);
    if (input !== undefined && url.pathname === "/alias-decision") {
      this.revision++;
      const body = input as RecordData;
      if (this.snapshot) {
        if (body.decision !== "reset")
          this.snapshot.data.candidates = (
            this.snapshot.data.candidates as RecordData[]
          ).filter((c) => c.token !== body.token);
        this.snapshot.data.decisions = (
          this.snapshot.data.decisions as RecordData[]
        ).filter((d) => d.token !== body.token);
        if (body.decision !== "reset")
          (this.snapshot.data.decisions as RecordData[]).unshift({
            token: body.token,
            decision: body.decision,
            group_id: body.group_id,
          });
      }
      void this.refresh(true).catch(() => {});
    }
    return result;
  }
}
