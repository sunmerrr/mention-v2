import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { expect, it } from "vitest";
import { CollectorTransport } from "../apps/read-api/src/adapters/collector";

it("decodes UTF-8 characters split across child stdout chunks without corrupting editable settings", async () => {
  const root = mkdtempSync(path.join(tmpdir(), "mention-utf8-synthetic-"));
  try {
    mkdirSync(path.join(root, ".venv/bin"), { recursive: true });
    const executable = path.join(root, ".venv/bin/python");
    writeFileSync(
      executable,
      `#!/usr/bin/env python3
import json,os,time
body=json.dumps({'ok':True,'data':{'keywords':['러너포커','긍정']}},ensure_ascii=False).encode('utf-8')
boundary=body.index('포'.encode('utf-8'))+1
os.write(1,body[:boundary]);time.sleep(0.05);os.write(1,body[boundary:])
`,
    );
    chmodSync(executable, 0o700);
    expect(await new CollectorTransport(root).request("/api/keywords")).toEqual(
      { keywords: ["러너포커", "긍정"] },
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
