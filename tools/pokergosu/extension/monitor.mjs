/** One browser navigation per alarm; no long-lived service-worker loop. */
import { boardTab, reloadBoard } from "./trial.mjs";
export const MONITOR_ALARM = "mention-pokergosu-monitor";
const BOARD = "https://www.pokergosu.com/free";
const MAX_THREADS = 6;
const MAX_REQUESTS = 12;

// Korea uses UTC+9 year-round. The policy is independent of the Mac timezone.
export function afterQuietHours(stamp) {
  const shifted = new Date(stamp + 9 * 60 * 60 * 1000);
  const hour = shifted.getUTCHours();
  if (hour < 2 || hour >= 8) return stamp;
  shifted.setUTCHours(8, 0, 0, 0);
  return shifted.getTime() - 9 * 60 * 60 * 1000;
}

export function nextMonitorTime(start, finished, random = Math.random) {
  const candidate = start + (30 + 30 * random()) * 60 * 1000;
  return candidate > finished ? candidate : finished + 30 * 60 * 1000;
}

export function allowedMonitorUrl(value) {
  try {
    const url = new URL(value);
    return (
      url.origin === "https://www.pokergosu.com" &&
      !url.hash &&
      ((/^\/free\/?$/.test(url.pathname) &&
        (!url.search || /^\?page=[1-5]$/.test(url.search))) ||
        (/^\/free\/[1-9][0-9]{0,18}$/.test(url.pathname) && !url.search))
    );
  } catch {
    return false;
  }
}
function samePage(actual, expected) {
  try {
    return (
      new URL(actual).href.replace(/\/$/, "") ===
      new URL(expected).href.replace(/\/$/, "")
    );
  } catch {
    return false;
  }
}

