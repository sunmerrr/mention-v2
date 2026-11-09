import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { AnalyticsTransport } from "../apps/read-api/src/adapters/analytics";

const cleanup: (() => void)[] = [];
afterEach(() => {
  for (const fn of cleanup.splice(0)) fn();
});
function worker() {
  const root = mkdtempSync(path.join(tmpdir(), "mention-analytics-synthetic-"));
  mkdirSync(path.join(root, ".venv/bin"), { recursive: true });
  const file = path.join(root, ".venv/bin/python");
  writeFileSync(
    file,
    `#!/usr/bin/env python3
import json,os,sys
sequence=0
for line in sys.stdin:
 request=json.loads(line)
 sequence+=1
 if request['params'].get('crash'):sys.exit(1)
 print(json.dumps({'ok':True,'data':{'pid':os.getpid(),'endpoint':request['endpoint'],'text':'긍정','sequence':sequence},'metrics':{'cached':False}}),flush=True)
`,
  );
  chmodSync(file, 0o700);
  const upstream = { request: vi.fn(async () => ({ delegated: true })) };
  const transport = new AnalyticsTransport(root, upstream);
  cleanup.push(() => {
    transport.close();
    rmSync(root, { recursive: true, force: true });
  });
  return { transport, upstream };
}
it("serializes read jobs in one read worker and forwards every write/private/local capability unchanged", async () => {
  const { transport, upstream } = worker();
  const [one, two] = (await Promise.all([
    transport.request("/api/insights"),
    transport.request("/api/trends?target=APL"),
  ])) as { pid: number; text: string }[];
  expect(one.pid).toBe(two.pid);
  expect(one.text).toBe("긍정");
  const body = { request_id: "synthetic" };
  expect(await transport.request("/campaign-send", body, true)).toEqual({
    delegated: true,
  });
  expect(upstream.request).toHaveBeenLastCalledWith(
    "/campaign-send",
    body,
    true,
  );
  await transport.request("/api/guide", undefined, false);
  expect(upstream.request).toHaveBeenLastCalledWith(
    "/api/guide",
    undefined,
    false,
  );
});
it("recovers only the read worker after a crash and stops new read work after shutdown", async () => {
  const { transport } = worker();
  await expect(transport.request("/api/insights?crash=1")).rejects.toThrow();
  expect(await transport.request("/api/briefing")).toMatchObject({
    text: "긍정",
  });
  transport.close();
  await expect(transport.request("/api/trends")).rejects.toThrow();
});

it("coalesces concurrent identical public reads with reordered query parameters", async () => {
  const { transport } = worker();
  const [one, two, next] = (await Promise.all([
    transport.request("/api/trends?target=APL&from=2026-11-01"),
    transport.request("/api/trends?from=2026-11-01&target=APL"),
    transport.request("/api/briefing"),
  ])) as { sequence: number }[];
  expect(one.sequence).toBe(1);
  expect(two.sequence).toBe(1);
  expect(next.sequence).toBe(2);
});
