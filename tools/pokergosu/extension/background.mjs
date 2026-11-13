import { CONTROL_ALARM, createControl, SITE_PERMISSION } from "./control.mjs";
import { extractDocument } from "./extractor.mjs";
import { createMonitor, MONITOR_ALARM } from "./monitor.mjs";
import { createTrial, TRIAL_ALARM } from "./trial.mjs";

const messages = {
  OUTSIDE_FREE_BOARD: "포커고수 자유 게시판이나 글을 직접 연 뒤 눌러주세요.",
  BOT_CHALLENGE:
    "봇·사람 여부를 확인하는 보안 화면입니다. 자동 수집을 멈추고 기록합니다.",
  ACCESS_DENIED:
    "접근 거부 화면이 표시됐습니다. 계정 밴 여부는 확정할 수 없습니다.",
  RATE_LIMITED: "요청 제한 화면이 표시됐습니다. 자동 수집을 멈추고 기록합니다.",
  ACCOUNT_RESTRICTION_NOTICE:
    "계정 제한 안내가 표시됐습니다. 안내 근거를 기록합니다.",
  ACCESS_RESTRICTED: "보안 확인 화면입니다. 직접 확인한 뒤 다시 눌러주세요.",
  BOARD_MARKUP_UNKNOWN:
    "목록 구조를 확인해야 합니다. 구조 진단을 로컬에 저장했습니다.",
  THREAD_MARKUP_UNKNOWN:
    "본문 구조를 확인해야 합니다. 구조 진단을 로컬에 저장했습니다.",
  COMMENT_ID_OR_TEXT_UNKNOWN:
    "댓글 구조를 확인해야 합니다. 구조 진단을 로컬에 저장했습니다.",
  COMMENT_COVERAGE_UNKNOWN:
    "댓글 일부가 접혀 있거나 구조 확인이 필요합니다. 진단을 저장했습니다.",
};
let busy = false;

async function local(path, body) {
  const config = await (
    await fetch(chrome.runtime.getURL("connection.json"))
  ).json();
  if (
    config.endpoint !== "http://127.0.0.1:8791" ||
    typeof config.token !== "string"
  )
    throw new Error("CONNECTION_CONFIG");
  const response = await fetch(config.endpoint + path, {
    method: body ? "POST" : "GET",
    headers: {
      Authorization: `Bearer ${config.token}`,
      "Content-Type": "application/json",
      "X-Mention-Extension": chrome.runtime.id,
    },
    body: body ? JSON.stringify(body) : undefined,
    credentials: "omit",
    redirect: "error",
    signal: AbortSignal.timeout(15000),
  });
  if (!response.ok) throw new Error(`LOCAL_${response.status}`);
  return response.json();
}

async function show(text, badge, tabId) {
  const target = Number.isInteger(tabId) ? { tabId } : {};
  await chrome.action.setBadgeText({ ...target, text: badge });
  await chrome.action.setTitle({ ...target, title: text });
  await chrome.storage.local.set({ lastResult: { text, at: Date.now() } });
}

// This function is serialized into an isolated world. It collects structure only,
// never input values, scripts, storage, cookies or full HTML.
export function inspectStructure() {
  return {
    url:
      location.pathname === "/free/search"
        ? location.href
        : `${location.origin}${location.pathname}`,
    headings: [...document.querySelectorAll("h1,h2")]
      .slice(0, 12)
      .map((e) => (e.textContent || "").slice(0, 160)),
    nodes: [
      ...document.querySelectorAll(
        "main,article,section,div,ul,li,table,tr,time",
      ),
    ]
      .filter((e) => e.id || e.className || e.tagName === "TIME")
      .slice(0, 350)
      .map((e) => ({
        tag: e.tagName,
        id: e.id.slice(0, 160),
        classes: String(e.className).slice(0, 240),
        parent: e.parentElement?.tagName || "",
        chars: e.textContent?.length || 0,
      })),
  };
}

export async function capture(tab) {
  if (busy) return { ok: false, reason: "BUSY" };
  busy = true;
  try {
    let url;
    try {
      url = new URL(tab?.url);
    } catch {
      throw new Error("OUTSIDE_FREE_BOARD");
    }
    if (
      url.origin !== "https://www.pokergosu.com" ||
      !/^\/free(?:\/[1-9][0-9]*|\/search)?\/?$/.test(url.pathname) ||
      !Number.isInteger(tab.id)
    )
      throw new Error("OUTSIDE_FREE_BOARD");
    // Check the local receiver before extracting public content. There is no
    // website fetch, reload, navigation or content-script message listener.
    await local("/status");
    const operation = /^\/free(?:\/search)?\/?$/.test(url.pathname)
      ? "list"
      : "thread";
    const [injection] = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: extractDocument,
      args: [operation],
    });
    const result = injection?.result;
    if (!result) throw new Error("PAGE_NOT_READY");
    if (result.paused) {
      if (
        !result.access &&
        !["ACCESS_RESTRICTED", "OUTSIDE_FREE_BOARD"].includes(result.paused)
      ) {
        const [structure] = await chrome.scripting.executeScript({
          target: { tabId: tab.id },
          func: inspectStructure,
        });
        await local("/capture", {
          operation: "diagnostic",
          page_url:
            url.pathname === "/free/search"
              ? url.href
              : `${url.origin}${url.pathname}`,
          reason: result.paused,
          structure: structure.result,
        });
      }
      await show(
        messages[result.paused] || "페이지 구조 확인이 필요합니다.",
        "!",
        tab.id,
      );
      return { ok: false, reason: result.paused, access: result.access };
    }
    const saved = await local("/capture", {
      operation,
      page_url:
        url.pathname === "/free/search"
          ? url.href
          : `${url.origin}${url.pathname}`,
      data: result.data,
    });
    const text =
      operation === "list"
        ? `목록 ${saved.discovered}개 저장. 읽을 글을 직접 열고 다시 눌러주세요.`
        : `글 저장 · 댓글 ${saved.comments}개(이미지 ${saved.comment_summary?.media_only || 0}개) · 건너뜀 ${saved.comment_summary?.skipped || 0}개 · 포함 키워드 ${saved.eligible ? "발견" : "없음"}.`;
    await show(
      text,
      operation === "list" ? "목록" : saved.eligible ? "발견" : "저장",
      tab.id,
    );
    return { ok: true, operation, saved, data: result.data };
  } catch (error) {
    const text =
      messages[error.message] ||
      "로컬 수집기에 연결하거나 페이지를 읽지 못했습니다. 확장 연결 상태를 확인해주세요.";
    await show(text, "!", tab?.id);
    return { ok: false, reason: error.message || "CAPTURE_FAILED" };
  } finally {
    busy = false;
  }
}

