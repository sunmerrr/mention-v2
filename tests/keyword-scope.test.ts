import { expect, it } from "vitest";
import { updateSourceScope } from "../packages/domain/src/keyword-scope";

it("group updates affect exactly its aliases in one source without mutating input", () => {
  const original = {
    kakao: { disabled: ["APL", "루루", "미지정"] },
    pokergosu: { disabled: ["룰루"] },
  };
  const next = updateSourceScope(original, "kakao", ["룰루", "루루"], true);
  expect(next.kakao.disabled).toEqual(["APL", "미지정"]);
  expect(next.pokergosu).toEqual(original.pokergosu);
  expect(original.kakao.disabled).toEqual(["APL", "루루", "미지정"]);
});
it("a single exception preserves the rest of its group and duplicate updates are idempotent", () => {
  const original = {
    kakao: { disabled: [] as string[] },
    pokergosu: { disabled: ["APL"] },
  };
  const next = updateSourceScope(original, "kakao", ["룰루"], false);
  expect(next.kakao.disabled).toEqual(["룰루"]);
  expect(updateSourceScope(next, "kakao", ["룰루"], false)).toEqual(next);
  expect(next.pokergosu.disabled).toEqual(["APL"]);
});
