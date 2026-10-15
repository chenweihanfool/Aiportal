// 每面向歷史：把 happiness_index_history 的六個 *_raw（百分位正規化之前）重算成
// 「當天原本會顯示在面向卡上的正規化分數」。
//
// 與 /api/dashboard 共用同一套規則（summarySources.ts 的 extractHappinessResult 也走這裡）：
//   - 視窗＝該列「之前」最近 PERCENTILE_WINDOW_DAYS 列（是「列」不是日曆天：漏快照的日子不會把視窗拉長）
//   - 視窗內該面向為 null 的列不計入；不足 MIN_HISTORY_DAYS_FOR_PERCENTILE 筆就退回原始分數（clamp 0-100 後四捨五入）
//   - 心智只取 MIND_COMBINED_SINCE 起的列（之前是日記篇數版，不同一把尺）
// 這支檔只有純函式、不碰資料庫，方便單元測試。
import { PERCENTILE_WINDOW_DAYS, percentileRank } from "./happinessIndex";
import { MIND_COMBINED_SINCE } from "./mindCombined";

/** 面向 key＝/api/dashboard 的 hhi 各面向 id（也是前端 homeDimensions.ts / buildHhiBreakdown 的 key）。 */
export const DIMENSION_KEYS = ["lifeFreedom", "fitness", "calm", "mind", "social", "travel"] as const;
export type DimensionKey = (typeof DIMENSION_KEYS)[number];

/** 某天（或某個視窗）六個面向的原始分數；calm 已是「100−忙碌指數」的方向。 */
export type DimensionRaws = Record<DimensionKey, number | null>;
export type DimensionScores = Record<DimensionKey, number | null>;
export type DimensionHistory = Record<DimensionKey, number[]>;

/** happiness_index_history 一列裡本模組要用的欄位（欄名對照資料表）。 */
export interface RawHistoryRow {
  date: string;
  lifeFreedomRaw: number | null;
  fitnessHabitRaw: number | null;
  calmRaw: number | null;
  mindRaw: number | null;
  travelRaw: number | null;
  socialRaw: number | null;
}

export const EMPTY_DIMENSION_HISTORY: DimensionHistory = {
  lifeFreedom: [],
  fitness: [],
  calm: [],
  mind: [],
  social: [],
  travel: [],
};

export function rawsOfRow(row: RawHistoryRow): DimensionRaws {
  return {
    lifeFreedom: row.lifeFreedomRaw,
    fitness: row.fitnessHabitRaw,
    calm: row.calmRaw,
    mind: row.mindRaw,
    social: row.socialRaw,
    travel: row.travelRaw,
  };
}

const isNum = (v: number | null | undefined): v is number => typeof v === "number" && Number.isFinite(v);

/** 把一個視窗的列（順序不拘）整理成每面向的原始分數陣列。心智只取 MIND_COMBINED_SINCE 起的列。 */
export function buildDimensionHistory(windowRows: RawHistoryRow[]): DimensionHistory {
  const out: DimensionHistory = { lifeFreedom: [], fitness: [], calm: [], mind: [], social: [], travel: [] };
  for (const row of windowRows) {
    const raws = rawsOfRow(row);
    for (const key of DIMENSION_KEYS) {
      if (key === "mind" && String(row.date) < MIND_COMBINED_SINCE) continue;
      const v = raws[key];
      if (isNum(v)) out[key].push(v);
    }
  }
  return out;
}

/** 單日：每個面向的原始分數對視窗排百分位；原始分數為 null＝null。dashboard 與歷史接口共用。 */
export function normalizeDimensions(raws: DimensionRaws, history: DimensionHistory): DimensionScores {
  const out = {} as DimensionScores;
  for (const key of DIMENSION_KEYS) {
    const v = raws[key];
    out[key] = isNum(v) ? percentileRank(v, history[key]) : null;
  }
  return out;
}

// percentileRank 本身回整數，所以保留一位小數不會改值；留著是為了契約穩定。
const round1 = (v: number | null): number | null => (v === null ? null : Math.round(v * 10) / 10);

/**
 * 由舊到新排好的列（前面是暖機、後面是要回傳的），算出最後 `returnCount` 列各自的面向正規化分數。
 * 每一列的視窗只看它「之前」的 PERCENTILE_WINDOW_DAYS 列，所以不會偷看未來。
 * 心智在 MIND_COMBINED_SINCE 之前的列＝null（當時的 mind_raw 是不同一把尺，無法在現行規則下重算）。
 */
export function computeDimensionSeries(
  rowsAsc: RawHistoryRow[],
  returnCount: number,
  windowDays: number = PERCENTILE_WINDOW_DAYS
): Array<{ date: string; components: DimensionScores }> {
  const start = Math.max(0, rowsAsc.length - Math.max(0, Math.floor(returnCount)));
  const result: Array<{ date: string; components: DimensionScores }> = [];
  for (let i = start; i < rowsAsc.length; i++) {
    const row = rowsAsc[i]!;
    const history = buildDimensionHistory(rowsAsc.slice(Math.max(0, i - windowDays), i));
    const scores = normalizeDimensions(rawsOfRow(row), history);
    if (String(row.date) < MIND_COMBINED_SINCE) scores.mind = null;
    const components = {} as DimensionScores;
    for (const key of DIMENSION_KEYS) components[key] = round1(scores[key]);
    result.push({ date: row.date, components });
  }
  return result;
}
