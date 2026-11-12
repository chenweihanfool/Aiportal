import { describe, expect, it } from "vitest";
import { parseAfter, parseCorrectionBody } from "./knowledgeCorrections";

const TOPIC = "T20261112-01";

describe("parseCorrectionBody", () => {
  it("body 必須是物件；只接受五個鍵，多一個就擋", () => {
    expect(typeof parseCorrectionBody(null)).toBe("string");
    expect(typeof parseCorrectionBody("x")).toBe("string");
    expect(typeof parseCorrectionBody([])).toBe("string");
    expect(typeof parseCorrectionBody({ topicId: TOPIC, kind: "undo", claimId: "c123", extra: 1 })).toBe("string");
  });

  it("topicId 必須符合 ^T[0-9]{8}-[0-9]{2,4}$", () => {
    expect(typeof parseCorrectionBody({ kind: "undo", claimId: "c123" })).toBe("string");
    expect(typeof parseCorrectionBody({ topicId: "t20261112-01", kind: "undo", claimId: "c123" })).toBe("string");
    expect(typeof parseCorrectionBody({ topicId: "T2026111-01", kind: "undo", claimId: "c123" })).toBe("string");
    expect(typeof parseCorrectionBody({ topicId: "T20261112-1", kind: "undo", claimId: "c123" })).toBe("string");
    expect(typeof parseCorrectionBody({ topicId: "T20261112-12345", kind: "undo", claimId: "c123" })).toBe("string");
    expect(parseCorrectionBody({ topicId: TOPIC, kind: "undo", claimId: "c123" })).toEqual({
      topicId: TOPIC,
      claimId: "c123",
      kind: "undo",
      section: null,
      text: null,
    });
  });

  it("kind 只接受 wrong／fix／add／undo", () => {
    expect(typeof parseCorrectionBody({ topicId: TOPIC, kind: "retract", claimId: "c123" })).toBe("string");
    expect(typeof parseCorrectionBody({ topicId: TOPIC, claimId: "c123" })).toBe("string");
  });

  it("claimId：wrong／fix／undo 必填；add 可省略或 null，有給要合格式", () => {
    for (const kind of ["wrong", "undo"] as const) {
      expect(typeof parseCorrectionBody({ topicId: TOPIC, kind })).toBe("string");
      expect(typeof parseCorrectionBody({ topicId: TOPIC, kind, claimId: null })).toBe("string");
      expect(typeof parseCorrectionBody({ topicId: TOPIC, kind, claimId: "C123" })).toBe("string");
      expect(typeof parseCorrectionBody({ topicId: TOPIC, kind, claimId: "c12" })).toBe("string");
      expect(typeof parseCorrectionBody({ topicId: TOPIC, kind, claimId: "c123456" })).toBe("string");
    }
    expect(typeof parseCorrectionBody({ topicId: TOPIC, kind: "fix" })).toBe("string");
    expect(parseCorrectionBody({ topicId: TOPIC, kind: "add", text: "補充" })).toEqual({
      topicId: TOPIC,
      claimId: null,
      kind: "add",
      section: null,
      text: "補充",
    });
    expect(parseCorrectionBody({ topicId: TOPIC, kind: "add", claimId: null, text: "補充" })).toMatchObject({ claimId: null });
    expect(typeof parseCorrectionBody({ topicId: TOPIC, kind: "add", claimId: "c123", text: "補充" })).toBe("string");
  });

  it("text：fix／add 必填、去頭尾空白後 1–500 字、不得含換行", () => {
    expect(typeof parseCorrectionBody({ topicId: TOPIC, kind: "fix", claimId: "c123" })).toBe("string");
    expect(typeof parseCorrectionBody({ topicId: TOPIC, kind: "fix", claimId: "c123", text: "   " })).toBe("string");
    expect(parseCorrectionBody({ topicId: TOPIC, kind: "fix", claimId: "c123", text: " 改正 " })).toMatchObject({ text: "改正" });
    expect(parseCorrectionBody({ topicId: TOPIC, kind: "fix", claimId: "c123", text: "a".repeat(500) })).toMatchObject({ text: "a".repeat(500) });
    expect(typeof parseCorrectionBody({ topicId: TOPIC, kind: "fix", claimId: "c123", text: "a".repeat(501) })).toBe("string");
    expect(typeof parseCorrectionBody({ topicId: TOPIC, kind: "fix", claimId: "c123", text: "甲\n乙" })).toBe("string");
    expect(typeof parseCorrectionBody({ topicId: TOPIC, kind: "fix", claimId: "c123", text: "甲\r乙" })).toBe("string");
    expect(typeof parseCorrectionBody({ topicId: TOPIC, kind: "add", text: 3 })).toBe("string");
  });

  it("text：wrong／undo 不得帶非空 text（空白等於沒帶）", () => {
    expect(typeof parseCorrectionBody({ topicId: TOPIC, kind: "wrong", claimId: "c123", text: "不對" })).toBe("string");
    expect(typeof parseCorrectionBody({ topicId: TOPIC, kind: "undo", claimId: "c123", text: "撤回" })).toBe("string");
    expect(parseCorrectionBody({ topicId: TOPIC, kind: "wrong", claimId: "c123", text: "   " })).toMatchObject({ text: null });
    expect(parseCorrectionBody({ topicId: TOPIC, kind: "undo", claimId: "c123", text: null })).toMatchObject({ text: null });
  });

  it("section：只有 add 可帶，去頭尾空白後 1–40 字", () => {
    expect(parseCorrectionBody({ topicId: TOPIC, kind: "add", text: "補充", section: " 重點 " })).toMatchObject({ section: "重點" });
    expect(typeof parseCorrectionBody({ topicId: TOPIC, kind: "add", text: "補充", section: " " })).toBe("string");
    expect(typeof parseCorrectionBody({ topicId: TOPIC, kind: "add", text: "補充", section: "a".repeat(41) })).toBe("string");
    expect(typeof parseCorrectionBody({ topicId: TOPIC, kind: "add", text: "補充", section: 3 })).toBe("string");
    expect(typeof parseCorrectionBody({ topicId: TOPIC, kind: "wrong", claimId: "c123", section: "重點" })).toBe("string");
    expect(typeof parseCorrectionBody({ topicId: TOPIC, kind: "fix", claimId: "c123", text: "改正", section: "重點" })).toBe("string");
    expect(typeof parseCorrectionBody({ topicId: TOPIC, kind: "undo", claimId: "c123", section: "重點" })).toBe("string");
  });
});

describe("parseAfter", () => {
  it("缺省為 0，非負整數字串才接受", () => {
    expect(parseAfter(undefined)).toBe(0);
    expect(parseAfter("0")).toBe(0);
    expect(parseAfter("42")).toBe(42);
    for (const bad of ["", "-1", "1.5", "abc", " 1", "1 ", "1e3", ["1"], null, 1]) {
      expect(typeof parseAfter(bad), String(bad)).toBe("string");
    }
    expect(typeof parseAfter("99999999999999999999")).toBe("string");
  });
});
