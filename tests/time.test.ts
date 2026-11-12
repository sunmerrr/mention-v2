import { describe, expect, it } from "vitest";
import { scopeSchema } from "../packages/contracts/src/api";
import { koreanDay, koreanLocalToEpoch } from "../packages/domain/src/time";

describe("UTC storage and explicit Korean reporting boundaries", () => {
  it("changes the reporting day exactly at Korean midnight", () => {
    expect(koreanDay(Date.parse("2026-11-11T14:59:59.999Z"))).toBe(
      "2026-11-11",
    );
    expect(koreanDay(Date.parse("2026-11-11T15:00:00.000Z"))).toBe(
      "2026-11-12",
    );
    expect(koreanLocalToEpoch("2026-11-12T00:00")).toBe(
      Date.parse("2026-11-11T15:00:00Z"),
    );
  });
  it("rejects rollover dates and requires explicit minute-precision local input", () => {
    for (const value of [
      "2026-02-30T12:00",
      "2026-11-12",
      "2026-11-12T25:00",
      "2026-11-12T12:00Z",
    ])
      expect(() => koreanLocalToEpoch(value)).toThrow();
    expect(scopeSchema.safeParse({ day: "2026-02-30" }).success).toBe(false);
    expect(scopeSchema.safeParse({ day: "2028-02-29" }).success).toBe(true);
  });
});
