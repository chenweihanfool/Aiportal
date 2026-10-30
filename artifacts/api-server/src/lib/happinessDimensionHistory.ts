// 每面向分數：happiness_index_history 的六個 *_raw 就是面向分數（公式算出的 0–100 絕對分）。
//
// 2026-10-30 統一標準（使用者：「6大面向分數意義不同 有些是百分比 有些是分數 應該統一標準 我覺得用分數」）：
// 拿掉滾動 90 天排名，六個面向都直接用公式分，每個分數都有自己的滿分條件，長期進步看得到。
// 原本想替財務、身體、從容加一條校準線，但實際分布（2026-09-03～10-29，HERMES 回報）是財務 P10 63.5／P50 67／P90 69、
// 身體 32／56／75、從容 57／63／86：中位數本來就接近，財務的窄幅波動再拉開只會放大雜訊，所以不校準。
//
// 不同一把尺的舊列顯示 null，不換算：
//   - 社交 SOCIAL_V2_SINCE 之前是 v1 公式（7 天窗口、封頂制）
//   - 心智 MIND_V3_SINCE 之前的想法分數飽和（連續 20 天 100），分數等於只看 AI 自評
// 這支檔只有純函式、不碰資料庫，方便單元測試。
import { clamp, roundHalfUp } from "./happinessIndex";
import { MIND_V3_SINCE } from "./mindCombined";

/** 社交分數改用 v2 公式（14 天窗口、同事降權、遞減報酬曲線，見 socialIndex.ts）的第一天。 */
export const SOCIAL_V2_SINCE = "2026-10-27";

/** 面向 key＝/api/dashboard 的 hhi 各面向 id（也是前端 homeDimensions.ts / buildHhiBreakdown 的 key）。 */
export const DIMENSION_KEYS = ["lifeFreedom", "fitness", "calm", "mind", "social", "travel"] as const;
export type DimensionKey = (typeof DIMENSION_KEYS)[number];

/** 某天六個面向的原始分數；calm 已是「100−忙碌指數」的方向。 */
export type DimensionRaws = Record<DimensionKey, number | null>;
export type DimensionScores = Record<DimensionKey, number | null>;

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

/** 原始分數 → 面向分數（clamp 0-100 後四捨五入）；原始分數為 null＝null。dashboard 與歷史接口共用。 */
export function scoresOfRaws(raws: DimensionRaws): DimensionScores {
  const out = {} as DimensionScores;
  for (const key of DIMENSION_KEYS) {
    const v = raws[key];
    out[key] = isNum(v) ? roundHalfUp(clamp(v, 0, 100)) : null;
  }
  return out;
}

/** 由舊到新排好的列，回傳最後 `returnCount` 列的面向分數；不同一把尺的舊列為 null（見檔頭）。 */
export function computeDimensionSeries(
  rowsAsc: RawHistoryRow[],
  returnCount: number
): Array<{ date: string; components: DimensionScores }> {
  const start = Math.max(0, rowsAsc.length - Math.max(0, Math.floor(returnCount)));
  return rowsAsc.slice(start).map((row) => {
    const date = String(row.date);
    const components = scoresOfRaws(rawsOfRow(row));
    if (date < MIND_V3_SINCE) components.mind = null;
    if (date < SOCIAL_V2_SINCE) components.social = null;
    return { date: row.date, components };
  });
}
