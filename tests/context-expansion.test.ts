import { expect, it } from "vitest";
import { expansionFinished } from "../packages/domain/src/context-expansion";

it("distinguishes completed lookups from live waiting, failures and budget limits", () => {
  expect(
    expansionFinished({ complete: true, stop_reason: "time_window_reached" }),
  ).toBe(true);
  expect(
    expansionFinished({ complete: true, stop_reason: "history_start" }),
  ).toBe(true);
  expect(
    expansionFinished({ complete: true, stop_reason: "waiting_for_messages" }),
  ).toBe(false);
  expect(
    expansionFinished({ complete: false, stop_reason: "request_limit" }),
  ).toBe(false);
  expect(expansionFinished({ complete: true, stop_reason: "read_error" })).toBe(
    false,
  );
});
