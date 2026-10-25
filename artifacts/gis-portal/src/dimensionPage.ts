// 面向頁（#dim/<key>）的純邏輯：說明文字、區間統計、上一個／下一個面向。
// 各面向「衡量什麼」「資料來源」的一句話在 dimensions.ts（面向註冊表）；算法公式在 DimensionCards.tsx 的 *SummaryBody／MindDetailBody／SocialDetailBody。
import type { HhiRow } from './boardView'
import { DIMENSIONS } from './dimensions'
import { addDays, type DimSeries } from './homeView'

/** 分數的共同說明：六個面向的分數都是對照「自己近 90 天」的百分位，不是絕對好壞 */
export const PERCENTILE_NOTE = '面向分數是對照你自己近 90 天的百分位：70 分代表比近三個月 70% 的日子表現更好，不是考試分數。'

export interface RangeStats {
  /** 有資料的天數 */
  count: number
  avg: number
  max: { date: string; value: number }
  min: { date: string; value: number }
  /** 區間內第一個值 → 最後一個值的差（取整後相減）；只有一個值時為 null */
  change: number | null
  firstDate: string
}

/** 序列內所有有值的點；沒有點回 null */
export function rangeStats(series: DimSeries | null): RangeStats | null {
  if (!series) return null
  const pts = series.days.filter((d): d is { date: string; value: number } => d.value !== null)
  if (pts.length === 0) return null
  let max = pts[0]!
  let min = pts[0]!
  let sum = 0
  for (const p of pts) {
    sum += p.value
    if (p.value > max.value) max = p
    if (p.value < min.value) min = p
  }
  const first = pts[0]!
  const last = pts[pts.length - 1]!
  return {
    count: pts.length,
    avg: Math.round((sum / pts.length) * 10) / 10,
    max: { date: max.date, value: Math.round(max.value) },
    min: { date: min.date, value: Math.round(min.value) },
    change: pts.length >= 2 ? Math.round(last.value) - Math.round(first.value) : null,
    firstDate: first.date,
  }
}

/** 面向頁的 hash：#dim/<key>；key 不認得回 null */
export function dimKeyFromHash(hash: string): string | null {
  const m = /^#dim\/([A-Za-z]+)$/.exec(hash)
  if (!m) return null
  return DIMENSIONS.some((d) => d.key === m[1]) ? m[1]! : null
}

export const dimHash = (key: string) => `dim/${key}`

/** 前一個與後一個面向（循環），給頁首的切換用 */
export function dimNeighbors(key: string): { prev: string; next: string } | null {
  const i = DIMENSIONS.findIndex((d) => d.key === key)
  if (i < 0) return null
  const n = DIMENSIONS.length
  return { prev: DIMENSIONS[(i - 1 + n) % n]!.key, next: DIMENSIONS[(i + 1) % n]!.key }
}

/** 與昨天（序列最後兩個有值的相鄰日）的差說明；沒有就 null */
export const deltaText = (delta: number | null): string | null => (delta === null ? null : delta > 0 ? `▲ ${delta}` : delta < 0 ? `▼ ${-delta}` : '— 持平')

// ── 寬螢幕側欄卡片的純邏輯（2.62.0）──

export interface OverviewRow extends HhiRow {
  /** 還能補多少總分＝權重 × 離滿分的差（分）；沒分數為 null */
  gap: number | null
}

/** 六個面向一覽：每列加上「還能補幾分」；gain10＝目前這個面向再 +10 分，總分約加多少 */
export function dimOverview(rows: HhiRow[], key: string): { rows: OverviewRow[]; gain10: number | null } {
  const r1 = (n: number) => Math.round(n * 10) / 10
  const out = rows.map((r) => ({ ...r, gap: r.value === null ? null : r1(((100 - r.value) * r.weightPct) / 100) }))
  const cur = rows.find((r) => r.key === key)
  return { rows: out, gain10: cur ? r1((10 * cur.weightPct) / 100) : null }
}

