import { expect, test } from "@playwright/test";

test("SSR contains data without JavaScript", async ({ browser, baseURL }) => {
  const context = await browser.newContext({
    javaScriptEnabled: false,
    baseURL,
  });
  const page = await context.newPage();
  await page.goto("/");
  await expect(
    page.getByRole("heading", { name: "카톡 여론", exact: true }),
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
  const classification = page.getByRole("combobox", { name: / 분류$/ }).first();
  await expect(classification).toBeVisible({ timeout: 20000 });
  await classification.click();
  await expect(
    page.getByRole("option", { name: "긍정", exact: true }),
  ).toBeVisible();
  await page.keyboard.press("Escape");
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
    await page.getByRole("link", { name: "카톡 여론", exact: true }).click();
    await expect(
      page.getByRole("heading", { name: "카톡 여론", exact: true }),
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
    .getByRole("combobox", { name: / 분류$/ })
    .first()
    .click();
  await expect(
    page.getByRole("option", { name: "긍정", exact: true }),
  ).toBeVisible();
  await page.keyboard.press("Escape");
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

test("classification is selected in place and memo is a separate optional action", async ({
  page,
}) => {
  await page.goto("/reviews");
  const link = page.locator(".review-context-link").first();
  await expect(link).toBeVisible({ timeout: 20000 });
  const href = await link.getAttribute("href");
  const id = new URL(href || "", "http://localhost").pathname.split("/").at(-1);
  let label = "neutral",
    summary = "Synthetic existing summary";
  const writes: Record<string, unknown>[] = [];
  await page.route("**/api/conversations/*/classifications", async (route) =>
    route.fulfill({
      json: {
        success: true,
        data: [
          {
            id: `${id}:APL`,
            conversationId: id,
            target: "APL",
            label,
            summary,
            origin: "human",
            stale: false,
            expected: "synthetic-conflict-token",
            room: "Synthetic",
            at: 1,
            history: [],
          },
        ],
        error: null,
      },
    }),
  );
  await page.route("**/api/classifications/correct", async (route) => {
    const data = route.request().postDataJSON();
    writes.push(data);
    label = data.verdict;
    summary = data.summary;
    await route.fulfill({
      json: { success: true, data: { corrected: true }, error: null },
    });
  });
  await link.click();
  const contextUrl = page.url();
  const choice = page.getByRole("combobox", { name: "APL 분류", exact: true });
  await expect(choice).toBeVisible();
  await choice.click();
  await page.getByRole("option", { name: "긍정", exact: true }).click();
  await expect(choice).toContainText("긍정");
  expect(writes[0]).toMatchObject({
    id,
    verdict: "positive",
    summary: "Synthetic existing summary",
    expected: "synthetic-conflict-token",
  });
  expect(page.url()).toBe(contextUrl);
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await page.getByRole("button", { name: "메모", exact: true }).first().click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole("combobox")).toHaveCount(0);
  await dialog.getByLabel("분류 메모").fill("Synthetic optional note");
  await dialog.getByRole("button", { name: "메모 저장", exact: true }).click();
  await expect(dialog).not.toBeVisible();
  expect(writes[1]).toMatchObject({
    id,
    verdict: "positive",
    summary: "Synthetic optional note",
  });
  expect(writes[1].request_id).not.toBe(writes[0].request_id);
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
  let afterReads = 0;
  await page.route("**/api/actions/context-expand", async (route) => {
    requests.push(route.request().postDataJSON());
    await route.fulfill({
      json: {
        success: true,
        data: {
          added_before: 15,
          added_after: 15,
          complete: true,
          stop_reason:
            requests.at(-1)?.direction === "before"
              ? "time_window_reached"
              : ++afterReads === 1
                ? "waiting_for_messages"
                : "history_start",
        },
        error: null,
      },
    });
  });
  await before.click();
  await expect(before).toHaveCount(0);
  await expect(
    reader.getByText("이전 대화 조회 완료", { exact: true }),
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
  await expect(after).toBeVisible();
  await after.click();
  await expect(after).toHaveCount(0);
  await expect(
    reader.getByText("이후 대화 조회 완료", { exact: true }),
  ).toBeVisible();
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

test("room selection offers only the opposite move in its panel and preserves selection after failure", async ({
  page,
}) => {
  await page.goto("/");
  let included = [
    { id: "101", name: "Synthetic included A" },
    { id: "102", name: "Synthetic included B" },
  ];
  let excluded = [{ id: "103", name: "Synthetic excluded" }];
  const payloads: Record<string, unknown>[] = [];
  let fail = false;
  await page.route("**/api/workspace/rooms*", async (route) =>
    route.fulfill({
      json: {
        success: true,
        data: {
          included: {
            rooms: included,
            total: included.length,
            page: 1,
            pages: 1,
          },
          excluded: {
            rooms: excluded,
            total: excluded.length,
            page: 1,
            pages: 1,
          },
        },
        error: null,
      },
    }),
  );
  await page.route("**/api/actions/room-settings", async (route) => {
    const input = route.request().postDataJSON();
    payloads.push(input);
    if (fail)
      return route.fulfill({
        status: 500,
        json: { success: false, error: { message: "Synthetic save failure" } },
      });
    const ids = input.room_ids as string[];
    if (input.excluded) {
      excluded = [...excluded, ...included.filter((r) => ids.includes(r.id))];
      included = included.filter((r) => !ids.includes(r.id));
    } else {
      included = [...included, ...excluded.filter((r) => ids.includes(r.id))];
      excluded = excluded.filter((r) => !ids.includes(r.id));
    }
    await route.fulfill({
      json: { success: true, data: { ok: true }, error: null },
    });
  });
  await page.getByLabel("관리 메뉴", { exact: true }).click();
  await page.getByRole("link", { name: "수집 대상", exact: true }).click();
  const active = page.getByRole("region", { name: "분석 포함", exact: true });
  const inactive = page.getByRole("region", { name: "분석 제외", exact: true });
  await expect(page.getByLabel("집계 날짜")).toHaveCount(0);
  await expect(active.getByRole("button", { name: /제외로 이동/ })).toHaveCount(
    0,
  );
  await active
    .getByRole("checkbox", { name: "Synthetic included A 선택", exact: true })
    .check();
  const move = active.getByRole("button", {
    name: "제외로 이동 · 1",
    exact: true,
  });
  await expect(move).toBeVisible();
  await expect(
    active.getByRole("button", { name: /포함으로 이동/ }),
  ).toHaveCount(0);
  await move.click();
  await expect(
    inactive.getByRole("checkbox", {
      name: "Synthetic included A 선택",
      exact: true,
    }),
  ).toBeVisible();
  expect(payloads[0]).toEqual({ room_ids: ["101"], excluded: true });
  await inactive
    .getByRole("checkbox", { name: "Synthetic included A 선택", exact: true })
    .check();
  await inactive
    .getByRole("button", { name: "포함으로 이동 · 1", exact: true })
    .click();
  await expect(
    active.getByRole("checkbox", {
      name: "Synthetic included A 선택",
      exact: true,
    }),
  ).toBeVisible();
  expect(payloads[1]).toEqual({ room_ids: ["101"], excluded: false });
  fail = true;
  await active
    .getByRole("checkbox", { name: "Synthetic included B 선택", exact: true })
    .check();
  await active.getByRole("button", { name: /제외로 이동/ }).click();
  await expect(
    page.getByText("Synthetic save failure", { exact: true }),
  ).toBeVisible();
  await expect(
    active.getByRole("checkbox", {
      name: "Synthetic included B 선택",
      exact: true,
    }),
  ).toBeChecked();
  await page.setViewportSize({ width: 390, height: 844 });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
});

test("conversation list classifies in place and exposes pending status as a filter", async ({
  page,
}) => {
  let optionsRequests = 0;
  const writes: Record<string, unknown>[] = [];
  page.on("request", (request) => {
    if (/\/api\/conversations\/[^/]+\/classifications/.test(request.url()))
      optionsRequests++;
  });
  await page.route("**/api/classifications/correct", async (route) => {
    writes.push(route.request().postDataJSON());
    await route.fulfill({
      json: { success: true, data: { ok: true }, error: null },
    });
  });
  await page.goto("/conversations?status=unclassified&target=APL");
  const choice = page
    .getByRole("combobox", { name: "APL 분류", exact: true })
    .first();
  await expect(choice).toBeVisible({ timeout: 20000 });
  const url = page.url();
  await choice.click();
  await page.getByRole("option", { name: "중립", exact: true }).click();
  await expect.poll(() => writes.length).toBe(1);
  expect(writes[0]).toMatchObject({ service: "APL", verdict: "neutral" });
  expect(writes[0].expected).toBeTruthy();
  expect(page.url()).toBe(url);
  expect(optionsRequests).toBe(0);
  const filter = page.getByRole("combobox", { name: "분류 상태", exact: true });
  await filter.click();
  await page
    .getByRole("option", { name: "미분류 / 재검토", exact: true })
    .click();
  await expect(page).toHaveURL(/status=pending/);
  await expect(
    page
      .getByRole("navigation", { name: "주 메뉴" })
      .getByRole("link", { name: "중요 대화", exact: true }),
  ).toHaveCount(0);
});

test("reaction comparison defaults to dashboard observations and external history is an explicit source filter", async ({
  page,
}) => {
  await page.goto("/responses");
  await page.waitForFunction(
    () => document.documentElement.dataset.hydrated === "true",
  );
  const source = page.getByRole("combobox", { name: "관찰 출처", exact: true });
  await expect(source).toContainText("대시보드 관찰");
  await source.click();
  await page
    .getByRole("option", { name: "외부 자동 관찰", exact: true })
    .click();
  await expect(page).toHaveURL(/source=external/);
  await expect(source).toContainText("외부 자동 관찰");
  await expect(
    page.getByText("예약 알림 daily-quiz", { exact: false }).first(),
  ).toBeVisible();
});

test("judgment exclusion is a direct classification and a separate state filter", async ({
  page,
}) => {
  const writes: Record<string, unknown>[] = [];
  await page.route("**/api/classifications/correct", async (route) => {
    writes.push(route.request().postDataJSON());
    await route.fulfill({
      json: { success: true, data: { saved: true }, error: null },
    });
  });
  await page.goto("/conversations?status=unclassified&target=APL");
  const choice = page
    .getByRole("combobox", { name: "APL 분류", exact: true })
    .first();
  await expect(choice).toBeVisible({ timeout: 20000 });
  await choice.click();
  await page.getByRole("option", { name: "판단 제외", exact: true }).click();
  await expect.poll(() => writes[0]?.verdict).toBe("excluded");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await page.getByRole("combobox", { name: "분류 상태", exact: true }).click();
  await page.getByRole("option", { name: "판단 제외", exact: true }).click();
  await expect(page).toHaveURL(/status=excluded/);
});

test("keyword rule editors have equal dimensions and folded group edits preserve all group types", async ({
  page,
}) => {
  await page.goto("/keywords");
  await page.waitForFunction(
    () => document.documentElement.dataset.hydrated === "true",
  );
  const include = page.getByLabel("포함 키워드 · 한 줄에 하나"),
    exclude = page.getByLabel("제외 키워드 · 한 줄에 하나");
  const a = await include.boundingBox(),
    b = await exclude.boundingBox();
  expect(a?.height).toBe(b?.height);
  expect(a?.width).toBe(b?.width);
  const groups = page.locator(".keyword-group-list .ds-preview-disclosure");
  expect(await groups.count()).toBeGreaterThan(0);
  await expect(groups.first()).not.toHaveAttribute("open", "");
  await groups.first().locator("summary").click();
  await groups
    .first()
    .getByLabel("대상 이름", { exact: true })
    .fill("Synthetic renamed target");
  let submitted: Record<string, unknown> | undefined;
  await page.route("**/api/actions/keyword-settings", async (route) => {
    submitted = route.request().postDataJSON();
    await route.fulfill({
      json: { success: true, data: { ok: true }, error: null },
    });
  });
  await page.getByRole("button", { name: "변경 저장", exact: true }).click();
  await expect.poll(() => submitted?.keyword_groups).toBeTruthy();
  const saved = submitted?.keyword_groups as {
    name: string;
    kind: string;
    keywords: string[];
  }[];
  expect(saved[0].name).toBe("Synthetic renamed target");
  expect(
    saved.every((group) =>
      ["service", "person", "event", "other"].includes(group.kind),
    ),
  ).toBe(true);
  await page.setViewportSize({ width: 390, height: 844 });
  const c = await include.boundingBox(),
    d = await exclude.boundingBox();
  expect(c?.height).toBe(d?.height);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
});

test("keyword rebuild status distinguishes committed settings from processing failure", async ({
  page,
}) => {
  let state = "running";
  await page.route("**/api/workspace/keywordProcessing", (route) =>
    route.fulfill({
      json: { data: { supported: true, revision: 1, state } },
    }),
  );
  await page.goto("/keywords", { waitUntil: "domcontentloaded" });
  await expect(
    page.getByText("설정 저장 완료 · 기존 데이터와 CSV 갱신 중"),
  ).toBeVisible();
  await page.screenshot({
    path: "runtime/keyword-processing-desktop.png",
    fullPage: true,
  });
  state = "failed";
  await expect(
    page.getByText(
      "설정은 저장됐지만 기존 데이터 갱신에 실패했습니다. 다시 저장하면 재시도합니다.",
    ),
  ).toBeVisible();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({
    path: "runtime/keyword-processing-mobile.png",
    fullPage: true,
  });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
});
