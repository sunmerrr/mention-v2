import { type ChildProcessWithoutNullStreams, spawn } from "node:child_process";
import path from "node:path";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";
import type { WorkspacePort } from "../../../../packages/application/src/workspace";
import { UpstreamError } from "./legacy";

const reads = new Set([
  "/api/insights",
  "/api/trends",
  "/api/briefing",
  "/api/classifications",
  "/api/aliases",
]);
export class AnalyticsTransport implements WorkspacePort {
  private child?: ChildProcessWithoutNullStreams;
  private closed = false;
  private flights = new Map<string, Promise<unknown>>();
  private queue: Promise<unknown> = Promise.resolve();
  private pending?: {
    resolve: (value: unknown) => void;
    reject: (error: Error) => void;
    timer: ReturnType<typeof setTimeout>;
  };
  constructor(
    private readonly root: string,
    private readonly upstream: WorkspacePort,
    private readonly observe: (
      metrics: Record<string, unknown>,
    ) => void = () => {},
  ) {}
  request(endpoint: string, input?: unknown, local = false): Promise<unknown> {
    const url = new URL(endpoint, "http://localhost");
    if (input !== undefined || !reads.has(url.pathname))
      return this.upstream.request(endpoint, input, local);
    url.searchParams.sort();
    const key = url.pathname + url.search;
    const existing = this.flights.get(key);
    if (existing) return existing;
    const result = this.queue.then(() => this.read(url));
    this.flights.set(key, result);
    const clear = () => this.flights.delete(key);
    void result.then(clear, clear);
    this.queue = result.catch(() => {});
    return result;
  }
  private read(url: URL): Promise<unknown> {
    if (this.closed)
      return Promise.reject(new UpstreamError("집계 작업이 종료됐습니다."));
    if (!this.child) this.start();
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.reset();
        reject(new UpstreamError("집계 응답 시간이 초과됐습니다."));
      }, 90000);
      this.pending = { resolve, reject, timer };
      this.child?.stdin.write(
        `${JSON.stringify({
          legacyRoot: this.root,
          endpoint: url.pathname,
          params: Object.fromEntries(url.searchParams),
        })}\n`,
      );
    });
  }
  private start() {
    const child = spawn(
      path.join(this.root, ".venv/bin/python"),
      [fileURLToPath(new URL("./projection_source.py", import.meta.url))],
      {
        stdio: ["pipe", "pipe", "pipe"],
        env: { ...process.env, PYTHONDONTWRITEBYTECODE: "1" },
      },
    );
    this.child = child;
    child.stdout.setEncoding("utf8");
    child.stderr.resume();
    const lines = createInterface({ input: child.stdout });
    lines.on("line", (line) => {
      const pending = this.pending;
      if (!pending) return;
      clearTimeout(pending.timer);
      this.pending = undefined;
      try {
        if (line.length > 20 * 1024 * 1024)
          throw new Error("Response too large");
        const result = JSON.parse(line);
        if (!result.ok)
          throw new UpstreamError(
            result.message || "집계 결과를 확인하지 못했습니다.",
            result.status === 400 ? 400 : 502,
          );
        this.observe(result.metrics);
        pending.resolve(result.data);
      } catch (error) {
        pending.reject(
          error instanceof UpstreamError
            ? error
            : new UpstreamError("집계 결과를 확인하지 못했습니다."),
        );
      }
    });
    const failed = () => {
      lines.close();
      if (this.child !== child) return;
      this.child = undefined;
      if (this.pending) {
        clearTimeout(this.pending.timer);
        this.pending.reject(
          new UpstreamError("읽기 전용 집계 작업이 종료됐습니다."),
        );
        this.pending = undefined;
      }
    };
    child.once("error", failed);
    child.once("close", failed);
    child.stdin.on("error", () => {});
  }
  close() {
    this.closed = true;
    this.reset();
  }
  private reset() {
    const child = this.child;
    this.child = undefined;
    if (this.pending) {
      clearTimeout(this.pending.timer);
      this.pending.reject(new UpstreamError("집계 작업이 종료됐습니다."));
      this.pending = undefined;
    }
    child?.kill();
  }
}
