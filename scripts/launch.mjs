import { spawn } from "node:child_process";
import { closeSync, openSync } from "node:fs";
import path from "node:path";

const fd = openSync("runtime/web.log", "a", 0o600);
const child = spawn(
  process.execPath,
  [
    "--import",
    "tsx",
    path.resolve("apps/read-api/src/server.ts"),
    ...(process.env.MENTION_PRODUCTION === "1" ? ["--production"] : []),
  ],
  {
    cwd: process.cwd(),
    env: process.env,
    detached: true,
    stdio: ["ignore", fd, fd],
  },
);
child.unref();
closeSync(fd);
process.stdout.write(String(child.pid));
