import { describe, expect, it } from "vitest";
import {
  DIMENSION_KEYS,
  buildDimensionHistory,
  computeDimensionSeries,
  normalizeDimensions,
  rawsOfRow,
  type DimensionKey,
  type RawHistoryRow,
} from "./happinessDimensionHistory";
import { MIN_HISTORY_DAYS_FOR_PERCENTILE, PERCENTILE_WINDOW_DAYS, percentileRank } from "./happinessIndex";
import { MIND_COMBINED_SINCE } from "./mindCombined";
import { TRAVEL_TRIPS_SINCE } from "./happinessDimensionHistory";

// 從 MIND_COMBINED_SINCE 起連續的日期（心智也走百分位路徑）
const dateAt = (i: number, base = MIND_COMBINED_SINCE) => {
  const [y, m, d] = base.split("-").map(Number);
  return new Date(Date.UTC(y!, m! - 1, d! + i)).toISOString().slice(0, 10);
};
const KEY_TO_COL: Record<DimensionKey, keyof RawHistoryRow> = {
  lifeFreedom: "lifeFreedomRaw",
  fitness: "fitnessHabitRaw",
  calm: "calmRaw",
  mind: "mindRaw",
  social: "socialRaw",
  travel: "travelRaw",
};
const row = (date: string, raws: Partial<Record<DimensionKey, number | null>> = {}): RawHistoryRow => {
  const r: RawHistoryRow = {
    date, lifeFreedomRaw: null, fitnessHabitRaw: null, calmRaw: null, mindRaw: null, travelRaw: null, socialRaw: null,
  };
  for (const k of DIMENSION_KEYS) (r as unknown as Record<string, unknown>)[KEY_TO_COL[k]] = raws[k] ?? null;
  return r;
};
const rawAt = (i: number, k: DimensionKey): number | null => {
  if (k === "social" && i % 7 === 3) return null;
  const mul = { lifeFreedom: 37, fitness: 53, calm: 29, mind: 17, social: 41, travel: 13 }[k];
  return (i * mul + 5) % 101;
};
const makeRows = (n: number, base = MIND_COMBINED_SINCE): RawHistoryRow[] =>
  Array.from({ length: n }, (_, i) =>
    row(dateAt(i, base), Object.fromEntries(DIMENSION_KEYS.map((k) => [k, rawAt(i, k)])) as Record<DimensionKey, number | null>));

