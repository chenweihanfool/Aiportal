import { describe, expect, it } from "vitest";
import {
  buildChildren,
  buildList,
  decodeCursor,
  encodeCursor,
  isValidDate,
  missingPeriods,
  sortDayEvents,
  toChip,
  validateEntries,
  type EventRef,
  type ReportRow,
} from "./hermesTimeline";

const entry = (over: Record<string, unknown> = {}) => ({
  level: "day", periodKey: "2026-09-28", startDate: "2026-09-28", endDate: "2026-09-28",
  title: "2026-09-28", summary: "一句話", bodyMd: "# 內文", generation: 3, rangeInferred: false,
  periodNote: null, sourcePath: "日報/2026-09-28.md", contentHash: "abcdef0123456789", ...over,
});
const row = (level: ReportRow["level"], key: string, start: string, end = start, over: Partial<ReportRow> = {}): ReportRow => ({
  level, periodKey: key, startDate: start, endDate: end, title: key, summary: `摘要 ${key}`,
  generation: 3, rangeInferred: false, periodNote: null, ...over,
});

describe("validateEntries", () => {
  it("accepts a well-formed batch and fills defaults", () => {
    const r = validateEntries({ entries: [entry({ generation: undefined, rangeInferred: undefined, periodNote: undefined, sourcePath: undefined, summary: undefined })] });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.entries[0]).toMatchObject({ generation: 3, rangeInferred: false, periodNote: null, sourcePath: null, summary: "" });
  });

  it.each([
    ["空陣列", { entries: [] }],
    ["非陣列", { entries: "x" }],
    ["沒有 entries", {}],
    ["未知 level", { entries: [entry({ level: "decade" })] }],
    ["day 的 periodKey 格式不符", { entries: [entry({ periodKey: "2026-9-28" })] }],
    ["week 的 periodKey 缺零", { entries: [entry({ level: "week", periodKey: "2026-第5週" })] }],
    ["日期無效", { entries: [entry({ startDate: "2026-02-30" })] }],
    ["起日晚於迄日", { entries: [entry({ startDate: "2026-09-29", endDate: "2026-09-28" })] }],
    ["缺標題", { entries: [entry({ title: "" })] }],
    ["summary 過長", { entries: [entry({ summary: "x".repeat(401) })] }],
    ["bodyMd 過長", { entries: [entry({ bodyMd: "x".repeat(200_001) })] }],
    ["generation 越界", { entries: [entry({ generation: 4 })] }],
    ["contentHash 過短", { entries: [entry({ contentHash: "abc" })] }],
    ["同批重複期間", { entries: [entry(), entry()] }],
  ])("rejects: %s", (_name, body) => {
    expect(validateEntries(body).ok).toBe(false);
  });

  it("rejects more than 100 entries per batch and reports the failing index", () => {
    const many = Array.from({ length: 101 }, (_, i) => entry({ periodKey: `2026-01-${String((i % 28) + 1).padStart(2, "0")}` }));
    expect(validateEntries({ entries: many }).ok).toBe(false);
    const bad = validateEntries({ entries: [entry(), entry({ periodKey: "2026-09-27", level: "nope" })] });
    expect(bad.ok === false && bad.error.startsWith("entries[1]")).toBe(true);
  });
});

describe("cursor", () => {
  it("round-trips and rejects garbage", () => {
    expect(decodeCursor(encodeCursor("2026-09-28", "2026-第40週"))).toEqual({ startDate: "2026-09-28", periodKey: "2026-第40週" });
    expect(decodeCursor("!!!")).toBeNull();
    expect(decodeCursor(Buffer.from("not-a-date\u0000k").toString("base64url"))).toBeNull();
    expect(decodeCursor(undefined)).toBeNull();
  });
  it("isValidDate rejects impossible dates", () => {
    expect(isValidDate("2026-02-29")).toBe(false);
    expect(isValidDate("2028-02-29")).toBe(true);
  });
});

