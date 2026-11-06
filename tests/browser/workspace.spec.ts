import { expect, test } from "@playwright/test";

test("SSR contains data without JavaScript", async ({ browser, baseURL }) => {
  const context = await browser.newContext({
    javaScriptEnabled: false,
    baseURL,
  });
  const page = await context.newPage();
  await page.goto("/");
  await expect(
    page.getByRole("heading", { name: "여론·동향", exact: true }),
  ).toBeVisible();
  await expect(page.getByText("대상별 여론", { exact: true })).toBeVisible();
  await expect(page.locator(".conversation-link").first()).toBeVisible();
  await context.close();
});
test("hydration reuses data and navigation retains the document", async ({
  page,
}) => {
  let documents = 0,
    apis = 0;
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("request", (r) => {
    if (r.isNavigationRequest() && r.frame() === page.mainFrame()) documents++;
    if (new URL(r.url()).pathname.startsWith("/api/")) apis++;
  });
  await page.goto("/");
  await page.waitForFunction(
    () => document.documentElement.dataset.hydrated === "true",
  );
  expect(apis).toBe(0);
  await page.getByRole("link", { name: "분류 검토", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "분류 검토", exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "분류 수정", exact: true })
    .first()
    .click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await expect(
    page.getByRole("button", { name: "수정 저장", exact: true }),
  ).toBeDisabled();
  await page.getByRole("button", { name: "취소", exact: true }).click();
  await page.getByRole("link", { name: "대화 목록", exact: true }).click();
  await page.locator(".conversation-link").first().click();
  await expect(
    page.getByRole("heading", { name: "대화 맥락", exact: true }),
  ).toBeVisible();
  await expect(page.locator(".message").first()).toBeVisible();
  for (let cycle = 0; cycle < 4; cycle++) {
    await page.getByRole("link", { name: "분류 검토", exact: true }).click();
    await expect(
      page.getByRole("heading", { name: "분류 검토", exact: true }),
    ).toBeVisible();
    await page.getByRole("link", { name: "여론·동향", exact: true }).click();
    await expect(
      page.getByRole("heading", { name: "여론·동향", exact: true }),
    ).toBeVisible();
  }
  expect(documents).toBe(1);
  expect(errors).toEqual([]);
});
test("filters preserve confirmed counts and the layout fits mobile", async ({
  page,
}) => {
  await page.goto("/?target=APL");
  await page.waitForFunction(
    () => document.documentElement.dataset.hydrated === "true",
  );
  const response = await page.request.get("/api/overview?target=APL");
  const target = (await response.json()).data.overview.targets[0];
  await expect(
    page.getByText(`${target.classified} / ${target.conversations}`, {
      exact: true,
    }),
  ).toBeVisible();
  await page.setViewportSize({ width: 390, height: 844 });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
});
