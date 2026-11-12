/** Finite board-only trial. Persist each attempt before any website reload. */
export const TRIAL_ALARM = "mention-pokergosu-trial";
export const TRIAL_LIMIT = 15;
const BOARD = "https://www.pokergosu.com/free";

export function boardTab(tab) {
  try {
    const url = new URL(tab?.url);
    return (
      Number.isInteger(tab.id) &&
      url.origin === "https://www.pokergosu.com" &&
      /^\/free\/?$/.test(url.pathname) &&
      (!url.search || url.search === "?page=1")
    );
  } catch {
    return false;
  }
}

export function nextTrialTime(now, random) {
  return now + (15 + 15 * random()) * 60000;
}

export function reloadBoard(chrome, tabId, url) {
  return new Promise((resolve, reject) => {
    let loading = false;
    const cleanup = () => {
      clearTimeout(timer);
      chrome.tabs.onUpdated.removeListener(listener);
    };
    const listener = (id, change) => {
      if (id !== tabId) return;
      if (change.status === "loading") loading = true;
      if (loading && change.status === "complete") {
        cleanup();
        resolve();
      }
    };
    const timer = setTimeout(() => {
      cleanup();
      reject(new Error("NAVIGATION_TIMEOUT"));
    }, 25000);
    chrome.tabs.onUpdated.addListener(listener);
    const request = url
      ? chrome.tabs.update(tabId, { url })
      : chrome.tabs.reload(tabId);
    request.catch((error) => {
      cleanup();
      reject(error);
    });
  });
}