describe("missingPeriods", () => {
  it("finds the weeks HERMES reported missing (27, 32, 35) inside the existing span", () => {
    const have = ["25", "26", "28", "29", "30", "31", "33", "34", "36", "37", "38", "39", "40"].map((w) => `2026-第${w}週`);
    const missing = missingPeriods("week", have).map((p) => p.periodKey);
    expect(missing).toEqual(["2026-第27週", "2026-第32週", "2026-第35週"]);
  });
  it("gives ISO Monday–Sunday ranges for placeholder weeks", () => {
    const p = missingPeriods("week", ["2026-第26週", "2026-第28週"])[0];
    expect(p).toMatchObject({ periodKey: "2026-第27週", startDate: "2026-06-29", endDate: "2026-07-05" });
  });
  it("handles year rollover for weeks, months, quarters and years", () => {
    expect(missingPeriods("week", ["2025-第52週", "2026-第02週"]).map((p) => p.periodKey)).toEqual(["2026-第01週"]);
    expect(missingPeriods("month", ["2025-11", "2026-02"]).map((p) => p.periodKey)).toEqual(["2025-12", "2026-01"]);
    expect(missingPeriods("quarter", ["2025-Q4", "2026-Q2"]).map((p) => p.periodKey)).toEqual(["2026-Q1"]);
    expect(missingPeriods("year", ["2024", "2026"]).map((p) => p.periodKey)).toEqual(["2025"]);
    expect(missingPeriods("month", ["2026-02", "2026-04"])[0]).toMatchObject({ startDate: "2026-03-01", endDate: "2026-03-31" });
  });
  it("53-week year is respected (2026 has 53 ISO weeks)", () => {
    expect(missingPeriods("week", ["2026-第52週", "2027-第01週"]).map((p) => p.periodKey)).toEqual(["2026-第53週"]);
  });
  it("returns nothing for day level or empty input", () => {
    expect(missingPeriods("day", ["2026-09-28"])).toEqual([]);
    expect(missingPeriods("week", [])).toEqual([]);
  });
});