describe("computeDimensionSeries", () => {
  it("(a) equals percentileRank over the previous 90 non-null raws, for every day and dimension", () => {
    const rows = makeRows(150);
    const series = computeDimensionSeries(rows, 150);
    expect(series).toHaveLength(150);
    series.forEach((s, i) => {
      expect(s.date).toBe(rows[i]!.date);
      for (const k of DIMENSION_KEYS) {
        const v = rawAt(i, k);
        if (v === null) { expect(s.components[k]).toBeNull(); continue; }
        const hist: number[] = [];
        for (let j = Math.max(0, i - PERCENTILE_WINDOW_DAYS); j < i; j++) {
          if (k === "travel" && s.date >= TRAVEL_TRIPS_SINCE && rows[j]!.date < TRAVEL_TRIPS_SINCE) continue; // 旅遊換尺
          const x = rawAt(j, k);
          if (x !== null) hist.push(x);
        }
        expect(s.components[k], `${s.date} ${k}`).toBe(percentileRank(v, hist));
      }
    });
  });

  it("(a) matches the dashboard path: normalizeDimensions(today's raws, buildDimensionHistory(previous rows))", () => {
    const rows = makeRows(120);
    const i = 119;
    const dash = normalizeDimensions(rawsOfRow(rows[i]!), buildDimensionHistory(rows.slice(i - PERCENTILE_WINDOW_DAYS, i), rows[i]!.date));
    expect(computeDimensionSeries(rows, 1)[0]!.components).toEqual(dash);
  });

  it("(b) falls back to the raw score (rounded, clamped) when fewer than MIN_HISTORY_DAYS_FOR_PERCENTILE rows precede", () => {
    const rows = makeRows(MIN_HISTORY_DAYS_FOR_PERCENTILE + 1);
    const s = computeDimensionSeries(rows, rows.length);
    // 前 10 天（前史 0..9 筆）＝原始分數本身
    for (let i = 0; i < MIN_HISTORY_DAYS_FOR_PERCENTILE; i++) expect(s[i]!.components.lifeFreedom).toBe(rawAt(i, "lifeFreedom"));
    // 第 11 筆起（前史剛好 10 筆）才排百分位
    const hist = Array.from({ length: 10 }, (_, j) => rawAt(j, "lifeFreedom")!);
    expect(s[10]!.components.lifeFreedom).toBe(percentileRank(rawAt(10, "lifeFreedom")!, hist));
    // 超出 0-100 的原始值被 clamp
    expect(computeDimensionSeries([row(MIND_COMBINED_SINCE, { calm: 130.4, fitness: -3 })], 1)[0]!.components)
      .toMatchObject({ calm: 100, fitness: 0 });
  });

  it("(b) a dimension's null days do not count toward the minimum history", () => {
    // 社交只有 9 天有值 → 第 10 天仍退回原始分數；其他面向有 10+ 天已經排百分位
    const rows = Array.from({ length: 12 }, (_, i) => row(dateAt(i), { lifeFreedom: i * 5, social: i < 9 ? 50 : i === 9 ? null : 20 }));
    const s = computeDimensionSeries(rows, 12);
    expect(s[10]!.components.social).toBe(percentileRank(20, Array(9).fill(50)));
    expect(s[10]!.components.social).toBe(20); // 9 筆 < 10 → 退回原始值
    expect(s[10]!.components.lifeFreedom).toBe(percentileRank(50, [0, 5, 10, 15, 20, 25, 30, 35, 40, 45]));
  });

  it("(c) null stays null (not 0) and does not enter the window of other days", () => {
    const rows = makeRows(30);
    const s = computeDimensionSeries(rows, 30);
    s.forEach((x, i) => { if (i % 7 === 3) expect(x.components.social).toBeNull(); else expect(x.components.social).not.toBeNull(); });
  });

  it("(c) a missing calendar day shortens nothing: the window counts rows, not days", () => {
    const base = makeRows(100);
    const gapped = base.filter((_, i) => i !== 50); // 少一天
    const a = computeDimensionSeries(gapped, 1)[0]!;
    const hist = gapped.slice(gapped.length - 1 - PERCENTILE_WINDOW_DAYS, gapped.length - 1);
    expect(a.components).toEqual(normalizeDimensions(rawsOfRow(gapped.at(-1)!), buildDimensionHistory(hist, gapped.at(-1)!.date)));
  });

  it("(c) all-null rows, a single row, empty input, returnCount 0", () => {
    expect(computeDimensionSeries([row(dateAt(0))], 5)).toEqual([
      { date: dateAt(0), components: { lifeFreedom: null, fitness: null, calm: null, mind: null, social: null, travel: null } },
    ]);
    const one = computeDimensionSeries([row(dateAt(0), { travel: 42.4 })], 1);
    expect(one).toHaveLength(1);
    expect(one[0]!.components.travel).toBe(42);
    expect(computeDimensionSeries([], 30)).toEqual([]);
    expect(computeDimensionSeries(makeRows(5), 0)).toEqual([]);
  });

  it("(c) returnCount larger than the data returns everything; smaller returns only the tail", () => {
    const rows = makeRows(40);
    expect(computeDimensionSeries(rows, 365)).toHaveLength(40);
    const tail = computeDimensionSeries(rows, 7);
    expect(tail.map((t) => t.date)).toEqual(rows.slice(-7).map((r) => r.date));
    // 只回尾巴，數值與完整計算一致（暖機列有被用到）
    expect(tail).toEqual(computeDimensionSeries(rows, 40).slice(-7));
  });

  it("(c) 365 days x 6 dimensions finishes in milliseconds", () => {
    const rows = makeRows(365 + PERCENTILE_WINDOW_DAYS);
    const t0 = performance.now();
    const s = computeDimensionSeries(rows, 365);
    const ms = performance.now() - t0;
    expect(s).toHaveLength(365);
    expect(ms).toBeLessThan(200);
  });

  it("(d) changing raws after day i never changes day i or earlier", () => {
    const rows = makeRows(140);
    const before = computeDimensionSeries(rows, 140);
    const mutated = rows.map((r, i) => (i >= 100 ? row(r.date, Object.fromEntries(DIMENSION_KEYS.map((k) => [k, 99 - i % 3])) as Record<DimensionKey, number>) : r));
    const after = computeDimensionSeries(mutated, 140);
    expect(after.slice(0, 100)).toEqual(before.slice(0, 100));
    expect(after.slice(100)).not.toEqual(before.slice(100));
    // 窗口外的舊資料改了也不影響：改動第 0 列只影響它之後 90 列內的天數
    const mutatedOld = rows.map((r, i) => (i === 0 ? row(r.date, { lifeFreedom: 100 }) : r));
    const afterOld = computeDimensionSeries(mutatedOld, 140);
    expect(afterOld.slice(PERCENTILE_WINDOW_DAYS + 1)).toEqual(before.slice(PERCENTILE_WINDOW_DAYS + 1));
  });

  it("mind: rows before MIND_COMBINED_SINCE are excluded from the window and shown as null", () => {
    // 前 20 列是舊版（日記篇數版）mind_raw=100，之後 15 列 mind_raw=10
    const rows = [
      ...Array.from({ length: 20 }, (_, i) => row(dateAt(i - 20), { mind: 100, calm: 50 })),
      ...Array.from({ length: 15 }, (_, i) => row(dateAt(i), { mind: 10, calm: 50 })),
    ];
    const s = computeDimensionSeries(rows, rows.length);
    expect(s.slice(0, 20).every((x) => x.components.mind === null)).toBe(true);
    // 舊列不算進心智視窗：第 11 筆新列（前史 10 筆都是 10）→ 10 >= 全部 → 100，而不是被 100 的舊列拉低
    expect(s[20 + 10]!.components.mind).toBe(100);
    // 但其他面向（calm）不受心智切換影響，照常用舊列當前史
    expect(s[20]!.components.calm).toBe(percentileRank(50, Array(20).fill(50)));
  });

  describe("旅遊換尺（TRAVEL_TRIPS_SINCE）", () => {
    const old = (n: number) => Array.from({ length: n }, (_, i) => row(dateAt(i - n, TRAVEL_TRIPS_SINCE), { travel: 77 + (i % 24) }));

    it("評估日在換尺日當天或之後：舊來源的列不進旅遊歷史，新資料不足 10 天就退回原始分數（不再是 0）", () => {
      const hist = buildDimensionHistory(old(80), TRAVEL_TRIPS_SINCE);
      expect(hist.travel).toEqual([]);
      expect(normalizeDimensions({ ...rawsOfRow(row(TRAVEL_TRIPS_SINCE)), travel: 74 }, hist).travel).toBe(74);
    });

    it("沒有舊歷史的過濾時（舊行為）：74 低於所有舊值＝0——這就是這次的症狀", () => {
      const hist = buildDimensionHistory(old(80));
      expect(normalizeDimensions({ ...rawsOfRow(row(TRAVEL_TRIPS_SINCE)), travel: 74 }, hist).travel).toBe(0);
    });

    it("評估日早於換尺日：行為不變（舊來源歷史照舊排百分位），其他面向也不受影響", () => {
      const rows = old(80);
      const before = buildDimensionHistory(rows, dateAt(-1, TRAVEL_TRIPS_SINCE));
      expect(before.travel.length).toBe(80);
      const none = buildDimensionHistory(rows.map((r) => ({ ...r, calmRaw: 50 })), TRAVEL_TRIPS_SINCE);
      expect(none.calm.length).toBe(80);
    });

    it("換尺日起累積的列照常進歷史，滿 10 筆後才排百分位", () => {
      const fresh = Array.from({ length: 10 }, (_, i) => row(dateAt(i, TRAVEL_TRIPS_SINCE), { travel: 70 + i }));
      const hist = buildDimensionHistory([...old(80), ...fresh], dateAt(10, TRAVEL_TRIPS_SINCE));
      expect(hist.travel).toHaveLength(10);
      expect(normalizeDimensions({ ...rawsOfRow(row(dateAt(10, TRAVEL_TRIPS_SINCE))), travel: 74 }, hist).travel).toBe(50);
    });
  });
});
