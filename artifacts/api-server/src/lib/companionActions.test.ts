import { describe, expect, it } from "vitest";
import { parseActionBody, parsePersonName, taipeiToday } from "./companionActions";

const TODAY = "2026-11-07";

describe("parsePersonName", () => {
  it("空、純空白、超過 60 字、非字串都擋；正常去前後空白", () => {
    expect(parsePersonName("")).toBeNull();
    expect(parsePersonName("   ")).toBeNull();
    expect(parsePersonName("a".repeat(61))).toBeNull();
    expect(parsePersonName(5)).toBeNull();
    expect(parsePersonName(" 王小明 ")).toBe("王小明");
    expect(parsePersonName("a".repeat(60))).toBe("a".repeat(60));
  });
});

describe("parseActionBody", () => {
  it("action 非法或 body 不是物件 → 錯誤字串", () => {
    expect(typeof parseActionBody(null, TODAY)).toBe("string");
    expect(typeof parseActionBody({ action: "x" }, TODAY)).toBe("string");
    expect(typeof parseActionBody({}, TODAY)).toBe("string");
  });
  it("snooze：要合法 until 且不早於今天", () => {
    expect(typeof parseActionBody({ action: "snooze" }, TODAY)).toBe("string");
    expect(typeof parseActionBody({ action: "snooze", until: "2026/12/01" }, TODAY)).toBe("string");
    expect(typeof parseActionBody({ action: "snooze", until: "2026-02-30" }, TODAY)).toBe("string");
    expect(typeof parseActionBody({ action: "snooze", until: "2026-11-06" }, TODAY)).toBe("string");
    expect(parseActionBody({ action: "snooze", until: "2026-11-07", reason: "x" }, TODAY)).toEqual({ action: "snooze", until: "2026-11-07", reason: null });
    expect(parseActionBody({ action: "snooze", until: "2026-12-07" }, TODAY)).toEqual({ action: "snooze", until: "2026-12-07", reason: null });
  });
  it("contacted 忽略 until 與 reason", () => {
    expect(parseActionBody({ action: "contacted", until: "bad", reason: "x" }, TODAY)).toEqual({ action: "contacted", until: null, reason: null });
  });
  it("never 保留 reason（可空、≤60 字），忽略 until", () => {
    expect(parseActionBody({ action: "never", reason: "已故", until: "2026-12-01" }, TODAY)).toEqual({ action: "never", until: null, reason: "已故" });
    expect(parseActionBody({ action: "never" }, TODAY)).toEqual({ action: "never", until: null, reason: null });
    expect(parseActionBody({ action: "never", reason: "  " }, TODAY)).toEqual({ action: "never", until: null, reason: null });
    expect(typeof parseActionBody({ action: "never", reason: "a".repeat(61) }, TODAY)).toBe("string");
    expect(typeof parseActionBody({ action: "never", reason: 3 }, TODAY)).toBe("string");
  });
});

describe("taipeiToday", () => {
  it("UTC 16:00 之後已是台北隔天", () => {
    expect(taipeiToday(new Date("2026-11-06T15:59:00Z"))).toBe("2026-11-06");
    expect(taipeiToday(new Date("2026-11-06T16:00:00Z"))).toBe("2026-11-07");
  });
});
