import { describe, expect, it } from "vitest";
import { msUntilNextTaipei2355 } from "./dailySnapshotJob";

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

describe("msUntilNextTaipei2355", () => {
  it("before 23:55 Taipei on the same day -> targets today's 23:55", () => {
    // 2026-08-21T10:00:00Z = 2026-08-21T18:00 Taipei
    const now = new Date("2026-08-21T10:00:00Z");
    const ms = msUntilNextTaipei2355(now);
    // Target: 2026-08-21T23:55 Taipei = 2026-08-21T15:55:00Z
    const expected = new Date("2026-08-21T15:55:00Z").getTime() - now.getTime();
    expect(ms).toBe(expected);
  });

  it("exactly at 23:55 Taipei -> rolls to tomorrow, does not fire immediately again", () => {
    // 2026-08-21T15:55:00Z = 2026-08-21T23:55 Taipei exactly
    const now = new Date("2026-08-21T15:55:00Z");
    const ms = msUntilNextTaipei2355(now);
    expect(ms).toBe(DAY_MS);
  });

  it("after 23:55 Taipei on the same day -> targets tomorrow's 23:55", () => {
    // 2026-08-21T17:00:00Z = 2026-08-22T01:00 Taipei (past 23:55)
    const now = new Date("2026-08-21T17:00:00Z");
    const ms = msUntilNextTaipei2355(now);
    // Target: 2026-08-22T23:55 Taipei = 2026-08-22T15:55:00Z
    const expected = new Date("2026-08-22T15:55:00Z").getTime() - now.getTime();
    expect(ms).toBe(expected);
  });

  it("Taipei date drives the target across a UTC day boundary, not UTC's own date", () => {
    // 2026-08-21T16:00:00Z = 2026-08-22T00:00 Taipei -- UTC calendar day is
    // still the 21st, but Taipei's is already the 22nd. Target must be
    // 2026-08-22's 23:55 Taipei, not 2026-08-21's.
    const now = new Date("2026-08-21T16:00:00Z");
    const ms = msUntilNextTaipei2355(now);
    const expected = new Date("2026-08-22T15:55:00Z").getTime() - now.getTime();
    expect(ms).toBe(expected);
  });

  it("always returns a positive value", () => {
    for (const iso of [
      "2026-01-01T00:00:00Z",
      "2026-12-31T23:59:00Z",
      "2026-08-21T15:54:59Z",
      "2026-08-21T15:56:00Z",
    ]) {
      expect(msUntilNextTaipei2355(new Date(iso))).toBeGreaterThan(0);
    }
  });
});