export function createTrial({
  chrome,
  local,
  capture,
  show,
  now = Date.now,
  random = Math.random,
  makeId = () => crypto.randomUUID(),
  reload = (id) => reloadBoard(chrome, id),
  settle = () => new Promise((resolve) => setTimeout(resolve, 1500)),
}) {
  let processing = false;
  let generation = 0;
  const get = async () => (await chrome.storage.local.get("trial")).trial;
  const put = (state) => chrome.storage.local.set({ trial: state });
  const report = (state) =>
    local("/capture", { operation: "trial", page_url: BOARD, data: state });
  const active = (state) => state?.status === "running";
  const current = async (id) => {
    const state = await get();
    return state?.id === id && active(state) ? state : null;
  };
  async function display(state) {
    if (!state) return;
    const next = state.nextAt
      ? ` · 다음 ${new Date(state.nextAt).toLocaleTimeString("ko-KR")}`
      : "";
    const label =
      state.status === "running"
        ? "진행 중"
        : state.status === "completed"
          ? "완료"
          : `중지 (${state.reason})`;
    await show(
      `15회 시험 ${label} · 시도 ${state.attempted}/15 · 성공 ${state.successful}${next}`,
      state.status === "completed"
        ? "완료"
        : state.status === "running"
          ? String(state.attempted)
          : "중지",
      state.tabId,
    );
  }
  async function stop(reason = "USER_STOP") {
    generation++;
    await chrome.alarms.clear(TRIAL_ALARM);
    const state = await get();
    if (!state || !active(state)) return;
    if (state.inFlight) {
      Object.assign(state.history.at(-1), {
        outcome: reason === "WORKER_INTERRUPTED" ? "unknown" : "stopped",
        reason,
        finishedAt: now(),
      });
    }
    Object.assign(state, {
      status: "stopped",
      reason,
      inFlight: false,
      nextAt: null,
      finishedAt: now(),
    });
    await put(state);
    try {
      await report(state);
    } catch {
      /* Local storage still retains the final audit. */
    }
    await display(state);
  }
  async function checkpoint(state) {
    await put(state);
    try {
      await report(state);
      return true;
    } catch {
      if (active(state)) await stop("LOCAL_UNAVAILABLE");
      else {
        await chrome.alarms.clear(TRIAL_ALARM);
        await display(state);
      }
      return false;
    }
  }
  async function arm(state) {
    if (state.status === "completed") await chrome.alarms.clear(TRIAL_ALARM);
    else await chrome.alarms.create(TRIAL_ALARM, { when: state.nextAt });
    await display(state);
  }
  async function start(tab) {
    if (processing || active(await get())) {
      await display(await get());
      return;
    }
    if (!boardTab(tab)) {
      await show(
        "자유 게시판 첫 목록을 직접 열고 시험 시작 메뉴를 눌러주세요.",
        "!",
        tab?.id,
      );
      return;
    }
    processing = true;
    const ticket = ++generation;
    try {
      // This baseline reads the already loaded page; it is not a site request.
      const baseline = await capture(tab);
      if (
        !baseline?.ok ||
        baseline.operation !== "list" ||
        ticket !== generation
      )
        return;
      const state = {
        id: makeId(),
        status: "running",
        tabId: tab.id,
        limit: TRIAL_LIMIT,
        attempted: 0,
        successful: 0,
        startedAt: now(),
        nextAt: nextTrialTime(now(), random),
        inFlight: false,
        history: [],
        reason: null,
        finishedAt: null,
      };
      if (
        (await checkpoint(state)) &&
        ticket === generation &&
        (await current(state.id))
      )
        await arm(state);
    } finally {
      processing = false;
    }
  }
  async function tick() {
    if (processing) return;
    processing = true;
    try {
      let state = await get();
      if (!active(state)) {
        await chrome.alarms.clear(TRIAL_ALARM);
        return;
      }
      if (state.inFlight) {
        await stop("WORKER_INTERRUPTED");
        return;
      }
      if (state.attempted >= TRIAL_LIMIT) {
        await stop("INVALID_LIMIT_STATE");
        return;
      }
      if (now() < state.nextAt) {
        await arm(state);
        return;
      }
      let tab;
      try {
        tab = await chrome.tabs.get(state.tabId);
      } catch {
        await stop("TAB_CLOSED");
        return;
      }
      if (!boardTab(tab)) {
        await stop("TAB_CHANGED_OR_PERMISSION_LOST");
        return;
      }
      // Local outages must not result in pointless website requests.
      try {
        await local("/status");
      } catch {
        await stop("LOCAL_UNAVAILABLE");
        return;
      }
      state = await current(state.id);
      if (!state) return;
      state.attempted++;
      state.inFlight = true;
      state.nextAt = null;
      state.history.push({
        sequence: state.attempted,
        startedAt: now(),
        finishedAt: null,
        outcome: "inflight",
        reason: null,
      });
      if (!(await checkpoint(state))) return;
      const id = state.id;
      if (!(await current(id))) return;
      let outcome;
      try {
        await reload(state.tabId);
        await settle();
        if (!(await current(id))) return;
        tab = await chrome.tabs.get(state.tabId);
        if (!boardTab(tab))
          outcome = { ok: false, reason: "UNEXPECTED_REDIRECT" };
        else outcome = await capture(tab);
      } catch {
        outcome = { ok: false, reason: "NAVIGATION_FAILED" };
      }
      state = await current(id);
      if (!state) return;
      state.inFlight = false;
      const success = outcome?.ok === true && outcome.operation === "list";
      Object.assign(state.history.at(-1), {
        finishedAt: now(),
        outcome: success ? "success" : "failed",
        reason: success ? null : outcome?.reason || "CAPTURE_FAILED",
      });
      if (success) state.successful++;
      if (!success) {
        Object.assign(state, {
          status: "stopped",
          reason: outcome?.reason || "CAPTURE_FAILED",
          finishedAt: now(),
          nextAt: null,
        });
      } else if (state.attempted === TRIAL_LIMIT) {
        Object.assign(state, {
          status: "completed",
          finishedAt: now(),
          nextAt: null,
        });
      } else state.nextAt = nextTrialTime(now(), random);
      if (!(await checkpoint(state))) return;
      if (active(state)) {
        const latest = await current(id);
        if (latest) await arm(latest);
      } else {
        await chrome.alarms.clear(TRIAL_ALARM);
        await display(state);
      }
    } finally {
      processing = false;
    }
  }
  async function restore() {
    const state = await get();
    if (!active(state)) {
      await chrome.alarms.clear(TRIAL_ALARM);
      return;
    }
    if (state.inFlight) {
      await stop("WORKER_INTERRUPTED");
      return;
    }
    if (state.attempted >= TRIAL_LIMIT || !Number.isFinite(state.nextAt)) {
      await stop("INVALID_LIMIT_STATE");
      return;
    }
    // Missed alarms produce one check, not a burst of catch-up requests.
    await chrome.alarms.create(TRIAL_ALARM, {
      when: Math.max(now() + 1000, state.nextAt),
    });
  }
  async function status() {
    await display(await get());
  }
  return { start, stop, tick, restore, status };
}
