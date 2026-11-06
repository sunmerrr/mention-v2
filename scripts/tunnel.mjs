import { execFileSync, spawn } from "node:child_process";
import {
  closeSync,
  existsSync,
  openSync,
  readFileSync,
  writeFileSync,
} from "node:fs";

const pidFile = "runtime/tunnel.pid",
  logFile = "runtime/tunnel.log";
const mode = process.argv[2] || "status";
function running() {
  if (!existsSync(pidFile)) return false;
  try {
    const pid = Number(readFileSync(pidFile, "utf8"));
    const command = execFileSync("ps", ["-p", String(pid), "-o", "command="], {
      encoding: "utf8",
    });
    return command.includes("cloudflared") && command.includes("127.0.0.1:8790")
      ? pid
      : false;
  } catch {
    return false;
  }
}
if (mode === "stop") {
  const pid = running();
  if (pid) process.kill(pid, "SIGTERM");
  console.log("Mention tunnel stopped");
} else if (mode === "status") {
  console.log(
    JSON.stringify({
      pid: running(),
      url: existsSync("runtime/deployment.json")
        ? JSON.parse(readFileSync("runtime/deployment.json", "utf8"))
            .publicOrigin
        : null,
    }),
  );
} else if (mode === "start") {
  if (running()) throw Error("Mention tunnel already running");
  const fd = openSync(logFile, "w", 0o600);
  const child = spawn(
    "cloudflared",
    [
      "tunnel",
      "--no-autoupdate",
      "--url",
      "http://127.0.0.1:8790",
      "--http-host-header",
      "127.0.0.1:8790",
    ],
    { detached: true, stdio: ["ignore", fd, fd] },
  );
  child.unref();
  closeSync(fd);
  writeFileSync(pidFile, String(child.pid), { mode: 0o600 });
  let found = false;
  for (let attempt = 0; attempt < 40; attempt++) {
    await new Promise((r) => setTimeout(r, 1000));
    const urls = readFileSync(logFile, "utf8").match(
      /https:\/\/[a-z0-9-]+\.trycloudflare\.com/g,
    );
    if (urls?.length) {
      const config = existsSync("runtime/deployment.json")
        ? JSON.parse(readFileSync("runtime/deployment.json", "utf8"))
        : {};
      config.publicOrigin = urls.at(-1);
      writeFileSync(
        "runtime/deployment.json",
        JSON.stringify(config, null, 2),
        { mode: 0o600 },
      );
      console.log(JSON.stringify({ pid: child.pid, url: config.publicOrigin }));
      found = true;
      break;
    }
  }
  if (!found)
    throw Error(
      "Tunnel URL not available; inspect runtime/tunnel.log before starting another tunnel",
    );
} else throw Error("Usage: scripts/tunnel.sh start|stop|status");
