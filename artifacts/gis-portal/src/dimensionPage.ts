// 面向頁（#dim/<key>）的純邏輯：說明文字、區間統計、上一個／下一個面向。
// 各面向「衡量什麼」「資料來源」的一句話在 dimensions.ts（面向註冊表）；算法公式在 DimensionCards.tsx 的 *SummaryBody／MindDetailBody／SocialDetailBody。
import { DIMENSIONS } from './dimensions'
import type { DimSeries } from './homeView'

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
