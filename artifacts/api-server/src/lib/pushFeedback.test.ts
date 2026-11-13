import { describe, expect, it } from "vitest";
import {
  addDaysTpe, buildPushFeedback, buildPushStats, isRealDate, laterUntil, parsePushDays, parsePushFeedbackBody,
  todayTpe, CARD_KINDS, PUSH_ACTIONS,
} from "./pushFeedback";

describe("parsePushFeedbackBody", () => {
  const good = { cardKey: "topic:T1:case:王案", cardKind: "topic", action: "shown", forDate: "2026-11-13" };

  it("合法回物件；cardKey 去頭尾空白", () => {
    expect(parsePushFeedbackBody(good)).toEqual(good);
    expect(parsePushFeedbackBody({ ...good, cardKey: "  k  " })).toMatchObject({ cardKey: "k" });
    for (const cardKind of CARD_KINDS) expect(typeof parsePushFeedbackBody({ ...good, cardKind })).toBe("object");
    for (const action of PUSH_ACTIONS) expect(typeof parsePushFeedbackBody({ ...good, action })).toBe("object");
    expect(isRealDate("2024-02-29")).toBe(true);
  });

  it("不合法回字串", () => {
    for (const bad of [
      null, [], "x", undefined,
      { ...good, extra: 1 },
      { ...good, cardKey: undefined },
      { ...good, cardKey: 5 },
      { ...good, cardKey: "" },
      { ...good, cardKey: "   " },
      { ...good, cardKey: "a".repeat(201) },
      { ...good, cardKind: "zzz" },
      { ...good, action: "zzz" },
      { ...good, forDate: "2026-2-3" },
      { ...good, forDate: "2026-02-30" },
      { ...good, forDate: "2026-13-01" },
      { ...good, forDate: "2026-02-29" },
      { ...good, forDate: 20261113 },
    ]) {
      expect(typeof parsePushFeedbackBody(bad), JSON.stringify(bad)).toBe("string");
    }
  });

  it("cardKey 去空白後 200 字可以、201 字不行", () => {
    expect(typeof parsePushFeedbackBody({ ...good, cardKey: "a".repeat(200) })).toBe("object");
    expect(typeof parsePushFeedbackBody({ ...good, cardKey: " " + "a".repeat(200) + " " })).toBe("object");
    expect(typeof parsePushFeedbackBody({ ...good, cardKey: "a".repeat(201) })).toBe("string");
  });
});

describe("parsePushDays", () => {
  it("未給回 fallback；1～90 合法；其他不合法", () => {
    expect(parsePushDays(undefined, 30)).toBe(30);
    expect(parsePushDays(undefined, 14)).toBe(14);
    expect(parsePushDays("1", 30)).toBe(1);
    expect(parsePushDays("90", 30)).toBe(90);
    for (const bad of ["0", "91", "abc", "1.5", "-1", "", 30, ["30"]]) {
      expect(parsePushDays(bad, 30), JSON.stringify(bad)).toBeNull();
    }
  });
});

describe("台北日期", () => {
  it("todayTpe：UTC 15:59 還是同一天，16:00 換日", () => {
    expect(todayTpe(new Date("2026-11-12T15:59:00Z"))).toBe("2026-11-12");
    expect(todayTpe(new Date("2026-11-12T16:00:00Z"))).toBe("2026-11-13");
    expect(todayTpe(new Date("2026-01-31T16:00:00Z"))).toBe("2026-02-01");
  });
  it("addDaysTpe：跨月、跨年", () => {
    expect(addDaysTpe("2026-11-13", 0)).toBe("2026-11-13");
    expect(addDaysTpe("2026-11-13", -12)).toBe("2026-11-01");
    expect(addDaysTpe("2026-03-01", -1)).toBe("2026-02-28");
    expect(addDaysTpe("2026-01-01", -1)).toBe("2025-12-31");
  });
  it("laterUntil 固定寫法", () => {
    expect(laterUntil("2026-11-13")).toBe("2026-11-13T20:00:00+08:00");
  });
});

describe("buildPushFeedback", () => {
  it("suppressed 去重、依 cardKey 排序", () => {
    const v = buildPushFeedback(["b", "a", "b"], [], "2026-11-13");
    expect(v.suppressed).toEqual(["a", "b"]);
    expect(v.later).toEqual([]);
  });
  it("later 去重、排除 suppressed、排序、帶當天 20:00", () => {
    const v = buildPushFeedback(["quiet:x"], ["topic:B", "topic:A", "topic:B", "quiet:x"], "2026-11-13");
    expect(v.later).toEqual([
      { cardKey: "topic:A", until: "2026-11-13T20:00:00+08:00" },
      { cardKey: "topic:B", until: "2026-11-13T20:00:00+08:00" },
    ]);
  });
});

describe("buildPushStats", () => {
  it("分母 0 時比率為 0；byKind 五種固定順序全列", () => {
    const s = buildPushStats(14, [], [], 0);
    expect(s).toEqual({
      days: 14, shown: 0, opened: 0, openRate: 0, useful: 0, useless: 0, uselessRate: 0,
      byKind: CARD_KINDS.map((kind) => ({ kind, shown: 0, opened: 0, useless: 0 })),
      daysWithCards: 0,
    });
  });
  it("比率四捨五入到小數 3 位、大於 1 截為 1", () => {
    expect(buildPushStats(14, [{ action: "shown", n: 3 }, { action: "opened", n: 2 }, { action: "useless", n: 1 }], [], 2))
      .toMatchObject({ shown: 3, opened: 2, openRate: 0.667, useless: 1, uselessRate: 0.333, daysWithCards: 2 });
    expect(buildPushStats(14, [{ action: "shown", n: 2 }, { action: "opened", n: 5 }, { action: "useless", n: 5 }], [], 1))
      .toMatchObject({ openRate: 1, uselessRate: 1 });
  });
  it("byKind 各自加總、不認得的 kind 忽略", () => {
    const s = buildPushStats(7, [], [
      { kind: "topic", action: "shown", n: 4 },
      { kind: "topic", action: "opened", n: 1 },
      { kind: "resume", action: "shown", n: 2 },
      { kind: "resume", action: "useless", n: 1 },
      { kind: "zzz", action: "shown", n: 9 },
    ], 3);
    expect(s.byKind).toEqual([
      { kind: "topic", shown: 4, opened: 1, useless: 0 },
      { kind: "resume", shown: 2, opened: 0, useless: 1 },
      { kind: "recall", shown: 0, opened: 0, useless: 0 },
      { kind: "quiet", shown: 0, opened: 0, useless: 0 },
      { kind: "brief", shown: 0, opened: 0, useless: 0 },
    ]);
  });
});
