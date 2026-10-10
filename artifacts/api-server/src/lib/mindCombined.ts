// 🧮 心智分數（合成版，並行中）：0.8 × 想法分數 ＋ 0.2 × 每日報告分數。
// 使用者 2026-10-10：「心智分數根據每日報告分數20%+現有想法分數80%計算」。
// 想法分數是主體：沒有想法分數就不算；當天沒有日報分數（沒寫日記、舊日報沒有 📊 段）就只用想法分數。
// 只存不用：與想法版一樣先並行，10/23 一起評估是否取代現行心智分數。

export const MIND_IDEAS_WEIGHT = 0.8;
export const MIND_REPORT_WEIGHT = 0.2;

export function combineMind(ideas: number | null, report: number | null): number | null {
  if (ideas === null || !Number.isFinite(ideas)) return null;
  if (report === null || !Number.isFinite(report)) return Math.round(ideas * 10) / 10;
  return Math.round((MIND_IDEAS_WEIGHT * ideas + MIND_REPORT_WEIGHT * report) * 10) / 10;
}
