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
  await page.getByLabel("대화·반응 메뉴", { exact: true }).click();
  await page.getByRole("link", { name: "분류 검토", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "분류 검토", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "분류 수정", exact: true }).first(),
  ).toBeVisible({ timeout: 20000 });
  const stale =
    (await page
      .getByRole("row")
      .filter({
        has: page.getByRole("button", { name: "분류 수정", exact: true }),
      })
      .first()
      .getByText("맥락 변경 · 재검토 필요", { exact: true })
      .count()) > 0;
  await page
    .getByRole("button", { name: "분류 수정", exact: true })
    .first()
    .click();
  await expect(page.getByRole("dialog")).toBeVisible();
  if (stale)
    await expect(
      page.getByRole("button", { name: "수정 저장", exact: true }),
    ).toBeEnabled();
  else
    await expect(
      page.getByRole("button", { name: "수정 저장", exact: true }),
    ).toBeDisabled();
  await page.getByLabel("분류 메모").fill("SYNTHETIC-EDIT-NOT-SAVED");
  await expect(
    page.getByRole("button", { name: "수정 저장", exact: true }),
  ).toBeEnabled();
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

test("restored management pages reuse SSR and submit settings only to a synthetic intercepted action", async ({
  page,
}) => {
  let calls = 0;
  page.on("request", (r) => {
    if (new URL(r.url()).pathname.startsWith("/api/")) calls++;
  });
  await page.goto("/keywords");
  await page.waitForFunction(
    () => document.documentElement.dataset.hydrated === "true",
  );
  expect(calls).toBe(0);
  const original = await page
    .getByLabel("제외 키워드 · 한 줄에 하나")
    .inputValue();
  let submitted: Record<string, unknown> | undefined;
  await page.route("**/api/actions/keyword-settings", async (route) => {
    submitted = route.request().postDataJSON();
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ success: true, data: { ok: true }, error: null }),
    });
  });
  await page
    .getByLabel("제외 키워드 · 한 줄에 하나")
    .fill(`${original}\nSYNTHETIC-ONLY-NOT-SAVED`);
  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
  const saveButton = page.getByRole("button", {
    name: "변경 저장",
    exact: true,
  });
  await expect(saveButton).toBeInViewport();
  const buttonBox = await saveButton.boundingBox();
  expect(buttonBox?.y).toBeLessThan(180);
  await page.getByRole("button", { name: "변경 저장", exact: true }).click();
  await expect
    .poll(() => submitted?.exclude_keywords)
    .toContain("SYNTHETIC-ONLY-NOT-SAVED");
  await expect(
    page.getByRole("status").getByText("처리했습니다."),
  ).toBeVisible();
  expect(submitted?.keywords).toBeInstanceOf(Array);
  expect(submitted?.keyword_groups).toBeInstanceOf(Array);
});

test("all restored pages fit mobile and retain local-only boundaries", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  for (const path of [
    "/keywords",
    "/rooms",
    "/guide",
    "/messages",
    "/trends",
    "/campaigns",
    "/responses",
    "/briefing",
    "/bookmarks",
    "/aliases",
    "/operations",
  ]) {
    await page.goto(path);
    await page.waitForFunction(
      () => document.documentElement.dataset.hydrated === "true",
    );
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
      path,
    ).toBe(true);
  }
  await page.getByRole("combobox", { name: "페이지 이동" }).click();
  await page.getByRole("option", { name: "수집 대상", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "수집 대상", exact: true }).first(),
  ).toBeVisible({ timeout: 20000 });
});