const WEEKDAYS = ['日', '一', '二', '三', '四', '五', '六'] as const

export interface RecentDigest {
  /** 近 7 天（含今天）與再前 7 天的平均；那段沒資料為 null */
  last7: number | null
  prev7: number | null
  /** last7 − prev7；任一邊沒資料為 null */
  weekChange: number | null
  /** 最新一筆在近 90 天裡排第幾高（同分算同名次）、共幾天有資料 */
  rank: { pos: number; of: number; date: string; value: number }
  avg90: number
  /** 到最新一筆為止，連續幾天都在 90 天平均之上（above）或之下（below）；遇到沒資料的日子就斷 */
  streak: { side: 'above' | 'below'; days: number }
  /** 依星期幾的平均，最高與最低；有 ≥2 筆資料的星期幾不到 4 個就 null */
  weekday: { best: { day: string; avg: number }; worst: { day: string; avg: number } } | null
}

/** 近況卡：從每日歷史（components）算近 7 天 vs 前 7 天、名次、連續天數、星期幾規律。有效點不到 2 個回 null */
export function recentDigest(
  history: ReadonlyArray<{ date: string; components?: Record<string, number | null> | null }> | null | undefined,
  key: string, todayIso: string,
): RecentDigest | null {
  if (!Array.isArray(history)) return null
  const start = addDays(todayIso, -89)
  const byDate = new Map<string, number>()
  for (const h of history) {
    if (!h || typeof h.date !== 'string') continue
    const d = h.date.slice(0, 10)
    if (d < start || d > todayIso) continue
    const c = h.components
    const v = c && typeof c === 'object' && !Array.isArray(c) ? c[key] : null
    if (typeof v === 'number' && Number.isFinite(v)) byDate.set(d, Math.min(100, Math.max(0, v)))
  }
  if (byDate.size < 2) return null
  const r1 = (n: number) => Math.round(n * 10) / 10
  const avgOf = (from: number, to: number): number | null => {
    let sum = 0, n = 0
    for (let i = from; i <= to; i++) {
      const v = byDate.get(addDays(todayIso, -i))
      if (v !== undefined) { sum += v; n++ }
    }
    return n ? r1(sum / n) : null
  }
  const last7 = avgOf(0, 6)
  const prev7 = avgOf(7, 13)
  const dates = [...byDate.keys()].sort()
  const latestDate = dates[dates.length - 1]!
  const latest = byDate.get(latestDate)!
  const vals = [...byDate.values()]
  const avg90 = vals.reduce((s, v) => s + v, 0) / vals.length
  const side: 'above' | 'below' = latest >= avg90 ? 'above' : 'below'
  let days = 0
  for (let d = latestDate; ; d = addDays(d, -1)) {
    const v = byDate.get(d)
    if (v === undefined || (v >= avg90 ? 'above' : 'below') !== side) break
    days++
  }
  const byWd = new Map<number, number[]>()
  for (const [d, v] of byDate) {
    const wd = new Date(`${d}T12:00:00Z`).getUTCDay()
    byWd.set(wd, [...(byWd.get(wd) ?? []), v])
  }
  const wdAvg = [...byWd].filter(([, vs]) => vs.length >= 2).map(([wd, vs]) => ({ day: WEEKDAYS[wd]!, avg: r1(vs.reduce((s, v) => s + v, 0) / vs.length) }))
  let weekday: RecentDigest['weekday'] = null
  if (wdAvg.length >= 4) {
    const best = wdAvg.reduce((a, b) => (b.avg > a.avg ? b : a))
    const worst = wdAvg.reduce((a, b) => (b.avg < a.avg ? b : a))
    weekday = { best, worst }
  }
  return {
    last7, prev7,
    weekChange: last7 !== null && prev7 !== null ? r1(last7 - prev7) : null,
    rank: { pos: vals.filter((v) => v > latest).length + 1, of: vals.length, date: latestDate, value: Math.round(latest) },
    avg90: r1(avg90),
    streak: { side, days },
    weekday,
  }
}
