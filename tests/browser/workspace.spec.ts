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
  ).toBeVisible();
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
  await page.getByRole("button", { name: "변경 저장", exact: true }).click();
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
