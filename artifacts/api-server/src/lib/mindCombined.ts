// 🧮 心智分數：0.8 × 想法分數 ＋ 0.2 × 每日報告分數（幸福指數的心智維度，2026-10-10 起）。
// 使用者 2026-10-10：「心智分數根據每日報告分數20%+現有想法分數80%計算」→「直接採用今天的最新合成版 可直接上線 舊的就不要了」。
// 取代原本的「近 3 天日記篇數」（dailyEngagementScore）。
// 想法分數是主體：沒有想法分數就不算；沒有日報分數（沒寫日記、舊日報沒有 📊 段）就只用想法分數。
// 日報分數取「最新一份」：今天的日報 22:00 產出、隔天早上才推上入口網，所以白天與 23:55 快照通常用的是昨天那份。
import type { ReportScore } from "./reportScore";

export const MIND_IDEAS_WEIGHT = 0.8;
export const MIND_REPORT_WEIGHT = 0.2;
/** 這天起 happiness_index_history.mind_raw 存的是合成版；之前是日記篇數版，不拿來當百分位歷史。 */
export const MIND_COMBINED_SINCE = "2026-10-10";

export interface CombinedMind {
  score: number | null;
  ideas: number | null;
  report: (ReportScore & { date: string }) | null;
}

export function combineMind(ideas: number | null, report: number | null): number | null {
  if (ideas === null || !Number.isFinite(ideas)) return null;
  if (report === null || !Number.isFinite(report)) return Math.round(ideas * 10) / 10;
  return Math.round((MIND_IDEAS_WEIGHT * ideas + MIND_REPORT_WEIGHT * report) * 10) / 10;
}

/** 今天的日報分數優先，沒有就用昨天的；都沒有＝null。 */
export function pickLatestReport(reports: Map<string, ReportScore>, today: string, yesterday: string): (ReportScore & { date: string }) | null {
  for (const d of [today, yesterday]) {
    const s = reports.get(d);
    if (s) return { date: d, ...s };
  }
  return null;
}