test("guide settings preserve capture, response, references and analytics separation in an intercepted save", async ({
  page,
}) => {
  const guideList = (
    await (await page.request.get("/api/workspace/guide")).json()
  ).data;
  const room = guideList.guides.find(
    (guide: { room_id: string; enabled: boolean }) => guide.enabled,
  )?.room_id;
  test.skip(!room, "No configured guide room is available in this environment");
  const response = await page.request.get(`/api/workspace/guide?room=${room}`);
  const original = (await response.json()).data.guides.find(
    (g: { room_id: string }) => g.room_id === room,
  );
  let submitted: Record<string, unknown> | undefined;
  await page.route("**/api/actions/guide-settings", async (route) => {
    submitted = route.request().postDataJSON();
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ success: true, data: { ok: true }, error: null }),
    });
  });
  await page.goto(`/guide?room=${room}`);
  await page.waitForFunction(
    () => document.documentElement.dataset.hydrated === "true",
  );
  await page
    .getByRole("button", { name: "가이드 설정 저장", exact: true })
    .click();
  await expect.poll(() => submitted?.room_id).toBe(room);
  expect(submitted?.enabled).toBe(original.enabled);
  expect(submitted?.respond).toBe(original.respond);
  expect(submitted?.keywords).toEqual(original.keywords);
  expect(submitted?.names).toEqual(original.names);
  expect(submitted?.references).toEqual(original.references);
  expect(submitted).not.toHaveProperty("excluded");
});

test("uncertain question delivery retains the original request across reload", async ({
  page,
}) => {
  const requests: Record<string, unknown>[] = [];
  await page.route("**/api/actions/campaign-send", async (route) => {
    requests.push(route.request().postDataJSON());
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        success: true,
        data: { state: "unknown", message: "SYNTHETIC uncertain delivery" },
        error: null,
      }),
    });
  });
  await page.goto("/campaigns");
  await page.waitForFunction(
    () => document.documentElement.dataset.hydrated === "true",
  );
  await page
    .getByRole("button", { name: "질문 직접 발송", exact: true })
    .click();
  await page
    .getByLabel("관찰 제목", { exact: true })
    .fill("SYNTHETIC-NOT-SENT");
  await page
    .getByLabel("질문 원문", { exact: true })
    .fill("SYNTHETIC-NOT-SENT");
  await page
    .getByRole("button", {
      name: "이 질문 발송·동일 요청 상태 확인",
      exact: true,
    })
    .click();
  await expect.poll(() => requests.length).toBe(1);
  await page.reload();
  await page.waitForFunction(
    () => document.documentElement.dataset.hydrated === "true",
  );
  await page
    .getByRole("button", { name: "질문 직접 발송", exact: true })
    .click();
  await expect(
    page.getByText("확인 중인 기존 요청:", { exact: false }),
  ).toBeVisible();
  await expect(page.getByLabel("질문 원문", { exact: true })).toBeDisabled();
  await page
    .getByRole("button", {
      name: "이 질문 발송·동일 요청 상태 확인",
      exact: true,
    })
    .click();
  await expect.poll(() => requests.length).toBe(2);
  expect(requests[1]).toEqual(requests[0]);
});

test("alias suggestions identify their target and require an explicit choice for ambiguous candidates", async ({
  page,
}) => {
  const groups = [
    { id: "lulu", name: "포커룰루" },
    { id: "apl", name: "APL" },
  ];
  const candidate = (
    token: string,
    group_id: string | null,
    method = "spelling",
  ) => ({
    token,
    group_id,
    group_name: groups.find((g) => g.id === group_id)?.name,
    method,
    reason: "SYNTHETIC spelling evidence",
    occurrences: 2,
    distinct_texts: 2,
    authors: 2,
    examples: [
      {
        room: "Synthetic room",
        log_id: token,
        time_ms: 1,
        text: "SYNTHETIC evidence only",
      },
    ],
  });
  await page.route("**/api/workspace/aliases*", (route) =>
    route.fulfill({
      json: {
        success: true,
        data: {
          candidates: [
            candidate("루룰", "lulu"),
            candidate("모호표현", null),
            candidate("함께표현", "lulu", "cooccurrence"),
          ],
          groups,
          decisions: [],
          days: 14,
          scanned: 10,
          promotion_messages_excluded: 3,
          total: 3,
          page: 1,
          pages: 1,
        },
        error: null,
      },
    }),
  );
  let submitted: Record<string, unknown> | undefined;
  await page.route("**/api/actions/alias-decision", (route) => {
    submitted = route.request().postDataJSON();
    return route.fulfill({
      json: { success: true, data: { ok: true }, error: null },
    });
  });
  await page.goto("/");
  await page.getByLabel("관리 메뉴", { exact: true }).click();
  await page.getByRole("link", { name: "새 별칭 후보", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "루룰 → 포커룰루", exact: true }),
  ).toBeVisible();
  await page.locator(".alias-related > summary").click();
  const ambiguous = page.locator(".section-card").filter({
    has: page.getByRole("heading", {
      name: "모호표현 → 대상 미정",
      exact: true,
    }),
  });
  const add = ambiguous.getByRole("button", {
    name: "선택한 대상의 별칭으로 추가",
    exact: true,
  });
  await expect(add).toBeDisabled();
  await ambiguous.getByRole("combobox").click();
  await page.getByRole("option", { name: "APL", exact: true }).click();
  await expect(add).toBeEnabled();
  await add.click();
  await expect.poll(() => submitted?.group_id).toBe("apl");
  expect(submitted?.token).toBe("모호표현");
  await expect(
    page.getByRole("heading", { name: "함께표현 → 포커룰루", exact: true }),
  ).toBeVisible();
  await page.locator(".alias-related > summary").click();
  await expect(
    page.getByRole("heading", { name: "함께표현 → 포커룰루", exact: true }),
  ).not.toBeVisible();
  await page.locator(".alias-related > summary").click();
  await expect(
    page.getByRole("heading", { name: "함께표현 → 포커룰루", exact: true }),
  ).toBeVisible();
});