export function createMonitor({
  chrome,
  local,
  capture,
  show,
  now = Date.now,
  random = Math.random,
  makeId = () => crypto.randomUUID(),
  navigate = (id, url) => reloadBoard(chrome, id, url),
  settle = () => new Promise((resolve) => setTimeout(resolve, 1500)),
}) {
  let processing = false,
    generation = 0;
  const get = async () => (await chrome.storage.local.get("monitor")).monitor;
  const active = (s) => s?.status === "running";
  const current = async (id) => {
    const s = await get();
    return s?.id === id && active(s) ? s : null;
  };
  const stepDelay = () => now() + (30 + 15 * random()) * 1000;
  async function display(s) {
    if (!s) return;
    const state = active(s)
      ? afterQuietHours(now()) > now()
        ? "새벽 휴식 (오전 8시 재개)"
        : s.phase === "rest"
          ? "대기"
          : "수집 중"
      : `중지 (${s.reason})`;
    const next = s.nextAt
      ? ` · 다음 ${new Date(s.nextAt).toLocaleTimeString("ko-KR", { timeZone: "Asia/Seoul" })}`
      : "";
    await show(
      `자동 수집 ${state} · 본문 ${s.threadsSaved}회 · 일치 ${s.matchedThreads}회 · 완료 ${s.cyclesCompleted}주기${next}`,
      active(s)
        ? afterQuietHours(now()) > now()
          ? "휴식"
          : s.phase === "rest"
            ? "대기"
            : "자동"
        : "중지",
      s.tabId,
    );
  }
  async function put(s) {
    await chrome.storage.local.set({ monitor: s });
  }
  async function record(s) {
    await local("/capture", { operation: "monitor", page_url: BOARD, data: s });
  }
  async function stop(reason = "USER_STOP", access) {
    generation++;
    await chrome.alarms.clear(MONITOR_ALARM);
    const s = await get();
    if (!active(s)) return;
    if (s.inFlight) {
      if (access) s.history.at(-1).access = access;
      Object.assign(s.history.at(-1), {
        outcome: reason === "WORKER_INTERRUPTED" ? "unknown" : "stopped",
        reason,
        finishedAt: now(),
      });
    }
    Object.assign(s, {
      status: reason === "USER_STOP" ? "stopped" : "paused",
      reason,
      inFlight: false,
      nextAt: null,
      finishedAt: now(),
    });
    await put(s);
    try {
      await record(s);
    } catch {
      /* The local extension retains the audit when the receiver is down. */
    }
    await display(s);
  }
  async function checkpoint(s) {
    await put(s);
    try {
      await record(s);
      return true;
    } catch {
      await stop("LOCAL_UNAVAILABLE");
      return false;
    }
  }
  async function arm(s) {
    const latest = await current(s.id);
    if (!latest) return;
    const nextAt = afterQuietHours(Math.max(now(), latest.nextAt));
    if (nextAt > Math.max(now(), latest.nextAt)) {
      latest.nextAt = nextAt;
      if (!(await checkpoint(latest))) return;
    }
    await chrome.alarms.create(MONITOR_ALARM, {
      when: Math.max(now() + 1000, latest.nextAt),
    });
    await display(latest);
  }
  function finishCycle(s) {
    s.schedulePolicy = 2;
    s.cyclesCompleted++;
    s.previousHeadIds = s.currentHeadIds;
    s.queue = [];
    s.index = 0;
    s.phase = "rest";
    s.page = 1;
    s.nextAt = nextMonitorTime(s.cycleStartedAt || now(), now(), random);
  }
  async function plan(s) {
    const result = await local("/plan");
    if (
      !Array.isArray(result.queue) ||
      result.queue.length > MAX_THREADS ||
      !Number.isSafeInteger(result.pending_threads) ||
      result.pending_threads < 0
    )
      throw new Error("INVALID_PLAN");
    const ids = new Set();
    for (const post of result.queue) {
      if (
        typeof post.id !== "string" ||
        !/^[1-9][0-9]{0,18}$/.test(post.id) ||
        post.url !== `${BOARD}/${post.id}` ||
        ids.has(post.id)
      )
        throw new Error("INVALID_PLAN");
      ids.add(post.id);
    }
    s.queue = result.queue;
    s.index = 0;
    s.pendingThreads = result.pending_threads;
    if (s.queue.length) {
      s.phase = "thread";
      s.nextAt = stepDelay();
    } else if (samePage(s.expectedUrl, BOARD)) finishCycle(s);
    else {
      s.phase = "return";
      s.nextAt = stepDelay();
    }
  }
  async function acceptList(s, result) {
    if (!Array.isArray(result.data) || !result.data.length)
      throw new Error("BOARD_MARKUP_UNKNOWN");
    const ids = result.data.filter((p) => !p.pinned).map((p) => p.id);
    if (!ids.length) throw new Error("BOARD_NO_REGULAR_POSTS");
    if (s.page === 1) {
      s.currentHeadIds = ids;
      s.discoveryOverlap = false;
    }
    s.discoveryOverlap =
      Boolean(s.discoveryOverlap) ||
      ids.some((id) => s.previousHeadIds.includes(id));
    // Stop when the previous discovery boundary is reached; never exceed five pages.
    if (!s.discoveryOverlap && s.page < 5) {
      s.page++;
      s.phase = "board";
      s.nextAt = stepDelay();
      return;
    }
    if (s.previousHeadIds.length && !s.discoveryOverlap) {
      s.discoveryGaps++;
      s.lastGapAt = now();
    }
    await plan(s);
  }
  async function start(tab) {
    if (afterQuietHours(now()) > now()) {
      await show(
        "새벽 2시~오전 8시는 수집 휴식 시간입니다. 오전 8시 이후 시작해주세요.",
        "휴식",
        tab?.id,
      );
      return;
    }
    if (processing || active(await get())) {
      await display(await get());
      return;
    }
    const { trial } = await chrome.storage.local.get("trial");
    if (trial?.status === "running") {
      await show("15회 시험을 먼저 중지해주세요.", "!", tab?.id);
      return;
    }
    if (!boardTab(tab)) {
      await show(
        "자유 게시판 첫 목록에서 자동 수집 시작을 눌러주세요.",
        "!",
        tab?.id,
      );
      return;
    }
    processing = true;
    const ticket = ++generation;
    try {
      const baseline = await capture(tab);
      if (
        !baseline?.ok ||
        baseline.operation !== "list" ||
        ticket !== generation
      )
        return;
      const s = {
        id: makeId(),
        status: "running",
        tabId: tab.id,
        expectedUrl: tab.url,
        startedAt: now(),
        finishedAt: null,
        reason: null,
        phase: "board",
        page: 1,
        cycle: 1,
        cyclesCompleted: 0,
        schedulePolicy: 2,
        cycleStartedAt: now(),
        cycleRequests: 0,
        navigations: 0,
        threadsSaved: 0,
        matchedThreads: 0,
        metadataWarnings: 0,
        pendingThreads: 0,
        discoveryGaps: 0,
        lastGapAt: null,
        previousHeadIds: (baseline.data || [])
          .filter((p) => !p.pinned)
          .map((p) => p.id),
        currentHeadIds: [],
        queue: [],
        index: 0,
        inFlight: false,
        nextAt: stepDelay(),
        history: [],
      };
      // The loaded list can be old: refresh it before choosing thread work.
      if (ticket !== generation) return;
      if (await checkpoint(s)) await arm(s);
    } catch (error) {
      await show(
        `자동 수집을 시작하지 못했습니다 (${error.message}).`,
        "!",
        tab?.id,
      );
    } finally {
      processing = false;
    }
  }
  async function tick() {
    if (processing) return;
    processing = true;
    try {
      let s = await get();
      if (!active(s)) {
        await chrome.alarms.clear(MONITOR_ALARM);
        return;
      }
      if (s.inFlight) {
        await stop("WORKER_INTERRUPTED");
        return;
      }
      if (afterQuietHours(now()) > now() || now() < s.nextAt) {
        await arm(s);
        return;
      }
      let tab;
      try {
        tab = await chrome.tabs.get(s.tabId);
      } catch {
        await stop("TAB_CLOSED");
        return;
      }
      if (!samePage(tab.url, s.expectedUrl)) {
        await stop("TAB_CHANGED_OR_PERMISSION_LOST");
        return;
      }
      try {
        await local("/status");
      } catch {
        await stop("LOCAL_UNAVAILABLE");
        return;
      }
      s = await current(s.id);
      if (!s) return;
      if (s.phase === "rest") {
        s.phase = "board";
        s.page = 1;
        s.cycle++;
        s.cycleRequests = 0;
        s.cycleStartedAt = now();
        s.currentHeadIds = [];
      }
      if (s.cycleRequests >= MAX_REQUESTS) {
        await stop("CYCLE_REQUEST_LIMIT");
        return;
      }
      const target =
        s.phase === "thread"
          ? s.queue[s.index]?.url
          : s.phase === "board" && s.page > 1
            ? `${BOARD}?page=${s.page}`
            : BOARD;
      if (!allowedMonitorUrl(target)) {
        await stop("INVALID_TARGET");
        return;
      }
      // Recheck after asynchronous local work before issuing any site navigation.
      if (afterQuietHours(now()) > now()) {
        await arm(s);
        return;
      }
      s.navigations++;
      s.cycleRequests++;
      s.inFlight = true;
      s.nextAt = null;
      s.history.push({
        sequence: s.navigations,
        cycle: s.cycle,
        url: target,
        startedAt: now(),
        finishedAt: null,
        outcome: "inflight",
        reason: null,
      });
      s.history = s.history.slice(-50);
      if (!(await checkpoint(s)) || !(await current(s.id))) return;
      const id = s.id;
      let result;
      try {
        await navigate(s.tabId, target);
        await settle();
        if (!(await current(id))) return;
        tab = await chrome.tabs.get(s.tabId);
        if (!samePage(tab.url, target))
          result = { ok: false, reason: "UNEXPECTED_REDIRECT" };
        else result = await capture(tab);
      } catch (error) {
        result = {
          ok: false,
          reason:
            error.message === "NAVIGATION_TIMEOUT"
              ? "NAVIGATION_TIMEOUT"
              : "NAVIGATION_FAILED",
        };
      }
      s = await current(id);
      if (!s) return;
      const expected = s.phase === "thread" ? "thread" : "list";
      if (!result?.ok || result.operation !== expected) {
        await stop(result?.reason || "CAPTURE_FAILED", result?.access);
        return;
      }
      if (result.saved?.comment_summary)
        s.history.at(-1).comment_summary = result.saved.comment_summary;
      s.inFlight = false;
      s.expectedUrl = tab.url;
      Object.assign(s.history.at(-1), {
        outcome: "success",
        finishedAt: now(),
      });
      try {
        if (s.phase === "thread") {
          s.threadsSaved++;
          if (result.saved?.eligible) s.matchedThreads++;
          if (result.saved?.metadata_missing) s.metadataWarnings++;
          s.index++;
          s.phase = s.index < s.queue.length ? "thread" : "return";
          s.nextAt = stepDelay();
        } else if (s.phase === "return") {
          s.currentHeadIds = result.data
            .filter((post) => !post.pinned)
            .map((post) => post.id);
          finishCycle(s);
        } else await acceptList(s, result);
      } catch (error) {
        await put(s);
        await stop(
          error.message === "INVALID_PLAN"
            ? "INVALID_PLAN"
            : "LOCAL_PLAN_FAILED",
        );
        return;
      }
      if (!(await current(id))) return;
      if (await checkpoint(s)) await arm(s);
    } finally {
      processing = false;
    }
  }
  async function restore() {
    const s = await get();
    if (!active(s)) {
      await chrome.alarms.clear(MONITOR_ALARM);
      return;
    }
    const { trial } = await chrome.storage.local.get("trial");
    if (trial?.status === "running") {
      await stop("MODE_CONFLICT");
      return;
    }
    if (s.inFlight) {
      await stop("WORKER_INTERRUPTED");
      return;
    }
    if (!Number.isFinite(s.nextAt) || !allowedMonitorUrl(s.expectedUrl)) {
      await stop("INVALID_MONITOR_STATE");
      return;
    }
    if (s.phase === "rest" && s.schedulePolicy !== 2) {
      s.cycleStartedAt =
        s.cycleStartedAt ||
        s.history.find((event) => event.cycle === s.cycle)?.startedAt ||
        now();
      s.nextAt = nextMonitorTime(s.cycleStartedAt, now(), random);
      s.schedulePolicy = 2;
      if (!(await checkpoint(s))) return;
    }
    await arm(s);
  }
  async function status() {
    await display(await get());
  }
  return { start, tick, stop, restore, status };
}
