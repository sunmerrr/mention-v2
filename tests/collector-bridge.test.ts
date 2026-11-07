import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, expect, it } from "vitest";

let root: string;
beforeEach(() => {
  root = mkdtempSync(path.join(tmpdir(), "mention-bridge-synthetic-"));
  mkdirSync(path.join(root, "monitor"));
  writeFileSync(path.join(root, "monitor/__init__.py"), "");
  writeFileSync(
    path.join(root, "monitor/classifications.py"),
    "class Classifications:\n def __init__(self,*args):pass\n",
  );
  writeFileSync(
    path.join(root, "monitor/ipc.py"),
    `import json
class CollectorConnection:
 def __init__(self,*args,**kwargs):pass
 def request(self,method,path,body,headers):self.method,self.path,self.body,self.headers=method,path,body,headers
 def getresponse(self):return self
 @property
 def status(self):return 409 if 'fail=1' in self.path else 200
 def read(self):
  if self.path.startswith('/photo/'):return b'\\x89PNG\\r\\n'
  if self.status==409:return b'{"message":"synthetic conflict"}'
  return json.dumps({'method':self.method,'path':self.path,'headers':self.headers,'input':json.loads(self.body) if self.body else None}).encode()
 def getheader(self,key,default=''):return {'Content-Type':'image/png','Content-Disposition':'attachment; filename="synthetic.png"'}.get(key,default)
 def close(self):pass
`,
  );
});
afterEach(() => rmSync(root, { recursive: true, force: true }));
function call(
  endpoint: string,
  input?: unknown,
  local = false,
  writesEnabled = true,
) {
  const result = spawnSync(
    "python3",
    [path.resolve("apps/read-api/src/adapters/collector_bridge.py")],
    {
      input: JSON.stringify({
        legacyRoot: root,
        path: endpoint,
        input,
        local,
        writesEnabled,
      }),
      encoding: "utf8",
    },
  );
  expect(result.stderr).toBe("");
  return JSON.parse(result.stdout);
}
it("forwards data writes with exact payload and public scope; rejects lifecycle and private endpoints", () => {
  const body = { room_ids: ["123"], excluded: true };
  const result = call("/room-settings", body);
  expect(result.data.input).toEqual(body);
  expect(result.data.headers["X-Monitor-Public"]).toBe("1");
  for (const endpoint of [
    "/api/runtime",
    "/api/assistant/status",
    "/poster-send",
    "/settings",
  ]) {
    expect(call(endpoint).ok).toBe(false);
  }
  expect(call("/room-settings", body, false, false).ok).toBe(false);
  expect(call("/campaign-send", body, false).ok).toBe(false);
  expect(
    call("/campaign-send", body, true).data.headers["X-Monitor-Public"],
  ).toBe("0");
});
it("preserves binary bytes and upstream conflict status and blocks path traversal", () => {
  const result = call("/photo/123/456/0");
  expect(result.data.contentType).toBe("image/png");
  expect(Buffer.from(result.data.binary, "base64")).toEqual(
    Buffer.from([137, 80, 78, 71, 13, 10]),
  );
  const conflict = call("/api/rooms?fail=1");
  expect(conflict.status).toBe(409);
  expect(conflict.message).toBe("synthetic conflict");
  expect(call("/download/../../secret").ok).toBe(false);
});