export const trial = createTrial({ chrome, local, capture, show });
export const monitor = createMonitor({ chrome, local, capture, show });
export const control = createControl({ chrome, local, monitor, show });
let operations = Promise.resolve();
const enqueue = (work) => {
  operations = operations
    .then(work)
    .catch(() => show("로컬 제어 작업을 완료하지 못했습니다.", "!"));
  return operations;
};
const trialReady = Promise.all([trial.restore(), monitor.restore()]);
void trialReady.then(() => enqueue(() => control.restore()));
chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === CONTROL_ALARM)
    void trialReady.then(() => enqueue(() => control.poll()));
  if (alarm.name === TRIAL_ALARM)
    void trialReady.then(() => enqueue(() => trial.tick()));
  if (alarm.name === MONITOR_ALARM)
    void trialReady.then(() => enqueue(() => monitor.tick()));
});
chrome.runtime.onStartup.addListener(() => {
  void trialReady;
});

chrome.action.onClicked.addListener((tab) => {
  void enqueue(() => capture(tab));
});
chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create({
      id: "capture",
      title: "현재 글·댓글 저장",
      contexts: ["action"],
    });
    for (const [id, title] of [
      ["monitor-start", "자동 수집 시작 (이 탭)"],
      ["monitor-status", "자동 수집 상태 확인"],
      ["monitor-stop", "자동 수집 중지"],
    ])
      chrome.contextMenus.create({ id, title, contexts: ["action"] });
    chrome.contextMenus.create({
      id: "trial",
      title: "15회 시험",
      contexts: ["action"],
    });
    for (const [id, title] of [
      ["trial-start", "이 탭에서 시험 시작"],
      ["trial-status", "시험 상태 확인"],
      ["trial-stop", "시험 중지"],
    ]) {
      chrome.contextMenus.create({
        id,
        title,
        parentId: "trial",
        contexts: ["action"],
      });
    }
    chrome.contextMenus.create({
      id: "control-settings",
      title: "설정·로컬 제어",
      contexts: ["action"],
    });
    for (const [id, title] of [
      ["control-grant", "로컬 제어 연결 (사이트 권한 허용)"],
      ["status", "로컬 연결 확인"],
      ["control-disable", "로컬 제어 해제"],
    ])
      chrome.contextMenus.create({
        id,
        title,
        parentId: "control-settings",
        contexts: ["action"],
      });
  });
});
chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId === "control-grant") {
    const permission = chrome.permissions.request(SITE_PERMISSION);
    void permission.then((granted) =>
      trialReady.then(() => enqueue(() => control.grant(granted))),
    );
  }
  if (info.menuItemId === "control-disable")
    void trialReady.then(() => enqueue(() => control.disable()));
  if (info.menuItemId === "monitor-start")
    void trialReady.then(() => enqueue(() => monitor.start(tab)));
  if (info.menuItemId === "monitor-stop") {
    const intent = chrome.storage.local.set({
      lastManualStopRequestedAt: Date.now(),
    });
    void intent.then(() =>
      trialReady.then(() => enqueue(() => monitor.stop())),
    );
  }
  if (info.menuItemId === "monitor-status")
    void trialReady.then(() => enqueue(() => monitor.status()));
  if (info.menuItemId === "trial-start")
    void trialReady.then(() =>
      enqueue(async () => {
        const state = (await chrome.storage.local.get("monitor")).monitor;
        if (state?.status === "running")
          await show("자동 수집을 먼저 중지해주세요.", "!", tab?.id);
        else await trial.start(tab);
      }),
    );
  if (info.menuItemId === "trial-stop")
    void trialReady.then(() => enqueue(() => trial.stop()));
  if (info.menuItemId === "trial-status")
    void trialReady.then(() => enqueue(() => trial.status()));
  if (info.menuItemId === "capture") void capture(tab);
  if (info.menuItemId === "status") {
    void local("/status")
      .then((value) =>
        show(
          `연결됨 · 저장 ${value.threads}개 · 관심 글 ${value.matched}개`,
          "연결",
          tab?.id,
        ),
      )
      .catch(() =>
        show(
          "로컬 수집기가 꺼져 있습니다. extension-start 명령을 실행해주세요.",
          "!",
          tab?.id,
        ),
      );
  }
});
