import { describe, expect, it } from "vitest";
import { DIMENSION_KEYS, SOCIAL_V2_SINCE, computeDimensionSeries, scoresOfRaws, type RawHistoryRow } from "./happinessDimensionHistory";
import { MIND_V3_SINCE } from "./mindCombined";

const row = (date: string, v: number | null): RawHistoryRow => ({
  date, lifeFreedomRaw: v, fitnessHabitRaw: v, calmRaw: v, mindRaw: v, travelRaw: v, socialRaw: v,
});

describe("scoresOfRaws", () => {
  it("面向分數就是公式分：clamp 0-100、四捨五入；null 仍是 null", () => {
    expect(scoresOfRaws({ lifeFreedom: 67.5, fitness: 120, calm: -3, mind: 74.4, social: null, travel: 72 }))
      .toEqual({ lifeFreedom: 68, fitness: 100, calm: 0, mind: 74, social: null, travel: 72 });
  });
});

describe("computeDimensionSeries", () => {
  it("長期維持同樣的水準，分數不會掉回中間（滾動排名的問題）", () => {
    const rows = Array.from({ length: 30 }, (_, i) => row(`2026-11-${String(i + 1).padStart(2, "0")}`, 80));
    for (const s of computeDimensionSeries(rows, 30)) expect(s.components.fitness).toBe(80);
  });

  it("只回最後 returnCount 列；比資料多就全回；0 回空", () => {
    const rows = ["2026-11-01", "2026-11-02", "2026-11-03"].map((d, i) => row(d, i));
    expect(computeDimensionSeries(rows, 2).map((s) => s.date)).toEqual(["2026-11-02", "2026-11-03"]);
    expect(computeDimensionSeries(rows, 9)).toHaveLength(3);
    expect(computeDimensionSeries(rows, 0)).toEqual([]);
    expect(computeDimensionSeries([], 5)).toEqual([]);
  });

  it("不同一把尺的舊列是 null，不換算：心智 MIND_V3_SINCE、社交 SOCIAL_V2_SINCE 之前", () => {
    const [before, after] = computeDimensionSeries([row("2026-10-20", 90), row(MIND_V3_SINCE, 90)], 2);
    expect(before!.components).toMatchObject({ mind: null, social: null, fitness: 90 });
    expect(after!.components).toMatchObject({ mind: 90, social: 90 });
    const [s] = computeDimensionSeries([row(SOCIAL_V2_SINCE, 50)], 1);
    expect(s!.components).toMatchObject({ mind: null, social: 50 });
  });

  it("每天六個 key 都在", () => {
    const [s] = computeDimensionSeries([row("2026-11-01", null)], 1);
    expect(Object.keys(s!.components).sort()).toEqual([...DIMENSION_KEYS].sort());
  });
});
