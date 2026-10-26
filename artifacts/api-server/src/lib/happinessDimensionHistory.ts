// 每面向歷史：把 happiness_index_history 的六個 *_raw（百分位正規化之前）重算成
// 「當天原本會顯示在面向卡上的正規化分數」。
//
// 與 /api/dashboard 共用同一套規則（summarySources.ts 的 extractHappinessResult 也走這裡）：
//   - 視窗＝該列「之前」最近 PERCENTILE_WINDOW_DAYS 列（是「列」不是日曆天：漏快照的日子不會把視窗拉長）
//   - 視窗內該面向為 null 的列不計入；不足 MIN_HISTORY_DAYS_FOR_PERCENTILE 筆就退回原始分數（clamp 0-100 後四捨五入）
//   - 心智只取 MIND_COMBINED_SINCE 起的列（之前是日記篇數版，不同一把尺）
//   - 社交：評估日在 SOCIAL_V2_SINCE 當天或之後時，只取該日起的列（之前是 v1 公式：7 天窗口、封頂制，不同一把尺）
//   - 旅遊不排百分位，直接用原始分數（ABSOLUTE_DIMENSIONS）：旅遊分數在兩次旅行之間每天遞減，
//     拿今天跟過去排名幾乎天天是「近 90 天最低」＝0，與實際狀態對不起來（2026-10-26 卡片 0、走勢 74）。
//     旅遊公式本身就有絕對目標（3 天內回來＝滿分、180 天 20 天行程＝滿分、90 天 6 間美食＝滿分），原始分數即可讀。
// 這支檔只有純函式、不碰資料庫，方便單元測試。
import { PERCENTILE_WINDOW_DAYS, clamp, percentileRank, roundHalfUp } from "./happinessIndex";
import { MIND_COMBINED_SINCE } from "./mindCombined";

/** 社交分數改用 v2 公式（14 天窗口、同事降權、遞減報酬曲線，見 socialIndex.ts）的第一天。 */
export const SOCIAL_V2_SINCE = "2026-10-27";

/** 面向 key＝/api/dashboard 的 hhi 各面向 id（也是前端 homeDimensions.ts / buildHhiBreakdown 的 key）。 */
export const DIMENSION_KEYS = ["lifeFreedom", "fitness", "calm", "mind", "social", "travel"] as const;
export type DimensionKey = (typeof DIMENSION_KEYS)[number];

/** 某天（或某個視窗）六個面向的原始分數；calm 已是「100−忙碌指數」的方向。 */
export type DimensionRaws = Record<DimensionKey, number | null>;
export type DimensionScores = Record<DimensionKey, number | null>;
export type DimensionHistory = Record<DimensionKey, number[]>;

/** 不排百分位、直接顯示原始分數（clamp 0-100 後四捨五入）的面向；理由見檔頭。 */
export const ABSOLUTE_DIMENSIONS: ReadonlySet<DimensionKey> = new Set<DimensionKey>(["travel"]);

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

/**
 * 把一個視窗的列（順序不拘）整理成每面向的原始分數陣列。心智只取 MIND_COMBINED_SINCE 起的列。
 * asOfDate＝評估日（不給＝不做社交換尺的過濾）：評估日 ≥ SOCIAL_V2_SINCE 時，社交只取該日起的列。
 */
export function buildDimensionHistory(windowRows: RawHistoryRow[], asOfDate?: string): DimensionHistory {
  const socialRescaled = asOfDate !== undefined && String(asOfDate) >= SOCIAL_V2_SINCE;
  const out: DimensionHistory = { lifeFreedom: [], fitness: [], calm: [], mind: [], social: [], travel: [] };
  for (const row of windowRows) {
    const raws = rawsOfRow(row);
    for (const key of DIMENSION_KEYS) {
      if (key === "mind" && String(row.date) < MIND_COMBINED_SINCE) continue;
      if (key === "social" && socialRescaled && String(row.date) < SOCIAL_V2_SINCE) continue;
      const v = raws[key];
      if (isNum(v)) out[key].push(v);
    }
  }
  return out;
}

/** 單日：每個面向的原始分數對視窗排百分位（ABSOLUTE_DIMENSIONS 直接用原始分數）；原始分數為 null＝null。dashboard 與歷史接口共用。 */
export function normalizeDimensions(raws: DimensionRaws, history: DimensionHistory): DimensionScores {
  const out = {} as DimensionScores;
  for (const key of DIMENSION_KEYS) {
    const v = raws[key];
    if (!isNum(v)) out[key] = null;
    else out[key] = ABSOLUTE_DIMENSIONS.has(key) ? roundHalfUp(clamp(v, 0, 100)) : percentileRank(v, history[key]);
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
    const history = buildDimensionHistory(rowsAsc.slice(Math.max(0, i - windowDays), i), String(row.date));
    const scores = normalizeDimensions(rawsOfRow(row), history);
    if (String(row.date) < MIND_COMBINED_SINCE) scores.mind = null;
    const components = {} as DimensionScores;
    for (const key of DIMENSION_KEYS) components[key] = round1(scores[key]);
    result.push({ date: row.date, components });
  }
  return result;
}
