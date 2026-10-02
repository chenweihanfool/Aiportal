import { describe, it, expect } from "vitest";
import { isNewPersonSince, sanitizePeopleFirstSeen } from "./peopleFirstSeen";

describe("sanitizePeopleFirstSeen", () => {
  it("keeps valid name→time entries", () => {
    expect(sanitizePeopleFirstSeen({ 陳奕如: "2026-10-03T00:56:59+08:00" })).toEqual({ 陳奕如: "2026-10-03T00:56:59+08:00" });
  });
  it("returns null (= not provided, keep previous) for non-objects", () => {
    for (const v of [undefined, null, "x", 3, [], [["a", "b"]]]) expect(sanitizePeopleFirstSeen(v)).toBeNull();
  });
  it("drops unparseable times, non-strings and empty names but keeps the rest", () => {
    const got = sanitizePeopleFirstSeen({ 甲: "not a date", 乙: 123, "": "2026-10-03T00:00:00+08:00", 丙: "2026-10-03T00:00:00+08:00" });
    expect(got).toEqual({ 丙: "2026-10-03T00:00:00+08:00" });
  });
  it("an empty object is a valid (empty) value, not 'absent'", () => {
    expect(sanitizePeopleFirstSeen({})).toEqual({});
  });
});

describe("isNewPersonSince", () => {
  const since = Date.parse("2026-10-02T12:00:00+08:00");
  it("uses the first-seen instant when present, even if the event date is old", () => {
    expect(isNewPersonSince("2026-10-03T00:56:59+08:00", "2026-02-06", since, "2026-10-02")).toBe(true);
    expect(isNewPersonSince("2026-10-01T23:00:00+08:00", "2026-10-02", since, "2026-10-02")).toBe(false);
  });
  it("falls back to the earliest event date when there is no (valid) first-seen time", () => {
    expect(isNewPersonSince(null, "2026-10-02", since, "2026-10-02")).toBe(true);
    expect(isNewPersonSince(undefined, "2026-10-01", since, "2026-10-02")).toBe(false);
    expect(isNewPersonSince("garbage", "2026-10-02", since, "2026-10-02")).toBe(true);
  });
});
