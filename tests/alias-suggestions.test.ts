import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { AliasSuggestions } from "../apps/read-api/src/adapters/alias-suggestions";

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0))
    rmSync(dir, { recursive: true, force: true });
});
const dataset = () => ({
  candidates: Array.from({ length: 29 }, (_, i) => ({
    token: `synthetic-${i}`,
    group_id: "APL",
    group_name: "APL",
    method: "spelling",
    examples: [],
  })),
  groups: [{ id: "APL", name: "APL" }],
  decisions: [],
});
function filename() {
  const dir = mkdtempSync(path.join(tmpdir(), "mention-alias-suggestions-"));
  dirs.push(dir);
  return path.join(dir, "aliases.json");
}
it("serves precomputed capped pages after restart and retains them if refresh fails", async () => {
  const source = { request: vi.fn(async () => dataset()) };
  const file = filename();
  const model = new AliasSuggestions(source, file);
  await model.refresh();
  const offline = {
    request: vi.fn(async () => {
      throw Error("offline");
    }),
  };
  const reopened = new AliasSuggestions(offline, file);
  const page = (await reopened.request("/api/aliases?page=2")) as {
    candidates: { token: string }[];
    total: number;
    pages: number;
  };
  expect(page.candidates).toHaveLength(12);
  expect(page.candidates[0].token).toBe("synthetic-12");
  expect(page.total).toBe(29);
  expect(page.pages).toBe(3);
  expect(offline.request).not.toHaveBeenCalled();
  await expect(reopened.refresh()).rejects.toThrow("offline");
  expect(
    ((await reopened.request("/api/aliases")) as { total: number }).total,
  ).toBe(29);
  await expect(reopened.request("/api/aliases?page=-1")).rejects.toThrow();
});
it("delegates decisions with original scope and refreshes past an older in-flight generation", async () => {
  const source = { request: vi.fn(async () => dataset() as unknown) };
  const model = new AliasSuggestions(source, filename());
  await model.refresh();
  let release!: (data: unknown) => void;
  source.request.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        release = resolve;
      }),
  );
  const pending = model.refresh();
  const body = { token: "synthetic-0", decision: "dismissed" };
  await model.request("/alias-decision", body, true);
  release(dataset());
  await pending;
  await vi.waitFor(() => expect(source.request).toHaveBeenCalledTimes(4));
  expect(source.request).toHaveBeenCalledWith("/alias-decision", body, true);
});

it("rebuilds older persisted suggestions instead of displaying candidates from a superseded evidence policy", async () => {
  const file = filename();
  writeFileSync(
    file,
    JSON.stringify({
      version: 1,
      capturedAt: new Date().toISOString(),
      data: { ...dataset(), candidates: [{ token: "apl줌" }] },
    }),
  );
  const upstream = { request: vi.fn(async () => dataset()) };
  const model = new AliasSuggestions(upstream, file);
  const page = (await model.request("/api/aliases")) as {
    candidates: { token: string }[];
  };
  expect(upstream.request).toHaveBeenCalledOnce();
  expect(page.candidates.some((c) => c.token === "apl줌")).toBe(false);
});
