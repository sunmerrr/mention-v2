import { renderToStaticMarkup } from "react-dom/server";
import { expect, it } from "vitest";
import { EvaluationStatus } from "../apps/web/src/components/ui";

it("distinguishes changed context with a historical decision from genuinely unclassified context", () => {
  const previous = renderToStaticMarkup(
    <EvaluationStatus
      evaluation={{
        label: "unreviewed",
        summary: "old summary",
        origin: null,
        stale: true,
        previous: { label: "neutral", origin: "ai" },
      }}
    />,
  );
  expect(previous).toContain("기존 분류: 중립");
  expect(previous).toContain("맥락 변경 · 재검토 필요");
  expect(previous).toContain("AI 확정");
  expect(previous).not.toContain("미분류");
  const fresh = renderToStaticMarkup(
    <EvaluationStatus
      evaluation={{
        label: "unreviewed",
        summary: "",
        origin: null,
        stale: false,
      }}
    />,
  );
  expect(fresh).toContain("미분류");
  expect(fresh).not.toContain("재검토 필요");
});