test("context and review drill-down preserves its origin menu until an explicit menu selection", async ({
  page,
}) => {
  await page.goto("/reviews");
  const nav = page.getByRole("navigation", { name: "주 메뉴" });
  await expect(page.locator(".review-row").first()).toBeVisible({
    timeout: 20000,
  });
  await page.locator(".review-row").first().locator("td").first().click();
  await expect(
    page.getByRole("heading", { name: "대화 맥락", exact: true }),
  ).toBeVisible();
  await expect(
    nav.getByRole("link", { name: "분류 검토", exact: true }),
  ).toHaveClass(/active/);
  await expect(
    nav.getByRole("link", { name: "대화 목록", exact: true }),
  ).not.toHaveClass(/active/);
  const reviewedPath = new URL(page.url()).pathname;
  await page.reload();
  await expect(
    nav.getByRole("link", { name: "분류 검토", exact: true }),
  ).toHaveClass(/active/);
  await nav.getByRole("link", { name: "대화 목록", exact: true }).click();
  await page.goto(`${reviewedPath}?nav=%2Fconversations`);
  await expect(
    page.getByRole("heading", { name: "대화 맥락", exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "분류 수정", exact: true })
    .first()
    .click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "취소", exact: true })
    .click();
  await expect(
    nav.getByRole("link", { name: "대화 목록", exact: true }),
  ).toHaveClass(/active/);
  await expect(
    nav.getByRole("link", { name: "분류 검토", exact: true }),
  ).not.toHaveClass(/active/);
  await nav.getByRole("link", { name: "분류 검토", exact: true }).click();
  await expect(
    nav.getByRole("link", { name: "분류 검토", exact: true }),
  ).toHaveClass(/active/);
});

test("overview separates latest and confirmed reaction contexts with bounded stored excerpts", async ({
  page,
}) => {
  await page.goto("/");
  await expect(
    page.getByRole("heading", { name: "최신 대화", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "긍정 반응의 맥락", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "부정 반응의 맥락", exact: true }),
  ).toBeVisible();
  expect(await page.locator(".overview-excerpt").count()).toBeGreaterThan(0);
  await page.setViewportSize({ width: 390, height: 844 });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
});

test("classification can be edited directly in conversation context", async ({
  page,
}) => {
  await page.goto("/reviews");
  const link = page.locator(".review-context-link").first();
  await expect(link).toBeVisible({ timeout: 20000 });
  await link.click();
  const contextUrl = page.url();
  const button = page
    .getByRole("button", { name: "분류 수정", exact: true })
    .first();
  await expect(button).toBeEnabled({ timeout: 20000 });
  await button.click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  await dialog
    .getByRole("radio", { name: "긍정 호감·만족·추천", exact: true })
    .check();
  await dialog
    .getByLabel("분류 메모")
    .fill("Synthetic browser verification only");
  let saved: Record<string, unknown> | undefined;
  await page.route("**/api/classifications/correct", async (route) => {
    saved = route.request().postDataJSON();
    await route.fulfill({
      json: { success: true, data: { corrected: true }, error: null },
    });
  });
  await dialog.getByRole("button", { name: "수정 저장", exact: true }).click();
  await expect(dialog).not.toBeVisible({ timeout: 20000 });
  expect(page.url()).toBe(contextUrl);
  expect(saved?.id).toBe(new URL(contextUrl).pathname.split("/").at(-1));
  expect(saved?.verdict).toBe("positive");
  expect(saved?.expected).toBeTruthy();
  expect(saved?.request_id).toBeTruthy();
  expect(saved?.summary).toBe("Synthetic browser verification only");
});

