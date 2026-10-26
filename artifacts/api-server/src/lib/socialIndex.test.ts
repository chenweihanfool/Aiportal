import { describe, expect, it } from "vitest";
import { computeSocialIndex } from "./socialIndex";

const base = { observedDayCount: 14, distinctPersonCount: 0, weightedInteractionPoints: 0, daysWithInteraction: 0 };

describe("computeSocialIndex（v2：14 天窗口、遞減報酬曲線）", () => {
  it("returns all-null (資料準備中) when there are zero observed days", () => {
    expect(computeSocialIndex({ ...base, observedDayCount: 0, distinctPersonCount: 3, weightedInteractionPoints: 10, daysWithInteraction: 2 })).toEqual({
      breadthScore: null,
      intensityScore: null,
      connectionRateScore: null,
      socialScore: null,
    });
  });

  it("observedDayCount >= 1 but zero interactions -> socialScore is a real 0, not missing", () => {
    expect(computeSocialIndex({ ...base, observedDayCount: 5 })).toEqual({
      breadthScore: 0,
      intensityScore: 0,
      connectionRateScore: 0,
      socialScore: 0,
    });
  });

  it("廣度＝100 × (1 − e^(−人數/4))：不封頂，多一個人還看得出差別", () => {
    const b = (n: number) => computeSocialIndex({ ...base, distinctPersonCount: n }).breadthScore;
    expect([b(1), b(2), b(4), b(5), b(8), b(12)]).toEqual([22, 39, 63, 71, 86, 95]);
  });

  it("強度＝100 × (1 − e^(−點數/20))，點數可以是小數（同事降權後）", () => {
    const i = (p: number) => computeSocialIndex({ ...base, weightedInteractionPoints: p }).intensityScore;
    expect([i(0.25), i(10), i(20), i(40)]).toEqual([1, 39, 63, 86]);
  });

  it("連結率＝有（非同事）互動的天數 ÷ 觀測日數，最多 100", () => {
    expect(computeSocialIndex({ ...base, observedDayCount: 10, daysWithInteraction: 7 }).connectionRateScore).toBe(70);
    expect(computeSocialIndex({ ...base, observedDayCount: 3, daysWithInteraction: 5 }).connectionRateScore).toBe(100);
  });

  it("綜合＝0.35 廣度 + 0.35 強度 + 0.30 連結率，四捨五入", () => {
    // 廣度 4 人 63、強度 20 點 63、連結率 7/14＝50 → 0.35×63 + 0.35×63 + 0.3×50 = 59.1
    const r = computeSocialIndex({ observedDayCount: 14, distinctPersonCount: 4, weightedInteractionPoints: 20, daysWithInteraction: 7 });
    expect(r.socialScore).toBe(59);
  });

  it("一般忙碌的兩週不會頂到 100（v1 的症狀：5 人＋15 點就滿分）", () => {
    const r = computeSocialIndex({ observedDayCount: 14, distinctPersonCount: 5, weightedInteractionPoints: 15, daysWithInteraction: 10 });
    expect(r.socialScore).toBeLessThan(80);
  });
});
