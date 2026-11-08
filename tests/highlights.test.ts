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
