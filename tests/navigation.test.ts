import { expect, it } from "vitest";
import { relatedHref, selectedMenu } from "../apps/web/src/navigation";

it("keeps workflow origin across context/review links and reloads but direct menus select themselves", () => {
  const review = relatedHref("/reviews?target=APL", "/conversations");
  const url = new URL(review, "http://localhost");
  expect(url.searchParams.get("target")).toBe("APL");
  expect(selectedMenu(url.pathname, url.search)).toBe("/conversations");
  const detail = relatedHref("/conversations/synthetic", "/reviews");
  const target = new URL(detail, "http://localhost");
  expect(selectedMenu(target.pathname, target.search)).toBe("/reviews");
  expect(selectedMenu("/reviews", "")).toBe("/reviews");
  expect(selectedMenu("/conversations", "")).toBe("/conversations");
  expect(selectedMenu("/keywords", "?nav=/reviews")).toBe("/keywords");
  expect(selectedMenu("/reviews", "?nav=https://example.invalid")).toBe(
    "/reviews",
  );
});

it("keeps opinion summaries separate from post-list and legacy detail navigation", () => {
  expect(selectedMenu("/pokergosu", "")).toBe("/pokergosu");
  expect(selectedMenu("/posts", "?q=sample")).toBe("/posts");
  expect(selectedMenu("/posts/123", "?q=sample")).toBe("/posts");
  expect(selectedMenu("/pokergosu/123", "")).toBe("/posts");
});
