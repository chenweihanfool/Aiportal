import { describe, expect, it } from "vitest";
import type { HermesIdea } from "@workspace/db";
import { dayAdjustOf, dayCounter, dayScoreOf, tasksByDateOf } from "./dailyScore";

const flat = (v: number, n = 28) => Array<number>(n).fill(v);

describe("dayScoreOf", () => {
  it("80% 成果＋20% AI，與前端同一組例子", () => {
    expect(dayScoreOf({ tasks: 4, ideasNew: 1, ideasDone: 0 }, 60)).toMatchObject({ total: 67, achievement: 69, points: 5 });
  });
  it("實行算兩點；沒有 AI 自評只用成果分", () => {
    expect(dayScoreOf({ tasks: 0, ideasNew: 0, ideasDone: 1 }, null)).toMatchObject({ points: 2, total: 37 });
  });
});

describe("dayCounter", () => {
  const idea = (bornAt: string, history: Array<{ status: string; at: string }>) => ({ bornAt, history }) as unknown as HermesIdea;
  it("bornAt 算新想法；只算第一次 done", () => {
    const at = dayCounter(
      [idea("2026-10-01T09:00:00+08:00", [{ status: "done", at: "2026-10-03T10:00:00+08:00" }, { status: "done", at: "2026-10-05T10:00:00+08:00" }])],
      new Map([["2026-10-03", 2]]),
    );
    expect(at("2026-10-01")).toEqual({ tasks: 0, ideasNew: 1, ideasDone: 0 });
    expect(at("2026-10-03")).toEqual({ tasks: 2, ideasNew: 0, ideasDone: 1 });
    expect(at("2026-10-05").ideasDone).toBe(0);
  });
  it("回補想法的 done 是補登日，不算實行", () => {
    const at = dayCounter([{ ...idea("2026-01-01", [{ status: "done", at: "2026-10-09" }]), backfill: true }], new Map());
    expect(at("2026-10-09").ideasDone).toBe(0);
    expect(at("2026-01-01").ideasNew).toBe(1);
  });
  it("history 裡非 done 的狀態不算實行", () => {
    const at = dayCounter([idea("2026-10-01", [{ status: "doing", at: "2026-10-02" }])], new Map());
    expect(at("2026-10-02").ideasDone).toBe(0);
  });
});

describe("tasksByDateOf", () => {
  it("格式不對回 null，不是空的", () => {
    expect(tasksByDateOf(null)).toBeNull();
    expect(tasksByDateOf({ days: "x" })).toBeNull();
    expect(tasksByDateOf({ days: [{ date: "2026-10-01", count: 3 }] })?.get("2026-10-01")).toBe(3);
  });
});

describe("dayAdjustOf", () => {
  it("比平常高 20 分 → +3", () => {
    expect(dayAdjustOf(70, flat(50), true)).toEqual({ baseline: 50, adjust: 3 });
  });
  it("平常的一天 → 0", () => {
    expect(dayAdjustOf(50, flat(50), true).adjust).toBe(0);
  });
  it("上下限 ±6", () => {
    expect(dayAdjustOf(100, flat(20), true).adjust).toBe(6);
    expect(dayAdjustOf(0, flat(80), true).adjust).toBe(-6);
  });
  it("一天還沒結束只加不扣", () => {
    expect(dayAdjustOf(10, flat(50), false).adjust).toBe(0);
    expect(dayAdjustOf(70, flat(50), false).adjust).toBe(3);
    expect(dayAdjustOf(10, flat(50), true).adjust).toBe(-6);
  });
  it("基準不足 7 天不修正", () => {
    expect(dayAdjustOf(90, flat(50, 6), true)).toEqual({ baseline: null, adjust: 0 });
  });
});
