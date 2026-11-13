import { renderToString } from "react-dom/server";
import { expect, it } from "vitest";
import { DesignSystemProvider } from "../apps/web/src/design-system";
import { KeywordSources } from "../apps/web/src/pages/manage/KeywordSources";
import { RuntimeContext } from "../apps/web/src/runtime";

function render() {
  return renderToString(
    <RuntimeContext.Provider value={{ local: true, writesEnabled: true }}>
      <DesignSystemProvider>
        <KeywordSources
          words={["카톡전용", "포럼전용", "공통별칭"]}
          groups={[
            {
              name: "합성 대상",
              keywords: ["카톡전용", "포럼전용", "공통별칭"],
            },
          ]}
          sources={{
            kakao: { disabled: ["포럼전용"] },
            pokergosu: { disabled: ["카톡전용"] },
          }}
          onChange={() => {}}
          onAdd={() => {}}
          supported
        />
      </DesignSystemProvider>
    </RuntimeContext.Provider>,
  );
}
it("SSR opens Kakao scope with group controls, partial status and no selection checkboxes", () => {
  const html = render();
  expect(html).toContain("합성 대상 카톡 묶음 수집");
  expect(html).toContain("3개 중 2개 수집");
  expect(html).not.toContain('role="checkbox"');
  expect(html).toContain("개별 예외 설정");
  expect(html).toMatch(/aria-selected="true"[^>]*id="[^"]*-trigger-kakao"/);
});
