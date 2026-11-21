// 幸福觸發 4（3.7.0）：心得與想法誕生那天的幸福指數。純函式，不碰 DOM、不發網路。
// 每日分數只收換尺（SCALE_SINCE）之後的點；之前的分數是另一把尺，對不上就當沒有。
import type { HhiHistoryPoint } from './boardApi'
import type { Insight } from './insightModel'
import { SCALE_SINCE } from './companion'

/** 高分門檻（含） */
export const HIGH = 75
/** 低分門檻（不含） */
export const LOW = 60

/** 每日分數表：date（YYYY-MM-DD）→ 四捨五入後的顯示分數；SCALE_SINCE 之前的點不收。 */
export function scoreByDate(history: readonly HhiHistoryPoint[]): Map<string, number> {
  const scores = new Map<string, number>()
  for (const h of history) {
    const date = h.date?.slice(0, 10)
    if (!date || date < SCALE_SINCE) continue
    if (!Number.isFinite(h.displayedScore)) continue
    scores.set(date, Math.round(h.displayedScore))
  }
  return scores
}

export type BornBand = 'high' | 'low' | 'mid' | null

/** 那天屬於哪一段：沒有分數 → null；≥75 高分；<60 低分；其餘中間。 */
export function bornBand(score: number | undefined): BornBand {
  if (score === undefined) return null
  if (score >= HIGH) return 'high'
  if (score < LOW) return 'low'
  return 'mid'
}

/** 依心得日期對分數分組（新到舊）；known＝有分數的心得數（中間段也算）。 */
export function insightsByBand(insights: Insight[], scores: Map<string, number>): { high: Insight[]; low: Insight[]; known: number } {
  const high: Insight[] = []
  const low: Insight[] = []
  let known = 0
  const newestFirst = [...insights].sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0))
  for (const ins of newestFirst) {
    const score = scores.get(ins.date.slice(0, 10))
    if (score === undefined) continue
    known += 1
    const band = bornBand(score)
    if (band === 'high') high.push(ins)
    else if (band === 'low') low.push(ins)
  }
  return { high, low, known }
}
