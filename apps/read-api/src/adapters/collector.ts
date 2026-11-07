import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { UpstreamError } from "./legacy";
export class CollectorTransport {
  constructor(
    private readonly legacyRoot: string,
    private readonly writesEnabled = false,
  ) {}
  request(endpoint: string, input?: unknown, local = false): Promise<unknown> {
    const bridge = fileURLToPath(
      new URL("./collector_bridge.py", import.meta.url),
    );
    return new Promise((resolve, reject) => {
      const child = spawn(
        path.join(this.legacyRoot, ".venv/bin/python"),
        [bridge],
        { stdio: ["pipe", "pipe", "pipe"] },
      );
      let output = "",
        failed = false;
      const timer = setTimeout(() => {
        failed = true;
        child.kill();
        reject(new UpstreamError("수집기 응답 시간이 초과됐습니다."));
      }, 135000);
      child.stdout.on("data", (chunk) => {
        output += chunk.toString();
        if (output.length > 20 * 1024 * 1024) {
          failed = true;
          child.kill();
          reject(new UpstreamError("조회 범위를 줄여 주세요."));
        }
      });
      child.stderr.resume();
      child.once("error", () => {
        clearTimeout(timer);
        failed = true;
        reject(new UpstreamError("수집기 연결 어댑터를 시작하지 못했습니다."));
      });
      child.once("close", (code) => {
        clearTimeout(timer);
        if (failed) return;
        try {
          const result = JSON.parse(output);
          if (code || !result.ok)
            throw new UpstreamError(
              result.code === "REVIEW_CONFLICT"
                ? "다른 화면에서 평가가 변경됐습니다."
                : typeof result.message === "string"
                  ? result.message
                  : "수집기에서 데이터를 가져오지 못했습니다.",
              result.code === "REVIEW_CONFLICT"
                ? 409
                : typeof result.status === "number"
                  ? result.status
                  : 502,
            );
          resolve(result.data);
        } catch (error) {
          reject(
            error instanceof UpstreamError
              ? error
              : new UpstreamError("수집기 응답을 확인하지 못했습니다."),
          );
        }
      });
      child.stdin.end(
        JSON.stringify({
          legacyRoot: this.legacyRoot,
          path: endpoint,
          input,
          writesEnabled: this.writesEnabled,
          local,
        }),
      );
    });
  }
}
