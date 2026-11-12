import { expect, test } from "@playwright/test";

test("populated SSR and hydration retain the document across list/detail navigation", async ({
  page,
  browser,
  baseURL,
}) => {
  const context = await browser.newContext({
    javaScriptEnabled: false,
    baseURL,
  });
  const ssr = await context.newPage();
  await ssr.goto("/");
  await expect(ssr.getByText("샘플 A", { exact: true }).first()).toBeVisible();
  await context.close();
  let documents = 0;
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("request", (request) => {
    if (request.isNavigationRequest() && request.frame() === page.mainFrame())
      documents++;
  });
  await page.goto("/");
  await page.waitForFunction(
    () => document.documentElement.dataset.hydrated === "true",
  );
  await page.getByLabel("대화·반응 메뉴", { exact: true }).click();
  await page.getByRole("link", { name: "대화 목록", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "대화 목록", exact: true }),
  ).toBeVisible();
  await page.locator(".conversation-link").first().click();
  await expect(
    page.getByRole("heading", { name: "대화 맥락", exact: true }),
  ).toBeVisible();
  await expect(page.locator(".message").first()).toBeVisible();
  expect(documents).toBe(1);
  expect(errors).toEqual([]);
});
test("filters use URL state and narrow layouts do not overflow", async ({
  page,
}) => {
  await page.goto(
    `/conversations?target=${encodeURIComponent("샘플 A")}&label=negative`,
  );
  await page.waitForFunction(
    () => document.documentElement.dataset.hydrated === "true",
  );
  await expect(page.locator(".conversation-link").first()).toBeVisible();
  await page.setViewportSize({ width: 390, height: 844 });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  expect(new URL(page.url()).searchParams.get("label")).toBe("negative");
});
test("unknown routes return 404", async ({ request }) => {
  for (const path of ["/wso.php", "/.env", "/assets/not-found.js"])
    expect((await request.get(path)).status()).toBe(404);
});

