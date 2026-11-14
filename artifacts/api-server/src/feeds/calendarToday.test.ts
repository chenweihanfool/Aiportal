import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { validateFeedRequest } from "../lib/feedValidate";
import { FEED_REGISTRY } from "./registry";

// calendar-today feed v1：今天的行程（只有標題、時間、地點文字）。契約見 docs/feed-api.md。
describe("calendar-today feed", () => {
  const body = (payload: unknown) => ({ schemaVersion: 1, generatedAt: "2026-11-14", payload });
  const event = { start: "2026-11-14T09:30:00+08:00", end: "2026-11-14T10:00:00+08:00", allDay: false, title: "例會", location: "三樓會議室" };
  const allDay = { start: "2026-11-14", end: "2026-11-15", allDay: true, title: "休假", location: null };
  const ok = { computedAt: "2026-11-14T08:00:00+08:00", date: "2026-11-14", events: [event, allDay] };

  it("schemas/feeds/calendar-today.v1.schema.json 與登記表逐字一致", () => {
    const dir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../../schemas/feeds");
    const want = JSON.stringify(FEED_REGISTRY["calendar-today"]!.schema, null, 2) + "\n";
    expect(readFileSync(path.join(dir, "calendar-today.v1.schema.json"), "utf8")).toBe(want);
  });

  it("合法 payload（含全天事件與 null 結束時間／地點）通過", () => {
    expect(validateFeedRequest("calendar-today", body(ok)).ok).toBe(true);
    expect(validateFeedRequest("calendar-today", body({ ...ok, events: [] })).ok).toBe(true);
    expect(validateFeedRequest("calendar-today", body({ ...ok, events: [{ ...event, end: null, location: null }] })).ok).toBe(true);
  });

  it("多餘欄位（attendees）被拒；標題 121 字被拒", () => {
    expect(validateFeedRequest("calendar-today", body({ ...ok, events: [{ ...event, attendees: ["甲"] }] })).ok).toBe(false);
    expect(validateFeedRequest("calendar-today", body({ ...ok, events: [{ ...event, title: "x".repeat(121) }] })).ok).toBe(false);
    expect(validateFeedRequest("calendar-today", body({ ...ok, extra: 1 })).ok).toBe(false);
  });

  it("時間沒有時區、日期格式不對、缺欄位被拒", () => {
    expect(validateFeedRequest("calendar-today", body({ ...ok, events: [{ ...event, start: "2026-11-14T09:30:00" }] })).ok).toBe(false);
    expect(validateFeedRequest("calendar-today", body({ ...ok, date: "11/14" })).ok).toBe(false);
    const noLocation = { start: event.start, end: event.end, allDay: event.allDay, title: event.title };
    expect(validateFeedRequest("calendar-today", body({ ...ok, events: [noLocation] })).ok).toBe(false);
  });
});
