// 每日評分：80% 當天成果＋20% AI 自評（日報 📊 段）。純函式；資料來自 milestones.ts 的 dailyIndex 與日報的 reportScore。
// 使用者 2026-10-30：「每日評分目前只讓AI自己打分數 應該改成 當天的成果 (完成任務 +新想法 +想法實行) * 80% + AI自己打分數 * 20%
// 這樣自己的努力才會反應比較多在分數上」；換算方式選「遞減曲線」。
//   成果點數＝完成任務＋新想法＋想法實行×2（把想法做出來比完成一般任務少見）
//   成果分＝100×(1−0.5^(點數÷3))：1 點 21、3 點 50、6 點 75、9 點 88，做越多越高但不會一下就滿分
// 幸福指數的心智維度照舊用 AI 自評（想法已在心智的 80% 裡，不重複計）；2026-10-30 起每日評分另以「日分修正」連到幸福指數，
// 由 api-server lib/dailyScore.ts 計算（兩邊常數由 dailyScore.test.ts 比對）。
import type { Counts } from './milestones'

export const ACHIEVEMENT_WEIGHT = 0.8
export const AI_WEIGHT = 0.2
export const IDEA_DONE_POINTS = 2
/** 幾點成果拿 50 分 */
export const HALF_POINTS = 3

export function achievementPoints(c: Counts): number {
  return c.tasks + c.ideasNew + IDEA_DONE_POINTS * c.ideasDone
}

export function achievementScore(points: number): number {
  return Math.round(100 * (1 - 0.5 ** (Math.max(0, points) / HALF_POINTS)))
}

export interface DailyScore {
  total: number
  /** 成果分（0–100）；成果資料還沒載入＝null，總分只用 AI 自評 */
  achievement: number | null
  points: number | null
  counts: Counts | null
  /** AI 自評（日報 📊 段，0–100）；那天沒有日報分數＝null，總分只用成果分 */
  ai: number | null
}

/** 兩邊都有：0.8×成果＋0.2×AI；只有一邊就用那一邊；都沒有＝null */
export function dailyScore(ai: number | null | undefined, counts: Counts | null): DailyScore | null {
  const aiOk = typeof ai === 'number' && Number.isFinite(ai) ? ai : null
  const points = counts ? achievementPoints(counts) : null
  const achievement = points === null ? null : achievementScore(points)
  if (achievement === null && aiOk === null) return null
  const total = achievement === null ? aiOk! : aiOk === null ? achievement : ACHIEVEMENT_WEIGHT * achievement + AI_WEIGHT * aiOk
  return { total: Math.round(total), achievement, points, counts, ai: aiOk }
}

/** 一行說明：「72＝成果 75×80%＋AI 60×20%（任務 3・新想法 1・實行 1）」 */
export function dailyScoreLine(s: DailyScore): string {
  const c = s.counts
  const detail = c ? `（任務 ${c.tasks}・新想法 ${c.ideasNew}・實行 ${c.ideasDone}）` : ''
  if (s.achievement !== null && s.ai !== null) return `${s.total}＝成果 ${s.achievement}×80%＋AI ${Math.round(s.ai)}×20%${detail}`
  if (s.achievement !== null) return `${s.total}＝成果 ${s.achievement}（這天沒有 AI 自評）${detail}`
  return `${s.total}＝AI 自評（成果資料讀不到）`
}