test("Pokergosu SSR, scoped filters, pagination and text/media evidence work without duplicate hydration reads", async ({
  page,
  browser,
  baseURL,
}) => {
  const nojs = await browser.newContext({ javaScriptEnabled: false, baseURL });
  const ssr = await nojs.newPage();
  await ssr.goto("/pokergosu");
  await expect(
    ssr.getByRole("heading", { name: "포커고수 여론", exact: true }),
  ).toBeVisible();
  await expect(
    ssr.getByRole("link", { name: "합성 포커고수 게시글 25", exact: true }),
  ).toBeVisible();
  await nojs.close();
  let documents = 0;
  const reads: string[] = [],
    errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("request", (request) => {
    if (request.isNavigationRequest()) documents++;
    if (request.url().includes("/api/pokergosu")) reads.push(request.url());
  });
  await page.goto("/pokergosu");
  await page.waitForFunction(
    () => document.documentElement.dataset.hydrated === "true",
  );
  await expect(
    page.getByRole("button", { name: /게시글 더 보기/ }),
  ).toBeVisible();
  expect(reads).toHaveLength(0);
  await page
    .getByRole("heading", { name: "수집한 게시글", exact: true })
    .scrollIntoViewIfNeeded();
  await page.screenshot({ path: "test-results/pokergosu-desktop.png" });
  await page.getByRole("button", { name: /게시글 더 보기/ }).click();
  await expect(
    page.getByRole("link", { name: "합성 포커고수 게시글 1", exact: true }),
  ).toBeVisible();
  expect(reads).toHaveLength(1);
  await page
    .getByRole("link", { name: "합성 포커고수 게시글 25", exact: true })
    .click();
  await expect(
    page.getByText("룰루에 대한 댓글만 일치", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText("이미지·미디어 댓글 (텍스트 해석 생략)", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("link", { name: /포커고수에서 원문 보기/ }),
  ).toHaveAttribute("href", "https://www.pokergosu.com/free/25");
  await page.screenshot({ path: "test-results/pokergosu-detail.png" });
  await page.getByRole("link", { name: "게시글 목록", exact: true }).click();
  expect(reads).toHaveLength(2);
  await page.getByLabel("본문·댓글 검색", { exact: true }).fill("댓글만");
  await page.getByRole("button", { name: "조회", exact: true }).click();
  await expect(
    page.getByRole("link", { name: "합성 포커고수 게시글 25", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("link", { name: "합성 포커고수 게시글 24", exact: true }),
  ).toHaveCount(0);
  expect(new URL(page.url()).searchParams.get("q")).toBe("댓글만");
  await page.getByLabel("일치한 관심 키워드", { exact: true }).click();
  await page.getByRole("option", { name: "룰루", exact: true }).click();
  await expect(
    page.getByLabel("일치한 관심 키워드", { exact: true }),
  ).toContainText("룰루");
  await page.getByLabel("본문·댓글 검색", { exact: true }).press("Enter");
  await expect(page).toHaveURL(/keyword=/);
  await expect(
    page.getByRole("link", { name: "합성 포커고수 게시글 25", exact: true }),
  ).toBeVisible();
  expect(documents).toBe(1);
  expect(errors).toEqual([]);
});

test("Pokergosu remains usable on mobile and empty/error states are explicit", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/pokergosu");
  await page.waitForFunction(
    () => document.documentElement.dataset.hydrated === "true",
  );
  await expect(page.getByLabel("페이지 이동", { exact: true })).toContainText(
    "포커고수 여론",
  );
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({ path: "test-results/pokergosu-mobile.png" });
  const table = page.getByRole("region", {
    name: "수집한 포커고수 게시글",
    exact: true,
  });
  await table.focus();
  await expect(table).toBeFocused();
  await table.press("ArrowRight");
  await expect
    .poll(() =>
      table
        .locator("[data-radix-scroll-area-viewport]")
        .evaluate((element) => element.scrollLeft),
    )
    .toBeGreaterThan(0);

  await page
    .getByLabel("본문·댓글 검색", { exact: true })
    .fill("일치할수없는합성검색");
  await page.getByRole("button", { name: "조회", exact: true }).click();
  await expect(
    page.getByText("이 조건에 맞는 수집 글이 없습니다.", { exact: true }),
  ).toBeVisible();
  await page.route("**/api/pokergosu?**", (route) =>
    route.fulfill({
      status: 503,
      contentType: "application/json",
      body: JSON.stringify({
        success: false,
        data: null,
        error: { message: "합성 연결 오류" },
      }),
    }),
  );
  await page
    .getByRole("button", { name: "수집 데이터 새로고침", exact: true })
    .click();
  await expect(page.getByText("합성 연결 오류")).toBeVisible();
  await expect(
    page.getByRole("button", { name: "다시 시도", exact: true }),
  ).toBeVisible();
});

test("retained photos require an explicit load and then use local cached bytes", async ({
  page,
}) => {
  const external: string[] = [],
    loads: string[] = [];
  page.on("request", (request) => {
    if (request.url().startsWith("https://www.ipokergosu.com"))
      external.push(request.url());
    if (
      request.method() === "POST" &&
      /\/api\/pokergosu\/25\/media\//.test(request.url())
    )
      loads.push(request.url());
  });
  await page.goto("/pokergosu/25");
  await page.waitForFunction(
    () => document.documentElement.dataset.hydrated === "true",
  );
  await expect(page.getByText(/^합성 본문 사진/)).toBeVisible();
  expect(loads).toHaveLength(0);
  expect(external).toHaveLength(0);
  await page
    .getByRole("button", { name: "이미지 불러오기", exact: true })
    .click();
  const photo = page.getByRole("img", { name: "합성 본문 사진", exact: true });
  await expect(photo).toBeVisible();
  await expect
    .poll(() =>
      photo.evaluate((element: HTMLImageElement) => element.naturalWidth),
    )
    .toBe(1);
  expect(loads).toHaveLength(1);
  expect(external).toHaveLength(0);
  await page.reload();
  await page.waitForFunction(
    () => document.documentElement.dataset.hydrated === "true",
  );
  await expect(photo).toBeVisible();
  expect(loads).toHaveLength(1);
  expect(external).toHaveLength(0);
});
