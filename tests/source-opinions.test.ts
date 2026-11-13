import { expect, it } from "vitest";
import {
  emptyOpinionCounts,
  opinionDirection,
  type SourceEvidence,
  sharedOpinionTopics,
} from "../packages/domain/src/source-opinions";

it("never infers neutrality from missing or insufficient classifications", () => {
  expect(opinionDirection(emptyOpinionCounts())).toBe("unreviewed");
  expect(opinionDirection({ ...emptyOpinionCounts(), positive: 2 })).toBe(
    "insufficient",
  );
  expect(opinionDirection({ ...emptyOpinionCounts(), positive: 3 })).toBe(
    "positive",
  );
});
it("shared topics require reviewed summaries on both sources, not raw keyword occurrence", () => {
  const item: SourceEvidence = {
    id: "x",
    target: "APL",
    label: "positive",
    summary: "가격이 저렴",
    href: "/x",
    title: "x",
    at: 0,
  };
  expect(
    sharedOpinionTopics([item], [{ ...item, target: "다른 대상" }]),
  ).toEqual([]);
  expect(
    sharedOpinionTopics([item], [{ ...item, label: "unreviewed" }]),
  ).toEqual([]);
  expect(
    sharedOpinionTopics(
      [item],
      [{ ...item, label: "negative", summary: "가격이 비싸" }],
    )[0].topic,
  ).toBe("가격·가성비");
});
