import { randomUUID } from "node:crypto";
import { expect, it, vi } from "vitest";
import { JudgmentExclusions } from "../apps/read-api/src/adapters/judgment-exclusions";
import { MonitoringReadModel } from "../apps/read-api/src/adapters/read-model";
import { correctionSchema, listSchema } from "../packages/contracts/src/api";
import { summarize } from "../packages/domain/src/model";
import { FakeReader } from "./fakes";

it("stores exclusion separately, removes it from opinion and pending counts, preserves audit and permits explicit restoration", async () => {
  const source = new FakeReader();
  const initial = (await source.classifications())[0];
  let current = initial;
  vi.spyOn(source, "classifications").mockImplementation(async () => [current]);
  const correct = vi
    .spyOn(source, "correct")
    .mockImplementation(async (input) => {
      current = {
        ...current,
        label: input.verdict,
        summary: input.summary,
        origin: "human",
      };
    });
  const reader = new JudgmentExclusions(source, ":memory:");
  const projection = new MonitoringReadModel(reader, ":memory:");
  try {
    const input = {
      id: initial.conversationId,
      service: initial.target,
      verdict: "excluded" as const,
      summary: "Not an opinion",
      expected: initial.expected,
      request_id: randomUUID(),
    };
    await reader.correct(input);
    await reader.correct(input);
    expect(correct).not.toHaveBeenCalled();
    const options = await reader.classificationOptions(initial.conversationId);
    const excluded = options.find((item) => item.target === initial.target);
    if (!excluded) throw new Error("Missing exclusion option");
    expect(excluded).toMatchObject({
      label: "excluded",
      origin: "human",
      summary: "Not an opinion",
      stale: false,
    });
    expect(
      excluded.history.filter((event) => event.after === "excluded"),
    ).toHaveLength(1);
    const dataset = await reader.read();
    const overview = summarize(dataset, { day: "", target: initial.target });
    expect(overview.excluded).toBe(1);
    await projection.refresh();
    expect(
      (
        await projection.conversations(
          listSchema.parse({ status: "excluded", target: initial.target }),
        )
      ).items.map((item) => item.id),
    ).toContain(initial.conversationId);
    expect(
      (
        await projection.conversations(
          listSchema.parse({ status: "pending", target: initial.target }),
        )
      ).items.map((item) => item.id),
    ).not.toContain(initial.conversationId);
    await expect(
      reader.correct({ ...input, request_id: randomUUID() }),
    ).rejects.toThrow(/변경/);
    await reader.correct({
      ...input,
      verdict: "neutral",
      summary: "Now reviewed",
      expected: excluded.expected,
      request_id: randomUUID(),
    });
    expect(correct).toHaveBeenCalledOnce();
    expect(
      (await reader.classificationOptions(initial.conversationId)).find(
        (item) => item.target === initial.target,
      )?.label,
    ).toBe("neutral");
  } finally {
    projection.close();
    reader.close();
  }
});

