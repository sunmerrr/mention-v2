import { expect, it } from "vitest";
import { selectHighlights } from "../packages/domain/src/model";
import { fixture } from "./fakes";

it("selects distinct reactions, excludes stale or unsupported summaries, and respects scope", () => {
  const data = fixture();
  data.conversations[0].evaluations["샘플 A"].stale = true;
  data.conversations[1].evaluations["샘플 A"].summary = "";
  data.conversations[2].messageCount = 1;
  const highlights = selectHighlights(data, { day: "", target: "샘플 A" });
  expect(highlights).toHaveLength(4);
  expect(new Set(highlights.map((h) => `${h.target}:${h.label}`)).size).toBe(4);
  expect(
    highlights.every(
      (h) => !data.conversations.slice(0, 3).some((c) => c.id === h.id),
    ),
  ).toBe(true);
  expect(selectHighlights(data, { day: "2000-01-01", target: "" })).toEqual([]);
  expect(selectHighlights(data, { day: "", target: "샘플 B" })).toEqual([]);
});

it("separates latest activity from confirmed positive/negative context and preserves target attribution", async () => {
  const { selectConversationSections } = await import(
    "../packages/domain/src/model"
  );
  const data = fixture();
  data.conversations[0].lastAt = data.conversations[0].at + 10000;
  data.conversations[0].contextPreview = [
    {
      id: "synthetic-preview",
      author: "Synthetic",
      text: "실제 연결 대화 발췌",
      at: data.conversations[0].at,
    },
  ];
  data.conversations[0].evaluations["샘플 B"] = {
    label: "negative",
    summary: "다른 대상에는 부정적인 의견",
    origin: "human",
    stale: false,
  };
  data.conversations[1].evaluations["샘플 A"].stale = true;
  const sections = selectConversationSections(data, { day: "", target: "" });
  expect(sections.latest[0].id).toBe(data.conversations[0].id);
  expect(sections.latest[0].contextPreview[0].text).toBe("실제 연결 대화 발췌");
  expect(sections.latest[0].opinions.map((o) => o.label)).toEqual([
    "positive",
    "negative",
  ]);
  expect(
    sections.positive.some(
      (c) => c.id === data.conversations[0].id && c.target === "샘플 A",
    ),
  ).toBe(true);
  expect(
    sections.negative.some(
      (c) => c.id === data.conversations[0].id && c.target === "샘플 B",
    ),
  ).toBe(true);
  expect(sections.negative.some((c) => c.id === data.conversations[1].id)).toBe(
    false,
  );
  expect(sections.positive.every((c) => c.label === "positive")).toBe(true);
  expect(
    selectConversationSections(data, { day: "2000-01-01", target: "" }),
  ).toEqual({ latest: [], positive: [], negative: [] });
  const target = selectConversationSections(data, {
    day: "",
    target: "샘플 A",
  });
  expect(target.negative.every((c) => c.target === "샘플 A")).toBe(true);
  expect(
    target.latest
      .flatMap((c) => c.opinions)
      .every((o) => o.target === "샘플 A"),
  ).toBe(true);
});