describe("buildList (day)", () => {
  const events: EventRef[] = [
    { id: "e1", date: "2026-09-28", title: "甲" },
    { id: "e2", date: "2026-09-28", title: "乙" },
    { id: "e3", date: "2026-09-26", title: "丙" },     // 該日沒有日報 → 占位列
    { id: "e4", date: "2026-10-02", title: "未來事件" }, // 未來日：不顯示
  ];
  const mind = new Map<string, number | null>([["2026-09-28", 98.9], ["2026-09-25", 97.1]]);
  const base = { level: "day" as const, events, mindScores: mind, today: "2026-09-29", limit: 30, cursor: null };

  it("merges reports, event-only days and score-only days; hides future events; sorts new→old", () => {
    const { items } = buildList({ ...base, rows: [row("day", "2026-09-28", "2026-09-28")] });
    expect(items.map((i) => i.periodKey)).toEqual(["2026-09-28", "2026-09-26", "2026-09-25"]);
    const d28 = items[0];
    expect(d28).toMatchObject({ hasReport: true, eventCount: 2, mindScore: 98.9, summary: "摘要 2026-09-28" });
    expect(d28.events.map((e) => e.id)).toEqual(["e1", "e2"]);
    expect(items[1]).toMatchObject({ hasReport: false, summary: "", eventCount: 1 });
    expect(items[2]).toMatchObject({ hasReport: false, eventCount: 0, mindScore: 97.1 });
    expect(items.some((i) => i.periodKey === "2026-10-02")).toBe(false);
  });

  it("attaches the happiness score per day; hhi-only days become placeholder rows; other levels and future days carry none", () => {
    const hhi = new Map<string, number>([["2026-09-28", 62], ["2026-09-24", 55], ["2026-10-03", 70]]);
    const { items } = buildList({ ...base, hhiScores: hhi, rows: [row("day", "2026-09-28", "2026-09-28")] });
    expect(items.map((i) => i.periodKey)).toEqual(["2026-09-28", "2026-09-26", "2026-09-25", "2026-09-24"]);
    expect(items[0]).toMatchObject({ mindScore: 98.9, hhiScore: 62 });          // 兩個分數互不覆蓋
    expect(items[1]).toMatchObject({ mindScore: null, hhiScore: null });        // 只有事件的日子
    expect(items[2]).toMatchObject({ mindScore: 97.1, hhiScore: null });        // 只有知識庫健康
    expect(items[3]).toMatchObject({ hasReport: false, mindScore: null, hhiScore: 55 });   // 只有幸福指數 → 占位列
    expect(items.some((i) => i.periodKey === "2026-10-03")).toBe(false);        // 未來日不顯示
    const week = buildList({ ...base, level: "week", hhiScores: hhi, rows: [row("week", "2026-第39週", "2026-09-20", "2026-09-26")] });
    expect(week.items.every((i) => i.hhiScore === null && i.mindScore === null)).toBe(true);
  });

  it("omitting hhiScores keeps the old behavior (hhiScore null everywhere)", () => {
    const { items } = buildList({ ...base, rows: [row("day", "2026-09-28", "2026-09-28")] });
    expect(items.every((i) => i.hhiScore === null)).toBe(true);
  });

  it("caps event chips at 8 but keeps the true count", () => {
    const many = Array.from({ length: 12 }, (_, i) => ({ id: `x${i}`, date: "2026-09-28", title: `t${i}` }));
    const { items } = buildList({ ...base, events: many, rows: [row("day", "2026-09-28", "2026-09-28")] });
    expect(items[0].events).toHaveLength(8);
    expect(items[0].eventCount).toBe(12);
  });

  it("paginates with a stable cursor and no duplicates or gaps", () => {
    const rows = Array.from({ length: 7 }, (_, i) => row("day", `2026-09-${String(20 + i).padStart(2, "0")}`, `2026-09-${String(20 + i).padStart(2, "0")}`));
    const noExtras = { ...base, events: [] as EventRef[], mindScores: new Map<string, number | null>(), rows };
    const p1 = buildList({ ...noExtras, limit: 3 });
    const p2 = buildList({ ...noExtras, limit: 3, cursor: p1.nextCursor });
    const p3 = buildList({ ...noExtras, limit: 3, cursor: p2.nextCursor });
    const all = [...p1.items, ...p2.items, ...p3.items].map((i) => i.periodKey);
    expect(all).toEqual(["2026-09-26", "2026-09-25", "2026-09-24", "2026-09-23", "2026-09-22", "2026-09-21", "2026-09-20"]);
    expect(p1.nextCursor).not.toBeNull();
    expect(p3.nextCursor).toBeNull();
  });
});

describe("buildList (week and above)", () => {
  it("adds placeholder rows for missing weeks and counts events inside each range", () => {
    const events: EventRef[] = [{ id: "e", date: "2026-07-01", title: "x" }];
    const { items } = buildList({
      level: "week", events, mindScores: new Map(), today: "2026-09-29", limit: 30, cursor: null,
      rows: [row("week", "2026-第26週", "2026-06-21", "2026-06-27"), row("week", "2026-第28週", "2026-07-05", "2026-07-11")],
    });
    expect(items.map((i) => [i.periodKey, i.hasReport])).toEqual([["2026-第28週", true], ["2026-第27週", false], ["2026-第26週", true]]);
    expect(items.find((i) => i.periodKey === "2026-第27週")).toMatchObject({ rangeInferred: true, eventCount: 1, events: [] });
  });

  it("a period that spans today only counts events up to today (future-dated events excluded)", () => {
    const events: EventRef[] = [
      { id: "a", date: "2026-09-28", title: "已發生" },
      { id: "b", date: "2026-10-02", title: "未來（同一週內）" },
    ];
    const { items } = buildList({
      level: "week", events, mindScores: new Map(), today: "2026-09-29", limit: 30, cursor: null,
      rows: [row("week", "2026-第40週", "2026-09-28", "2026-10-04")],
    });
    expect(items[0].eventCount).toBe(1);
  });

  it("carries periodNote and never lists periods starting in the future", () => {
    const { items } = buildList({
      level: "quarter", events: [], mindScores: new Map(), today: "2026-09-29", limit: 30, cursor: null,
      rows: [row("quarter", "2026-Q2", "2026-04-01", "2026-06-30", { periodNote: "涵蓋順延為 5–7 月" }),
             row("quarter", "2026-Q4", "2026-10-01", "2026-12-31")],
    });
    expect(items.map((i) => i.periodKey)).toEqual(["2026-Q2"]);
    expect(items[0].periodNote).toContain("順延");
  });
});

