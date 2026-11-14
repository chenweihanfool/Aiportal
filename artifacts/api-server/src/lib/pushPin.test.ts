import { describe, expect, it } from "vitest";
import { PIN_TARGET_KINDS, parseDue, parsePinBody } from "./pushPin";
import { addDaysTpe, todayTpe } from "./pushFeedback";

const today = todayTpe(new Date());
const due = (n: number) => addDaysTpe(today, n);

describe("parsePinBody", () => {
  const good = {
    targetKind: "case",
    targetId: "case:王案",
    title: "王案判決書",
    href: "#/reading/case/王案",
    dueDate: due(7),
  };

  it("合法回物件；11 種 targetKind 都接受", () => {
    const parsed = parsePinBody(good);
    expect(parsed).toEqual(good);
    expect(parsePinBody(good)).toEqual({ ...good });
    for (const targetKind of PIN_TARGET_KINDS) {
      expect(typeof parsePinBody({ ...good, targetKind }), targetKind).toBe("object");
    }
  });

  it("targetId／title 去頭尾空白後非空", () => {
    expect(parsePinBody({ ...good, targetId: "  id  " })).toMatchObject({ targetId: "id" });
    expect(parsePinBody({ ...good, title: "  標題  " })).toMatchObject({ title: "標題" });
  });

  it("多餘鍵回字串", () => {
    expect(typeof parsePinBody({ ...good, extra: 1 })).toBe("string");
  });

  it("href 不以 # 開頭回字串", () => {
    expect(typeof parsePinBody({ ...good, href: "/reading/case/王案" })).toBe("string");
    expect(typeof parsePinBody({ ...good, href: "https://example.com" })).toBe("string");
    expect(typeof parsePinBody({ ...good, href: "" })).toBe("string");
    expect(typeof parsePinBody({ ...good, href: 123 })).toBe("string");
    expect(typeof parsePinBody({ ...good, href: "#" + "a".repeat(300) })).toBe("string");
    expect(typeof parsePinBody({ ...good, href: "#" + "a".repeat(299) })).toBe("object");
  });

  it("dueDate 昨天／今天／＋366／＋367", () => {
    expect(typeof parsePinBody({ ...good, dueDate: due(-1) })).toBe("string");
    expect(typeof parsePinBody({ ...good, dueDate: today })).toBe("object");
    expect(typeof parsePinBody({ ...good, dueDate: due(366) })).toBe("object");
    expect(typeof parsePinBody({ ...good, dueDate: due(367) })).toBe("string");
  });

  it("空白 title、空白 targetId 回字串", () => {
    for (const bad of [
      null, [], "x", undefined,
      { ...good, targetKind: "zzz" },
      { ...good, targetId: "" },
      { ...good, targetId: "   " },
      { ...good, targetId: "a".repeat(201) },
      { ...good, targetId: 5 },
      { ...good, title: "" },
      { ...good, title: "   " },
      { ...good, title: "a".repeat(201) },
      { ...good, title: 5 },
      { ...good, dueDate: "2026-02-30" },
      { ...good, dueDate: "2026-2-3" },
      { ...good, dueDate: 20261113 },
    ]) {
      expect(typeof parsePinBody(bad), JSON.stringify(bad)).toBe("string");
    }
  });
});

describe("parseDue", () => {
  it("undefined → all；today → today；其他不合法", () => {
    expect(parseDue(undefined)).toBe("all");
    expect(parseDue("today")).toBe("today");
    for (const bad of ["", "all", "tomorrow", "TODAY", 1, ["today"], null]) {
      expect(parseDue(bad), JSON.stringify(bad)).toBeNull();
    }
  });
});
