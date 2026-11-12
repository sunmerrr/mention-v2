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
    evidence: [{ log_id: "synthetic-message", quote: "합성 메시지" }],
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
    await expect(reader.correct(aiInput)).rejects.toThrow(/사람/);
    reader.close();
    reader = new JudgmentExclusions(source, filename);
    await reader.correct(input);
    const persisted = (await reader.classificationOptions(input.id))[0];
    expect(persisted).toMatchObject({
      label: "excluded",
      origin: "human",
      summary: input.summary,
    });
    expect(persisted.history.map((item) => item.origin)).toEqual(["human"]);
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
      ).toBe("human");
      expect(
        inspection.prepare("SELECT count(*) count FROM decisions").get()?.count,
      ).toBe(1);
    } finally {
      inspection.close();
    }
    expect(source.writes).toHaveLength(0);
  } finally {
    reader.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

it("requires exact current AI evidence for exclusions and normal classifications while preserving human decisions", async () => {
  const source = new FakeReader();
  const initial = (await source.classifications())[0];
  const reader = new JudgmentExclusions(source, ":memory:");
  const base = {
    id: initial.conversationId,
    service: initial.target,
    verdict: "excluded" as const,
    summary: "가입 문의이며 평가는 없습니다.",
    expected: initial.expected,
    request_id: randomUUID(),
    origin: "ai" as const,
  };
  try {
    await expect(reader.correct(base)).rejects.toThrow(/근거/);
    await expect(
      reader.correct({
        ...base,
        evidence: [{ log_id: "synthetic-message", quote: "없는 문장" }],
      }),
    ).rejects.toThrow(/일치/);
    const input = {
      ...base,
      evidence: [{ log_id: "synthetic-message", quote: "합성 메시지" }],
    };
    await reader.correct(input);
    await reader.correct(input);
    expect(
      (await reader.classificationOptions(input.id))[0].history,
    ).toHaveLength(1);
    const option = (await reader.classificationOptions(input.id))[0];
    await reader.correct({
      ...input,
      origin: "human",
      request_id: randomUUID(),
      expected: option.expected,
    });
    const human = (await reader.classificationOptions(input.id))[0];
    await expect(
      reader.correct({
        ...input,
        request_id: randomUUID(),
        expected: human.expected,
      }),
    ).rejects.toThrow(/사람/);
  } finally {
    reader.close();
  }
});

it("reserves normal AI publication, preserves origin and evidence, and replays only the same successful request", async () => {
  const source = new FakeReader();
  const initial = (await source.classifications())[0];
  let current = { ...initial, stale: true };
  vi.spyOn(source, "classifications").mockImplementation(async () => [current]);
  const correct = vi
    .spyOn(source, "correct")
    .mockImplementation(async (input) => {
      current = {
        ...current,
        label: input.verdict,
        summary: input.summary,
        stale: false,
        expected: "changed-after-save",
      };
    });
  const reader = new JudgmentExclusions(source, ":memory:");
  const input = {
    id: initial.conversationId,
    service: initial.target,
    verdict: "negative" as const,
    summary: "실제 불편을 평가했습니다.",
    expected: initial.expected,
    request_id: randomUUID(),
    origin: "ai" as const,
    evidence: [{ log_id: "synthetic-message", quote: "합성 메시지" }],
  };
  try {
    await reader.correct(input);
    await reader.correct(input);
    expect(correct).toHaveBeenCalledOnce();
    expect(correct.mock.calls[0][0]).toMatchObject({
      origin: "ai",
      evidence: input.evidence,
    });
    await expect(
      reader.correct({ ...input, summary: "다른 내용" }),
    ).rejects.toThrow(/같은 요청/);
  } finally {
    reader.close();
  }
});

it("never automatically repeats an uncertain AI publication under a fresh request ID", async () => {
  const source = new FakeReader();
  const initial = (await source.classifications())[0];
  const correct = vi
    .spyOn(source, "correct")
    .mockRejectedValue(new Error("Synthetic ambiguous failure"));
  const reader = new JudgmentExclusions(source, ":memory:");
  const input = {
    id: initial.conversationId,
    service: initial.target,
    verdict: "neutral" as const,
    summary: "합성 이유",
    expected: initial.expected,
    request_id: randomUUID(),
    origin: "ai" as const,
    evidence: [{ log_id: "synthetic-message", quote: "합성 메시지" }],
  };
  try {
    await expect(reader.correct(input)).rejects.toThrow(/ambiguous/);
    await expect(reader.correct(input)).rejects.toThrow(/확인/);
    await expect(
      reader.correct({ ...input, request_id: randomUUID() }),
    ).rejects.toThrow(/불확실/);
    expect(correct).toHaveBeenCalledOnce();
  } finally {
    reader.close();
  }
});

it("rejects stale human classifications for both exclusions and normal AI writes", async () => {
  const source = new FakeReader();
  const initial = (await source.classifications())[0];
  vi.spyOn(source, "classifications").mockResolvedValue([
    { ...initial, label: "unreviewed", origin: "human", stale: true },
  ]);
  const correct = vi.spyOn(source, "correct");
  const reader = new JudgmentExclusions(source, ":memory:");
  try {
    for (const verdict of ["excluded", "neutral"] as const) {
      await expect(
        reader.correct({
          id: initial.conversationId,
          service: initial.target,
          verdict,
          summary: "Synthetic AI reason",
          expected: initial.expected,
          request_id: randomUUID(),
          origin: "ai",
          evidence: [{ log_id: "synthetic-message", quote: "합성 메시지" }],
        }),
      ).rejects.toThrow(/사람/);
    }
    expect(correct).not.toHaveBeenCalled();
  } finally {
    reader.close();
  }
});

it("stores alias-address exclusions under the canonical conversation without changing replay payloads", async () => {
  const { DatabaseSync } = await import("node:sqlite");
  const { mkdtempSync, rmSync } = await import("node:fs");
  const { tmpdir } = await import("node:os");
  const path = await import("node:path");
  const directory = mkdtempSync(
    path.join(tmpdir(), "mention-canonical-exclusion-"),
  );
  const filename = path.join(directory, "decisions.db");
  const source = new FakeReader();
  const initial = (await source.classifications())[0];
  const alias = "f".repeat(32);
  const originalDetail = source.detail.bind(source);
  vi.spyOn(source, "detail").mockImplementation(async (id) =>
    originalDetail(id === alias ? initial.conversationId : id),
  );
  Object.assign(source, {
    classificationOptions: vi.fn(async () => [initial]),
  });
  const reader = new JudgmentExclusions(source, filename);
  const input = {
    id: alias,
    service: initial.target,
    verdict: "excluded" as const,
    summary: "가입 절차 문의",
    expected: initial.expected,
    request_id: randomUUID(),
    origin: "ai" as const,
    evidence: [{ log_id: "synthetic-message", quote: "합성 메시지" }],
  };
  try {
    await reader.correct(input);
    await reader.correct(input);
    expect(
      (await reader.detail(initial.conversationId)).conversation.evaluations[
        initial.target
      ],
    ).toMatchObject({ label: "excluded", origin: "ai", stale: false });
    const fromAlias = (await reader.classificationOptions(alias))[0];
    const fromCanonical = (
      await reader.classificationOptions(initial.conversationId)
    )[0];
    expect(fromAlias).toEqual(fromCanonical);
    expect(fromCanonical.history).toHaveLength(1);
    const inspection = new DatabaseSync(filename, { readOnly: true });
    try {
      const exclusion = inspection
        .prepare("SELECT id,metadata FROM exclusions")
        .get();
      expect(exclusion?.id).toBe(initial.conversationId);
      expect(JSON.parse(exclusion?.metadata as string).conversationId).toBe(
        initial.conversationId,
      );
      expect(
        inspection.prepare("SELECT id FROM decision_events").get()?.id,
      ).toBe(initial.conversationId);
      const receipt = inspection
        .prepare(
          "SELECT payload,canonical_id FROM decisions WHERE request_id=?",
        )
        .get(input.request_id);
      expect(receipt?.canonical_id).toBe(initial.conversationId);
      expect(JSON.parse(receipt?.payload as string).id).toBe(alias);
      expect(receipt?.payload).toBe(JSON.stringify(input));
      expect(
        inspection.prepare("SELECT count(*) count FROM exclusions").get()
          ?.count,
      ).toBe(1);
    } finally {
      inspection.close();
    }
  } finally {
    reader.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

it("serializes alias and canonical exclusion requests against the same revision", async () => {
  const source = new FakeReader();
  const initial = (await source.classifications())[0];
  Object.assign(source, { classificationOptions: async () => [initial] });
  const reader = new JudgmentExclusions(source, ":memory:");
  const base = {
    service: initial.target,
    verdict: "excluded" as const,
    summary: "Synthetic administrative question",
    expected: initial.expected,
  };
  try {
    const results = await Promise.allSettled([
      reader.correct({ ...base, id: "e".repeat(32), request_id: randomUUID() }),
      reader.correct({
        ...base,
        id: initial.conversationId,
        request_id: randomUUID(),
      }),
    ]);
    expect(results.filter((row) => row.status === "fulfilled")).toHaveLength(1);
    expect(results.filter((row) => row.status === "rejected")).toHaveLength(1);
    expect(
      (await reader.classificationOptions(initial.conversationId))[0].history,
    ).toHaveLength(1);
  } finally {
    reader.close();
  }
});

it("marks an AI exclusion stale after source changes and clears staleness only after a fresh evidence-bound review", async () => {
  const source = new FakeReader();
  const initial = (await source.classifications())[0];
  let current = initial;
  vi.spyOn(source, "classifications").mockImplementation(async () => [current]);
  const evaluation = source.data.conversations[0].evaluations[initial.target];
  Object.assign(evaluation, { expected: initial.expected });
  const reader = new JudgmentExclusions(source, ":memory:");
  const input = {
    id: initial.conversationId,
    service: initial.target,
    verdict: "excluded" as const,
    summary: "평가 없는 가입 문의",
    expected: initial.expected,
    request_id: randomUUID(),
    origin: "ai" as const,
    evidence: [{ log_id: "synthetic-message", quote: "합성 메시지" }],
  };
  try {
    await reader.correct(input);
    expect(
      (await reader.read()).conversations[0].evaluations[initial.target],
    ).toMatchObject({ label: "excluded", stale: false });
    current = { ...initial, expected: "new-context-token", stale: true };
    Object.assign(evaluation, {
      expected: current.expected,
      label: "unreviewed",
      stale: true,
    });
    const option = (await reader.classificationOptions(input.id))[0];
    expect(option).toMatchObject({
      label: "excluded",
      origin: "ai",
      stale: true,
    });
    for (const dataset of [await reader.read(), await reader.refresh()]) {
      expect(
        dataset.conversations[0].evaluations[initial.target],
      ).toMatchObject({
        label: "unreviewed",
        origin: "ai",
        stale: true,
        previous: { label: "excluded", origin: "ai" },
      });
      expect(
        summarize(dataset, { day: "", target: initial.target }).unclassified,
      ).toBeGreaterThan(0);
    }
    expect(
      (await reader.detail(input.id)).conversation.evaluations[initial.target],
    ).toMatchObject({
      label: "unreviewed",
      stale: true,
      previous: { label: "excluded", origin: "ai" },
    });
    expect((await reader.classifications())[0]).toMatchObject({
      label: "excluded",
      stale: true,
    });
    await reader.correct({
      ...input,
      expected: option.expected,
      request_id: randomUUID(),
      summary: "새 맥락도 절차 안내뿐임을 확인",
    });
    expect((await reader.classificationOptions(input.id))[0]).toMatchObject({
      label: "excluded",
      origin: "ai",
      stale: false,
    });
    expect(
      (await reader.read()).conversations[0].evaluations[initial.target],
    ).toMatchObject({ label: "excluded", stale: false });
    expect(source.writes).toHaveLength(0);
  } finally {
    reader.close();
  }
});

it("keeps a human exclusion protected when its source evidence changes", async () => {
  const source = new FakeReader();
  const initial = (await source.classifications())[0];
  let current = initial;
  vi.spyOn(source, "classifications").mockImplementation(async () => [current]);
  const evaluation = source.data.conversations[0].evaluations[initial.target];
  Object.assign(evaluation, { expected: initial.expected });
  const reader = new JudgmentExclusions(source, ":memory:");
  try {
    await reader.correct({
      id: initial.conversationId,
      service: initial.target,
      verdict: "excluded",
      summary: "Human administrative exclusion",
      expected: initial.expected,
      request_id: randomUUID(),
    });
    current = { ...initial, expected: "new-human-source", stale: true };
    Object.assign(evaluation, {
      expected: current.expected,
      label: "unreviewed",
      stale: true,
    });
    const option = (
      await reader.classificationOptions(initial.conversationId)
    )[0];
    expect(option).toMatchObject({
      label: "excluded",
      origin: "human",
      stale: false,
    });
    expect(
      (await reader.read()).conversations[0].evaluations[initial.target],
    ).toMatchObject({ label: "excluded", origin: "human", stale: false });
    await expect(
      reader.correct({
        id: initial.conversationId,
        service: initial.target,
        verdict: "negative",
        summary: "AI cannot replace a human exclusion",
        expected: option.expected,
        request_id: randomUUID(),
        origin: "ai",
        evidence: [{ log_id: "synthetic-message", quote: "합성 메시지" }],
      }),
    ).rejects.toThrow(/사람/);
  } finally {
    reader.close();
  }
});

it("blocks uncertain AI publication through a different alias for the same canonical target", async () => {
  const source = new FakeReader();
  const initial = (await source.classifications())[0];
  const originalDetail = source.detail.bind(source);
  vi.spyOn(source, "detail").mockImplementation(async () =>
    originalDetail(initial.conversationId),
  );
  Object.assign(source, { classificationOptions: async () => [initial] });
  const correct = vi
    .spyOn(source, "correct")
    .mockRejectedValue(new Error("Synthetic uncertain response"));
  const reader = new JudgmentExclusions(source, ":memory:");
  const base = {
    service: initial.target,
    verdict: "neutral" as const,
    summary: "Synthetic AI reason",
    expected: initial.expected,
    origin: "ai" as const,
    evidence: [{ log_id: "synthetic-message", quote: "합성 메시지" }],
  };
  try {
    await expect(
      reader.correct({ ...base, id: "a".repeat(32), request_id: randomUUID() }),
    ).rejects.toThrow(/uncertain/);
    await expect(
      reader.correct({
        ...base,
        id: initial.conversationId,
        request_id: randomUUID(),
      }),
    ).rejects.toThrow(/불확실/);
    expect(correct).toHaveBeenCalledOnce();
  } finally {
    reader.close();
  }
});

it("deduplicates canonical metadata shared by multiple orphan exclusion rows", async () => {
  const { DatabaseSync } = await import("node:sqlite");
  const { mkdtempSync, rmSync } = await import("node:fs");
  const { tmpdir } = await import("node:os");
  const path = await import("node:path");
  const directory = mkdtempSync(
    path.join(tmpdir(), "mention-orphan-metadata-"),
  );
  const filename = path.join(directory, "decisions.db");
  const source = new FakeReader();
  const initial = (await source.classifications())[0];
  const conversation = source.data.conversations.find(
    (item) => item.id === initial.conversationId,
  );
  if (!conversation) throw new Error("Missing synthetic conversation");
  Object.assign(conversation.evaluations[initial.target], {
    expected: initial.expected,
  });
  const reader = new JudgmentExclusions(source, filename);
  vi.spyOn(source, "classifications").mockResolvedValue([]);
  const synthetic = new DatabaseSync(filename);
  try {
    for (const id of ["a".repeat(32), "b".repeat(32)])
      synthetic
        .prepare(
          "INSERT INTO exclusions(id,target,active,revision,summary,base,metadata,origin) VALUES (?,?,1,1,?,?,?,'ai')",
        )
        .run(
          id,
          initial.target,
          "Synthetic orphan",
          initial.expected,
          JSON.stringify(initial),
        );
    const classifications = await reader.classifications();
    expect(
      classifications.filter((item) => item.id === initial.id),
    ).toHaveLength(1);
    expect(
      synthetic.prepare("SELECT count(*) count FROM exclusions").get()?.count,
    ).toBe(2);
  } finally {
    synthetic.close();
    reader.close();
    rmSync(directory, { recursive: true, force: true });
  }
});
