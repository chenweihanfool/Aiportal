// 每日評分（後端版）與它跟幸福指數的連結：日分修正。純函式，資料庫讀取在 dailyScoreSource.ts。
// 使用者 2026-10-30：「每日分數應該跟當日幸福度掛勾 目前似乎沒有關聯 幫我設計」。
// 幸福指數是存量（窗口長，當天做什麼幾乎動不了它），每日評分是當天流量；兩者分開算，再用一項修正連起來：
//   修正＝(今日分 − 自己近 28 天平均) × 0.15，上下限 ±6
// 平常的一天等於 0，比平常好就加、比平常差就減。23:55 快照前一天還沒過完，只加不扣（早上分數一定低）。
//
// 評分公式與前端 gis-portal/src/dailyScore.ts 相同（時間軸要逐日現算，兩邊各一份）；
// 常數一致由 gis-portal 的 dailyScore.test.ts 讀這支檔比對。
import type { HermesIdea } from "@workspace/db";
import { HAPPINESS_CONFIG, clamp, type HappinessConfig } from "./happinessIndex";

export const ACHIEVEMENT_WEIGHT = 0.8;
export const AI_WEIGHT = 0.2;
export const IDEA_DONE_POINTS = 2;
export const HALF_POINTS = 3;
/** 基準線至少要幾天才修正；不足時修正為 0 */
export const MIN_BASELINE_DAYS = 7;

export interface DayCounts { tasks: number; ideasNew: number; ideasDone: number }

export interface DayScore {
  total: number;
  achievement: number;
  points: number;
  counts: DayCounts;
  /** 日報 📊 分數；那天沒有＝null，總分只用成果分 */
  ai: number | null;
}

export function dayScoreOf(counts: DayCounts, ai: number | null): DayScore {
  const points = counts.tasks + counts.ideasNew + IDEA_DONE_POINTS * counts.ideasDone;
  const achievement = Math.round(100 * (1 - 0.5 ** (Math.max(0, points) / HALF_POINTS)));
  const total = ai === null ? achievement : ACHIEVEMENT_WEIGHT * achievement + AI_WEIGHT * ai;
  return { total: Math.round(total), achievement, points, counts, ai };
}

const DATE = /^\d{4}-\d{2}-\d{2}$/;

/** 計數規則與前端 milestones.dailyIndex 相同：bornAt 那天算新想法，history 第一次 done 那天算實行（回補想法的 done 是補登日，不算） */
export function dayCounter(ideas: HermesIdea[], tasksByDate: Map<string, number>): (date: string) => DayCounts {
  const born = new Map<string, number>();
  const done = new Map<string, number>();
  const bump = (m: Map<string, number>, k: string) => m.set(k, (m.get(k) ?? 0) + 1);
  for (const it of ideas) {
    const b = String(it.bornAt ?? "").slice(0, 10);
    if (DATE.test(b)) bump(born, b);
    const first = it.backfill ? undefined : (it.history ?? []).filter((h) => h.status === "done").map((h) => String(h.at ?? "").slice(0, 10)).filter((d) => DATE.test(d)).sort()[0];
    if (first) bump(done, first);
  }
  return (date) => ({ tasks: tasksByDate.get(date) ?? 0, ideasNew: born.get(date) ?? 0, ideasDone: done.get(date) ?? 0 });
}

/** feed tasks-done 的 payload → 日期對完成數；格式不對回 null（當成讀不到，不是 0） */
export function tasksByDateOf(payload: unknown): Map<string, number> | null {
  const days = (payload as { days?: unknown } | null)?.days;
  if (!Array.isArray(days)) return null;
  const out = new Map<string, number>();
  for (const d of days as Array<{ date?: unknown; count?: unknown }>) {
    if (typeof d?.date === "string" && typeof d.count === "number") out.set(d.date, d.count);
  }
  return out;
}

export interface DayLink extends DayScore {
  /** 近 28 天平均；基準天數不足＝null */
  baseline: number | null;
  /** 幸福指數修正（分，一位小數） */
  adjust: number;
}

/** final＝一天已結束（23:55 快照）；還沒結束時只加不扣 */
export function dayAdjustOf(score: number, baseline: readonly number[], final: boolean, config: HappinessConfig = HAPPINESS_CONFIG): { baseline: number | null; adjust: number } {
  if (baseline.length < MIN_BASELINE_DAYS) return { baseline: null, adjust: 0 };
  const mean = baseline.reduce((s, v) => s + v, 0) / baseline.length;
  const raw = clamp((score - mean) * config.dayAdjustFactor, -config.dayAdjustCap, config.dayAdjustCap);
  const adjust = Math.round((final ? raw : Math.max(0, raw)) * 10) / 10;
  return { baseline: Math.round(mean * 10) / 10, adjust: adjust === 0 ? 0 : adjust };
}