describe("buildChildren", () => {
  it("lists existing child reports whose start falls inside the range, old→new", () => {
    const days = [row("day", "2026-09-23", "2026-09-23"), row("day", "2026-09-21", "2026-09-21"), row("day", "2026-09-29", "2026-09-29")];
    expect(buildChildren(days, "2026-09-22", "2026-09-28").map((c) => c.periodKey)).toEqual(["2026-09-23"]);
    expect(buildChildren(days, "2026-09-15", "2026-09-28").map((c) => c.periodKey)).toEqual(["2026-09-21", "2026-09-23"]);
  });
});

describe("day events: newest-first by creation time", () => {
  const ev = (id: string, createdAt?: string | null): EventRef => ({ id, date: "2026-10-01", title: id, createdAt });

  it("sorts new→old and puts events without a usable time last, keeping their original order", () => {
    const out = sortDayEvents([
      ev("none1"), ev("old", "2026-10-01T08:00:00+08:00"), ev("bad", "not a date"), ev("new", "2026-10-01T21:30:00+08:00"),
      ev("none2", null), ev("mid", "2026-10-01T12:00:00+08:00"),
    ]);
    expect(out.map((e) => e.id)).toEqual(["new", "mid", "old", "none1", "bad", "none2"]);
  })

  it("compares real instants, not strings (different offsets)", () => {
    const out = sortDayEvents([ev("a", "2026-10-01T10:00:00+08:00"), ev("b", "2026-10-01T03:00:00Z")]);   // b = 11:00 +08 → newer
    expect(out.map((e) => e.id)).toEqual(["b", "a"]);
  })

  it("keeps the input order for identical timestamps and does not mutate the input", () => {
    const input = [ev("x", "2026-10-01T10:00:00Z"), ev("y", "2026-10-01T10:00:00Z")];
    expect(sortDayEvents(input).map((e) => e.id)).toEqual(["x", "y"]);
    expect(input.map((e) => e.id)).toEqual(["x", "y"]);
  })

  it("within the same creation time, L1 events are ordered by their daily sequence number (later first)", () => {
    const t = "2026-10-01T10:32:56+08:00";
    const out = sortDayEvents([
      ev("L1-2026-10-01-02", t), ev("L1-2026-10-01-10", t), ev("L4-abcd-01", t), ev("L1-2026-10-01-01", t),
      ev("L1-2026-10-01-09", "2026-10-01T09:00:00+08:00"),
    ]);
    // 時間較新者在前；同時間的 L1 事件依序號大→小；非 L1 事件不參與序號比較（維持原相對位置）
    expect(out.map((e) => e.id).filter((i) => i.startsWith("L1")).join(",")).toBe("L1-2026-10-01-10,L1-2026-10-01-02,L1-2026-10-01-01,L1-2026-10-01-09");
    expect(out[out.length - 1].id).toBe("L1-2026-10-01-09");
  })

  it("toChip carries createdAt and defaults to null for old snapshots", () => {
    expect(toChip(ev("a", "2026-10-01T10:00:00Z"))).toEqual({ id: "a", title: "a", createdAt: "2026-10-01T10:00:00Z" });
    expect(toChip({ id: "b", date: "2026-10-01", title: "b" }).createdAt).toBeNull();
  })

  it("buildList gives the list rows the newest events first (before the 8-chip cut)", () => {
    const many: EventRef[] = Array.from({ length: 12 }, (_, i) => ev(`e${i}`, `2026-10-01T${String(8 + i).padStart(2, "0")}:00:00+08:00`));
    const { items } = buildList({ level: "day", events: many, rows: [], mindScores: new Map(), today: "2026-10-02", limit: 30, cursor: null });
    expect(items[0].events.map((e) => e.id)).toEqual(["e11", "e10", "e9", "e8", "e7", "e6", "e5", "e4"]);
  })
});