test("design system catalog supports keyboard dialogs and mobile controls", async ({
  page,
}) => {
  const writes: string[] = [];
  page.on("request", (request) => {
    if (request.method() === "POST") writes.push(request.url());
  });
  await page.goto("/design-system");
  await expect(
    page.getByRole("heading", { name: "디자인 시스템", exact: true }),
  ).toBeVisible();
  const trigger = page.getByRole("button", { name: "예제 수정 창 열기" });
  await trigger.click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await page
    .getByRole("dialog")
    .getByLabel("메모", { exact: true })
    .fill("Synthetic note");
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).not.toBeVisible();
  await expect(trigger).toBeFocused();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole("radio", { name: "긍정", exact: true }).check();
  await expect(
    page.getByRole("radio", { name: "긍정", exact: true }),
  ).toBeChecked();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  expect(writes).toEqual([]);
});

test("conversation reader keeps expansion at its boundaries and secondary tools out of the reading column", async ({
  page,
}) => {
  await page.goto("/reviews");
  await expect(page.locator(".review-context-link").first()).toBeVisible({
    timeout: 20000,
  });
  await page.locator(".review-context-link").first().click();
  const reader = page.locator(".detail-content");
  const before = reader.getByRole("button", {
    name: "이전 대화 더 불러오기",
    exact: true,
  });
  const after = reader.getByRole("button", {
    name: "이후 대화 더 불러오기",
    exact: true,
  });
  await expect(before).toBeVisible();
  expect(
    await reader
      .locator(".context-expand")
      .first()
      .evaluate((element) => {
        const message = element.parentElement?.querySelector(".message");
        return Boolean(
          message &&
            element.compareDocumentPosition(message) &
              Node.DOCUMENT_POSITION_FOLLOWING,
        );
      }),
  ).toBe(true);
  expect(
    await reader
      .locator(".context-expand")
      .last()
      .evaluate((element) => {
        const message = element.parentElement?.querySelector(".message");
        return Boolean(
          message &&
            element.compareDocumentPosition(message) &
              Node.DOCUMENT_POSITION_PRECEDING,
        );
      }),
  ).toBe(true);
  const requests: Record<string, unknown>[] = [];
  await page.route("**/api/actions/context-expand", async (route) => {
    requests.push(route.request().postDataJSON());
    await route.fulfill({
      json: {
        success: true,
        data: { added_before: 15, added_after: 15, complete: true },
        error: null,
      },
    });
  });
  await before.click();
  await expect(
    reader
      .locator(".context-expand")
      .first()
      .getByText("15개 추가", { exact: false }),
  ).toBeVisible();
  await after.click();
  await expect(
    reader
      .locator(".context-expand")
      .last()
      .getByText("15개 추가", { exact: false }),
  ).toBeVisible();
  expect(
    requests.map(({ direction, conversation, minutes }) => ({
      direction,
      conversation,
      minutes,
    })),
  ).toEqual([
    { direction: "before", conversation: true, minutes: 30 },
    { direction: "after", conversation: true, minutes: 15 },
  ]);
  const tools = page.locator(".detail-aside");
  const disclosure = tools
    .locator("details")
    .filter({ has: page.locator("summary", { hasText: "보관·담당자·메모" }) });
  await expect(disclosure).not.toHaveAttribute("open", "");
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole("link", { name: "반응·분류", exact: true }).click();
  await expect(
    tools.getByRole("heading", { name: "대상별 반응" }),
  ).toBeInViewport();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
});
