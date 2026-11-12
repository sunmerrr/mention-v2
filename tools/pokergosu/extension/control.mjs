/** Local commands require one explicit persistent-site permission grant. */
import { afterQuietHours, allowedMonitorUrl } from "./monitor.mjs";
import { boardTab, reloadBoard } from "./trial.mjs";
export const CONTROL_ALARM = "mention-pokergosu-control";
export const SITE_PERMISSION = { origins: ["https://www.pokergosu.com/*"] };
const BOARD = "https://www.pokergosu.com/free";
const SECURITY_HOLDS = new Set([
  "BOT_CHALLENGE",
  "ACCESS_DENIED",
  "RATE_LIMITED",
  "ACCOUNT_RESTRICTION_NOTICE",
  "ACCESS_RESTRICTED",
]);

export function createControl({
  chrome,
  local,
  monitor,
  show,
  now = Date.now,
  navigate = (id, url) => reloadBoard(chrome, id, url),
  settle = () => new Promise((resolve) => setTimeout(resolve, 1500)),
}) {
  let busy = false;
  const read = async (key) => (await chrome.storage.local.get(key))[key];
  const put = (key, value) => chrome.storage.local.set({ [key]: value });
  async function instance() {
    let id = await read("controlInstance");
    if (!id) {
      id = crypto.randomUUID();
      await put("controlInstance", id);
    }
    return id;
  }
  async function ack(receipt) {
    await local("/control/ack", {
      instance: await instance(),
      id: receipt.command.id,
      result: receipt.result,
    });
    await chrome.storage.local.remove("controlReceipt");
  }
  async function recover() {
    const receipt = await read("controlReceipt");
    if (!receipt) return;
    if (!receipt.result) {
      receipt.result =
        receipt.command.action === "reload" &&
        chrome.runtime.getManifest().version === receipt.command.targetVersion
          ? { ok: true, code: "RELOADED" }
          : { ok: false, code: "INTERRUPTED_UNKNOWN_NO_RETRY" };
      await put("controlReceipt", receipt);
    }
    await ack(receipt);
  }
  async function ensureTab() {
    const state = await read("monitor");
    const managed = await read("managedTabId");
    for (const id of [
      ...new Set([managed, state?.tabId].filter(Number.isInteger)),
    ]) {
      let tab;
      try {
        tab = await chrome.tabs.get(id);
      } catch {
        continue;
      }
      const lastTarget = state?.history?.at(-1)?.url;
      if (
        !allowedMonitorUrl(tab.url) ||
        (tab.url !== state?.expectedUrl &&
          tab.url !== lastTarget &&
          !(id === managed && boardTab(tab)))
      )
        continue;
      await put("managedTabId", id);
      if (!boardTab(tab)) {
        await navigate(id, BOARD);
        await settle();
        tab = await chrome.tabs.get(id);
      }
      return tab;
    }
    const created = await chrome.tabs.create({
      url: "about:blank",
      active: false,
    });
    await put("managedTabId", created.id);
    await navigate(created.id, BOARD);
    await settle();
    return chrome.tabs.get(created.id);
  }
  async function apply(command) {
    if (now() > command.expiresAt)
      return { ok: false, code: "COMMAND_EXPIRED_NO_ACTION" };
    if (command.action === "stop") {
      await put("lastManualStopRequestedAt", command.createdAt);
      await monitor.stop("USER_STOP");
      return { ok: true, code: "STOPPED" };
    }
    if (command.action === "reload") {
      if (chrome.runtime.getManifest().version === command.targetVersion)
        return { ok: true, code: "ALREADY_CURRENT" };
      await chrome.runtime.reload();
      return null; // The next worker acknowledges only after checking its version.
    }
    if (!["start", "resume"].includes(command.action))
      return { ok: false, code: "UNKNOWN_COMMAND" };
    if (!(await chrome.permissions.contains(SITE_PERMISSION)))
      return { ok: false, code: "SITE_PERMISSION_REQUIRED" };
    const trial = await read("trial");
    if (trial?.status === "running")
      return { ok: false, code: "TRIAL_RUNNING" };
    const state = await read("monitor");
    if (state?.status === "running")
      return { ok: true, code: "ALREADY_RUNNING" };
    if (SECURITY_HOLDS.has(state?.reason))
      return { ok: false, code: "HUMAN_ACCESS_CHECK_REQUIRED" };
    const stoppedAt =
      (await read("lastManualStopRequestedAt")) ??
      (state?.reason === "USER_STOP" ? state.finishedAt : 0);
    if (stoppedAt >= command.createdAt)
      return { ok: false, code: "USER_STOP_SUPERSEDES_COMMAND" };
    if (afterQuietHours(now()) > now())
      return { ok: false, code: "QUIET_HOURS_NO_START" };
    const tab = await ensureTab();
    if (now() > command.expiresAt)
      return { ok: false, code: "COMMAND_EXPIRED_NO_ACTION" };
    if (((await read("lastManualStopRequestedAt")) || 0) >= command.createdAt)
      return { ok: false, code: "USER_STOP_SUPERSEDES_COMMAND" };
    await monitor.start(tab);
    const after = await read("monitor");
    return after?.status === "running"
      ? { ok: true, code: "STARTED" }
      : { ok: false, code: "START_DID_NOT_COMPLETE" };
  }
  async function poll() {
    if (busy || !(await read("localControlEnabled"))) return;
    busy = true;
    try {
      await recover();
      const permission = await chrome.permissions.contains(SITE_PERMISSION);
      if (!permission && (await read("monitor"))?.status === "running")
        await monitor.stop("SITE_PERMISSION_REVOKED");
      const reply = await local("/control/poll", {
        instance: await instance(),
        version: chrome.runtime.getManifest().version,
        permission,
        enabled: true,
      });
      if (!reply.command) return;
      const command = reply.command;
      if (
        typeof command.id !== "string" ||
        !Number.isFinite(command.expiresAt) ||
        !Number.isFinite(command.createdAt) ||
        !["start", "resume", "stop", "reload"].includes(command.action)
      )
        throw new Error("INVALID_COMMAND");
      const receipt = { command, result: null };
      await put("controlReceipt", receipt);
      try {
        receipt.result = await apply(command);
      } catch {
        receipt.result = { ok: false, code: "COMMAND_EXECUTION_FAILED" };
      }
      if (receipt.result) {
        await put("controlReceipt", receipt);
        await ack(receipt);
      }
    } catch {
      await put("controlConnection", { at: now(), state: "LOCAL_UNAVAILABLE" });
    } finally {
      busy = false;
    }
  }
  async function restore() {
    if (!(await read("localControlEnabled"))) {
      await chrome.alarms.clear(CONTROL_ALARM);
      return;
    }
    await chrome.alarms.create(CONTROL_ALARM, { periodInMinutes: 0.5 });
    await poll();
  }
  // permissions.request must be invoked directly inside the native user gesture.
  async function grant(granted) {
    if (!granted) {
      await show("포커고수 지속 권한이 허용되지 않았습니다.", "!");
      return;
    }
    await put("localControlEnabled", true);
    await restore();
    await show(
      "로컬 제어 연결됨. 이후 로컬 명령으로 시작·재개할 수 있습니다.",
      "연결",
    );
  }
  async function disable() {
    await put("localControlEnabled", false);
    await chrome.alarms.clear(CONTROL_ALARM);
    await put("lastManualStopRequestedAt", now());
    await monitor.stop("USER_STOP");
    await chrome.permissions.remove(SITE_PERMISSION);
    await show("로컬 제어를 해제하고 수집을 중지했습니다.", "중지");
  }
  return { poll, restore, grant, disable };
}
