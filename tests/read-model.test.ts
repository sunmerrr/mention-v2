import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { MonitoringReadModel } from "../apps/read-api/src/adapters/read-model";
import { MonitoringQueries } from "../packages/application/src/queries";
import { listSchema } from "../packages/contracts/src/api";
import { koreanDay } from "../packages/domain/src/model";
import { FakeReader } from "./fakes";

const models: MonitoringReadModel[] = [];
const directories: string[] = [];
afterEach(() => {
  for (const model of models.splice(0)) model.close();
  for (const dir of directories.splice(0))
    rmSync(dir, { recursive: true, force: true });
});
function model(reader = new FakeReader(), filename = ":memory:") {
  const result = new MonitoringReadModel(reader, filename);
  models.push(result);
  return result;
}
it("matches domain summaries and filtered pages without reloading the source", async () => {
  const reader = new FakeReader();
  reader.data.conversations[0].evaluations["샘플 A"].stale = true;
  reader.data.conversations[1].at -= 86400000;
  delete reader.data.conversations[2].evaluations["샘플 B"];
  const projection = model(reader);
  await projection.refresh();
  const refresh = vi
    .spyOn(reader, "refresh")
    .mockRejectedValue(new Error("must not read upstream"));
  const fallback = new MonitoringQueries(reader);
  for (const day of [
    "",
    koreanDay(reader.data.conversations[0].at),
    "2000-01-01",
  ])
    for (const target of ["", "샘플 A", "샘플 B", "missing"]) {
      expect(await projection.overview({ day, target })).toEqual(
        await fallback.overview({ day, target }),
      );
      for (const label of ["", "positive", "unreviewed"] as const) {
        for (const status of [
          "",
          "pending",
          "unclassified",
          "recheck",
          "classified",
        ]) {
          const input = listSchema.parse({
            day,
            target,
            label,
            status,
            limit: 3,
          });
          expect(await projection.conversations(input)).toEqual(
            await fallback.conversations(input),
          );
        }
      }
    }
  expect(refresh).not.toHaveBeenCalled();
});
it("traverses tied timestamps, binds cursors to scope and caps pages in SQL", async () => {
  const projection = model();
  await projection.refresh();
  const ids: string[] = [];
  let cursor: string | undefined;
  do {
    const page = await projection.conversations(
      listSchema.parse({ limit: 4, cursor }),
    );
    ids.push(...page.items.map((i) => i.id));
    cursor = page.nextCursor || undefined;
  } while (cursor);
  expect(ids).toHaveLength(29);
  expect(new Set(ids).size).toBe(29);
  const page = await projection.conversations(listSchema.parse({ limit: 2 }));
  await expect(
    projection.conversations(
      listSchema.parse({ target: "샘플 A", cursor: page.nextCursor }),
    ),
  ).rejects.toThrow();
  await expect(
    projection.conversations(listSchema.parse({ cursor: "garbage" })),
  ).rejects.toThrow();
});
it("serves persisted generations on restart while the source is unavailable and rolls back failed rebuilds", async () => {
  const dir = mkdtempSync(path.join(tmpdir(), "mention-read-model-"));
  directories.push(dir);
  const filename = path.join(dir, "synthetic.db");
  const reader = new FakeReader();
  const first = model(reader, filename);
  await first.refresh();
  const before = await first.overview({ day: "", target: "" });
  const unavailable = new FakeReader();
  vi.spyOn(unavailable, "refresh").mockRejectedValue(new Error("offline"));
  const restarted = model(unavailable, filename);
  expect(await restarted.overview({ day: "", target: "" })).toEqual(before);
  await expect(restarted.refresh()).rejects.toThrow("offline");
  reader.data.conversations.push(reader.data.conversations[0]);
  await expect(first.refresh()).rejects.toThrow();
  expect(await restarted.overview({ day: "", target: "" })).toEqual(before);
});
it("coalesces background rebuilds but refreshes again after a write", async () => {
  const reader = new FakeReader();
  const projection = model(reader);
  await projection.refresh();
  const original = reader.data;
  let release!: (data: typeof original) => void;
  const refresh = vi.spyOn(reader, "refresh").mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        release = resolve;
      }),
  );
  const pending = projection.refresh();
  const same = projection.refresh();
  const afterWrite = projection.refresh(true);
  release(original);
  await Promise.all([pending, same, afterWrite]);
  expect(refresh).toHaveBeenCalledTimes(2);
});
