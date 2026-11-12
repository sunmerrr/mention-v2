import { spawn } from "node:child_process";
import { once } from "node:events";
import { createInterface } from "node:readline";
import { expect, it } from "vitest";

it("SIGTERM lets an accepted real HTTP save finish before process exit", async () => {
  const child = spawn(
    process.execPath,
    ["--import", "tsx", "tests/lifecycle-fixture.ts"],
    { stdio: ["ignore", "pipe", "pipe"] },
  );
  let started!: (url: string) => void, saving!: () => void;
  const address = new Promise<string>((resolve) => {
    started = resolve;
  });
  const accepted = new Promise<void>((resolve) => {
    saving = resolve;
  });
  const lines = createInterface({ input: child.stdout });
  lines.on("line", (line) => {
    if (line.startsWith("http://")) started(line);
    if (line === "saving") saving();
  });
  const timeout = setTimeout(() => child.kill("SIGKILL"), 5000);
  try {
    const url = await address;
    const request = fetch(`${url}/save`);
    await accepted;
    const exited = once(child, "exit");
    child.kill("SIGTERM");
    const response = await request;
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ saved: true });
    expect((await exited)[0]).toBe(0);
  } finally {
    clearTimeout(timeout);
    lines.close();
    child.kill("SIGKILL");
  }
});
