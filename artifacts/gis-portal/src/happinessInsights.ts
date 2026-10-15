// 幸福指數近 30 天洞察：只用既有的歷史資料算，純函式。
import { type HappinessHistoryPoint } from './portalApi'

// ─────────────────────────────────────────────
// 30-day happiness insights — pure function over existing history data, no
// new schema/accumulation period needed (weakestComponent etc. was already
// being computed/stored daily, just never surfaced).
// ─────────────────────────────────────────────
interface HappinessInsights {
  weakestFrequency: { label: string; count: number; total: number } | null
  bestDay: { date: string; score: number } | null
  worstDay: { date: string; score: number } | null
  streak: { direction: 'up' | 'down'; days: number } | null
  weekdayPattern: { bestWeekday: string; bestAvg: number; worstWeekday: string; worstAvg: number } | null
  volatility: { stdDev: number; label: string } | null
}

export function computeHappinessInsights(history: HappinessHistoryPoint[]): HappinessInsights {
  if (history.length === 0) {
    return { weakestFrequency: null, bestDay: null, worstDay: null, streak: null, weekdayPattern: null, volatility: null }
  }

  const weakestCounts = new Map<string, number>()
  let weakestTotal = 0
  for (const h of history) {
    if (h.weakestComponent) {
      weakestCounts.set(h.weakestComponent, (weakestCounts.get(h.weakestComponent) ?? 0) + 1)
      weakestTotal += 1
    }
  }
  let weakestFrequency: HappinessInsights['weakestFrequency'] = null
  if (weakestCounts.size > 0) {
    const [label, count] = [...weakestCounts.entries()].sort((a, b) => b[1] - a[1])[0]!
    weakestFrequency = { label, count, total: weakestTotal }
  }

  const byScore = [...history].sort((a, b) => a.displayedScore - b.displayedScore)
  const worstDay = { date: byScore[0]!.date, score: byScore[0]!.displayedScore }
  const bestDay = { date: byScore[byScore.length - 1]!.date, score: byScore[byScore.length - 1]!.displayedScore }

  const chronological = [...history].sort((a, b) => a.date.localeCompare(b.date))
  let streak: HappinessInsights['streak'] = null
  if (chronological.length >= 2) {
    let direction: 'up' | 'down' | null = null
    let days = 1
    for (let i = chronological.length - 1; i > 0; i--) {
      const diff = chronological[i]!.displayedScore - chronological[i - 1]!.displayedScore
      if (diff === 0) break
      const dir: 'up' | 'down' = diff > 0 ? 'up' : 'down'
      if (direction === null) { direction = dir; days = 2 }
      else if (dir === direction) { days += 1 }
      else break
    }
    if (direction !== null) streak = { direction, days }
  }

  const weekdayNames = ['週日', '週一', '週二', '週三', '週四', '週五', '週六']
  const weekdaySums = new Array<number>(7).fill(0)
  const weekdayCounts = new Array<number>(7).fill(0)
  for (const h of history) {
    const wd = new Date(`${h.date}T00:00:00`).getDay()
    weekdaySums[wd] += h.displayedScore
    weekdayCounts[wd] += 1
  }
  const weekdayAverages = weekdayNames
    .map((_, wd) => ({ wd, avg: weekdayCounts[wd]! > 0 ? weekdaySums[wd]! / weekdayCounts[wd]! : null, count: weekdayCounts[wd]! }))
    .filter((w): w is { wd: number; avg: number; count: number } => w.avg !== null && w.count >= 2)
  let weekdayPattern: HappinessInsights['weekdayPattern'] = null
  if (weekdayAverages.length >= 2) {
    const best = weekdayAverages.reduce((a, b) => (b.avg > a.avg ? b : a))
    const worst = weekdayAverages.reduce((a, b) => (b.avg < a.avg ? b : a))
    if (best.wd !== worst.wd) {
      weekdayPattern = {
        bestWeekday: weekdayNames[best.wd]!,
        bestAvg: Math.round(best.avg),
        worstWeekday: weekdayNames[worst.wd]!,
        worstAvg: Math.round(worst.avg),
      }
    }
  }

  let volatility: HappinessInsights['volatility'] = null
  if (history.length >= 3) {
    const mean = history.reduce((sum, h) => sum + h.displayedScore, 0) / history.length
    const variance = history.reduce((sum, h) => sum + (h.displayedScore - mean) ** 2, 0) / history.length
    const stdDev = Math.round(Math.sqrt(variance) * 10) / 10
    const label = stdDev < 5 ? '穩定' : stdDev < 12 ? '普通' : '起伏大'
    volatility = { stdDev, label }
  }

  return { weakestFrequency, bestDay, worstDay, streak, weekdayPattern, volatility }
}
