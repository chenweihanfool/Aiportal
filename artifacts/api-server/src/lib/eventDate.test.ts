import { describe, expect, it } from "vitest";
import { resolveEventDate, validDay } from "./eventDate";

describe("validDay", () => {
  it("accepts real dates (also with a time suffix) and rejects everything else", () => {
    expect(validDay("2026-10-16")).toBe("2026-10-16");
    expect(validDay("2026-10-16T09:30:00+08:00")).toBe("2026-10-16");
    for (const bad of ["null", "", "~", "2026-02-31", "2026-13-01", "10-16", null, undefined, 20261016]) expect(validDay(bad)).toBeNull();
  });
});

describe("resolveEventDate", () => {
  it("keeps a valid frontmatter date; time comes from the diary line when it is the same day", () => {
    expect(resolveEventDate({ date: "2026-10-16", writtenAt: "2026-10-16T13:08:00+08:00", createdAt: "2026-10-16T20:35:00+08:00" }))
      .toEqual({ date: "2026-10-16", dateSource: "frontmatter", time: "13:08", timeSource: "diary" });
  });
  it("falls back to the extraction time of the same day when the diary line has no timestamp", () => {
    expect(resolveEventDate({ date: "2026-10-16", createdAt: "2026-10-16T20:35:00+08:00" }))
      .toEqual({ date: "2026-10-16", dateSource: "frontmatter", time: "20:35", timeSource: "extracted" });
  });
  it("gives no time when the time source is on another day (an old event extracted much later)", () => {
    expect(resolveEventDate({ date: "2026-09-30", createdAt: "2026-10-02T10:00:00+08:00" }))
      .toEqual({ date: "2026-09-30", dateSource: "frontmatter", time: null, timeSource: null });
  });
  it("the string 'null' (events whose frontmatter says date: null) is repaired from the diary time, then the extraction time", () => {
    expect(resolveEventDate({ date: "null", writtenAt: "2026-09-24T21:05:00+08:00", createdAt: "2026-09-25T01:00:00+08:00" }))
      .toEqual({ date: "2026-09-24", dateSource: "diary", time: "21:05", timeSource: "diary" });
    expect(resolveEventDate({ date: "null", createdAt: "2026-09-25T01:00:00+08:00" }))
      .toEqual({ date: "2026-09-25", dateSource: "extracted", time: "01:00", timeSource: "extracted" });
  });
  it("converts to Taipei time (UTC late evening is already the next day in Taipei)", () => {
    expect(resolveEventDate({ date: null, createdAt: "2026-10-15T20:30:00Z" }))
      .toEqual({ date: "2026-10-16", dateSource: "extracted", time: "04:30", timeSource: "extracted" });
  });
  it("no usable source at all → empty date, never a fake one", () => {
    expect(resolveEventDate({ date: "null" })).toEqual({ date: "", dateSource: "none", time: null, timeSource: null });
    expect(resolveEventDate({ date: undefined, createdAt: "not a time", writtenAt: "" })).toEqual({ date: "", dateSource: "none", time: null, timeSource: null });
  });
});