it("retains an exclusion and its replay receipt across web-reader replacements", async () => {
  const { mkdtempSync, rmSync } = await import("node:fs");
  const { tmpdir } = await import("node:os");
  const path = await import("node:path");
  const directory = mkdtempSync(
    path.join(tmpdir(), "mention-exclusion-synthetic-"),
  );
  const filename = path.join(directory, "decisions.db");
  const source = new FakeReader();
  const initial = (await source.classifications())[0];
  const input = {
    id: initial.conversationId,
    service: initial.target,
    verdict: "excluded" as const,
    summary: "Synthetic notice",
    expected: initial.expected,
    request_id: randomUUID(),
  };
  let reader = new JudgmentExclusions(source, filename);
  try {
    await reader.correct(input);
    reader.close();
    reader = new JudgmentExclusions(source, filename);
    await reader.correct(input);
    expect((await reader.classificationOptions(input.id))[0]).toMatchObject({
      label: "excluded",
      summary: "Synthetic notice",
    });
    expect(source.writes).toHaveLength(0);
  } finally {
    reader.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

it("preserves explicit AI exclusion attribution in every read surface and later human edits", async () => {
  const source = new FakeReader();
  const initial = (await source.classifications())[0];
  const reader = new JudgmentExclusions(source, ":memory:");
  const input = correctionSchema.parse({
    id: initial.conversationId,
    service: initial.target,
    verdict: "excluded",
    summary: "가입 방법만 문의하며 서비스 평가는 없습니다.",
    expected: initial.expected,
    request_id: randomUUID(),
    origin: "ai",
  });
  try {
    await reader.correct(input);
    const options = await reader.classificationOptions(input.id);
    expect(options[0]).toMatchObject({ label: "excluded", origin: "ai" });
    expect(options[0].history[0]).toMatchObject({
      origin: "ai",
      after: "excluded",
      note: input.summary,
    });
    expect((await reader.classifications())[0]).toMatchObject({
      label: "excluded",
      origin: "ai",
    });
    for (const dataset of [await reader.read(), await reader.refresh()]) {
      const evaluation = dataset.conversations.find(
        (item) => item.id === input.id,
      )?.evaluations[input.service];
      expect(evaluation).toMatchObject({
        label: "excluded",
        origin: "ai",
        summary: input.summary,
      });
    }
    expect(
      (await reader.detail(input.id)).conversation.evaluations[input.service],
    ).toMatchObject({ label: "excluded", origin: "ai" });
    const humanInput = correctionSchema.parse({
      ...input,
      origin: undefined,
      expected: options[0].expected,
      request_id: randomUUID(),
      summary: "사람이 확인한 가입 문의",
    });
    expect(JSON.stringify(humanInput)).not.toContain('"origin"');
    await reader.correct(humanInput);
    const updated = (await reader.classificationOptions(input.id))[0];
    expect(updated.origin).toBe("human");
    expect(updated.history.map((item) => item.origin)).toEqual(["human", "ai"]);
    expect(source.writes).toHaveLength(0);
    expect(source.data.conversations[0].evaluations[initial.target].label).toBe(
      "positive",
    );
  } finally {
    reader.close();
  }
});

it("migrates legacy exclusions as human without rewriting legacy replay payloads", async () => {
  const { DatabaseSync } = await import("node:sqlite");
  const { mkdtempSync, rmSync } = await import("node:fs");
  const { tmpdir } = await import("node:os");
  const path = await import("node:path");
  const directory = mkdtempSync(
    path.join(tmpdir(), "mention-exclusion-origin-synthetic-"),
  );
  const filename = path.join(directory, "decisions.db");
  const source = new FakeReader();
  const initial = (await source.classifications())[0];
  const input = correctionSchema.parse({
    id: initial.conversationId,
    service: initial.target,
    verdict: "excluded",
    summary: "Legacy manual exclusion",
    expected: initial.expected,
    request_id: randomUUID(),
  });
  expect(input).not.toHaveProperty("origin");
  const originalPayload = JSON.stringify(input);
  const legacy = new DatabaseSync(filename);
  legacy.exec(`CREATE TABLE exclusions(id TEXT,target TEXT,active INTEGER,revision INTEGER,summary TEXT,base TEXT,metadata TEXT,PRIMARY KEY(id,target));
    CREATE TABLE decisions(request_id TEXT PRIMARY KEY,payload TEXT,state TEXT,at TEXT);
    CREATE TABLE decision_events(request_id TEXT PRIMARY KEY,id TEXT,target TEXT,previous TEXT,next TEXT,at TEXT);`);
  legacy
    .prepare("INSERT INTO exclusions VALUES (?,?,?,?,?,?,?)")
    .run(
      input.id,
      input.service,
      1,
      1,
      input.summary,
      input.expected,
      JSON.stringify(initial),
    );
  legacy
    .prepare("INSERT INTO decisions VALUES (?,?,?,?)")
    .run(
      input.request_id,
      originalPayload,
      "saved",
      "2026-11-01T00:00:00.000Z",
    );
  legacy
    .prepare("INSERT INTO decision_events VALUES (?,?,?,?,?,?)")
    .run(
      input.request_id,
      input.id,
      input.service,
      JSON.stringify(initial),
      JSON.stringify({ label: "excluded", summary: input.summary }),
      "2026-11-01T00:00:00.000Z",
    );
  legacy.close();
  let reader = new JudgmentExclusions(source, filename);
  try {
    await reader.correct(correctionSchema.parse(input));
    const migrated = (await reader.classificationOptions(input.id))[0];
    expect(migrated).toMatchObject({ label: "excluded", origin: "human" });
    expect(migrated.history).toHaveLength(1);
    expect(migrated.history[0].origin).toBe("human");
    const aiInput = {
      ...input,
      expected: migrated.expected,
      request_id: randomUUID(),
      origin: "ai" as const,
      summary: "AI rechecked administrative inquiry",
    };
    await reader.correct(aiInput);
    reader.close();
    reader = new JudgmentExclusions(source, filename);
    await reader.correct(aiInput);
    const persisted = (await reader.classificationOptions(input.id))[0];
    expect(persisted).toMatchObject({
      label: "excluded",
      origin: "ai",
      summary: aiInput.summary,
    });
    expect(persisted.history.map((item) => item.origin)).toEqual([
      "ai",
      "human",
    ]);
    const inspection = new DatabaseSync(filename, { readOnly: true });
    try {
      expect(
        inspection
          .prepare("SELECT payload FROM decisions WHERE request_id=?")
          .get(input.request_id)?.payload,
      ).toBe(originalPayload);
      expect(
        inspection
          .prepare("SELECT origin FROM exclusions WHERE id=? AND target=?")
          .get(input.id, input.service)?.origin,
      ).toBe("ai");
      expect(
        inspection.prepare("SELECT count(*) count FROM decisions").get()?.count,
      ).toBe(2);
    } finally {
      inspection.close();
    }
    expect(source.writes).toHaveLength(0);
  } finally {
    reader.close();
    rmSync(directory, { recursive: true, force: true });
  }
});
