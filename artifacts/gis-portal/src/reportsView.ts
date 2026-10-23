// 週／月報圖表的純函式（不碰 DOM，方便測）：差異文字、長條比例、地圖釘位置、旅程甘特條。
import type { Pin, PeriodReport, SeriesRow, TripBar } from './periodStats'

export interface Delta { text: string; tone: 'up' | 'down' | 'flat' }
/** 與上期比：多了 ▲、少了 ▼、一樣「持平」。沒有「好壞」判斷——想法多不一定好、美食少不一定壞 */
export function delta(cur: number, prev: number): Delta {
  const d = cur - prev
  if (d === 0) return { text: '與上期持平', tone: 'flat' }
  return d > 0 ? { text: `▲ ${d}（上期 ${prev}）`, tone: 'up' } : { text: `▼ ${-d}（上期 ${prev}）`, tone: 'down' }
}

/** 長條寬度百分比：最大值那條 100%，有值但很小的至少 4%（看得見），0 就是 0 */
export function barPct(value: number, max: number): number {
  if (value <= 0 || max <= 0) return 0
  return Math.max(4, Math.round((value / max) * 100))
}

export const FUNNEL_STEPS: ReadonlyArray<{ key: 'new' | 'evaluating' | 'doing' | 'done'; label: string }> = [
  { key: 'new', label: '💭 新想法' }, { key: 'evaluating', label: '🔍 評估中' }, { key: 'doing', label: '🚀 進行中' }, { key: 'done', label: '✅ 已實行' },
]

export function funnelRows(funnel: Record<'new' | 'evaluating' | 'doing' | 'done', number>) {
  const max = Math.max(0, ...FUNNEL_STEPS.map((s) => funnel[s.key]))
  return FUNNEL_STEPS.map((s) => ({ ...s, value: funnel[s.key], pct: barPct(funnel[s.key], max) }))
}

/** 計數字典 → 由大到小的前 n 筆（同數量依名稱），給橫條圖 */
export function topCounts(c: Record<string, number>, n = 5): Array<{ label: string; value: number; pct: number }> {
  const rows = Object.entries(c).filter(([, v]) => v > 0).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, n)
  const max = rows[0]?.[1] ?? 0
  return rows.map(([label, value]) => ({ label, value, pct: barPct(value, max) }))
}

/** 活動格的深淺 0–3（0＝沒有） */
export function cellLevel(n: number): 0 | 1 | 2 | 3 {
  return n <= 0 ? 0 : n === 1 ? 1 : n === 2 ? 2 : 3
}

/** 彙總格的深淺：以該列最大值為基準分三階（日級仍用 cellLevel） */
export function levelOf(n: number, max: number): 0 | 1 | 2 | 3 {
  if (n <= 0 || max <= 0) return 0
  return Math.min(3, Math.max(1, Math.ceil((3 * n) / max))) as 1 | 2 | 3
}

export type SeriesKey = 'ideas' | 'food' | 'travel'
export const SERIES_ROWS: ReadonlyArray<{ key: SeriesKey; label: string }> = [
  { key: 'ideas', label: '💡 想法' }, { key: 'food', label: '🍜 美食' }, { key: 'travel', label: '🧭 旅程' },
]
export const dayOfMonth = (row: SeriesRow) => Number(row.date.slice(8, 10))

export type RhythmLevel = 'day' | 'week' | 'month' | 'quarter' | 'year'
export interface RhythmCell {
  label: string
  /** 滑過格子時的提示：期間＋各主題具體是哪些 */
  tips: Record<SeriesKey, string>
  ideas: number; food: number; travel: number
}

const MAX_TIP_ITEMS = 8
/** 提示文字：一行標題＋逐項「• 名稱」，超過 8 項寫「…另 N 項」；沒有項目回「沒有紀錄」 */
export function tipText(head: string, items: readonly string[]): string {
  if (items.length === 0) return `${head}：沒有紀錄`
  const shown = items.slice(0, MAX_TIP_ITEMS).map((x) => `• ${x}`)
  if (items.length > MAX_TIP_ITEMS) shown.push(`…另 ${items.length - MAX_TIP_ITEMS} 項`)
  return `${head}\n${shown.join('\n')}`
}

const cellFrom = (label: string, head: string, rows: readonly SeriesRow[]): RhythmCell => {
  const ideas = rows.flatMap((r) => r.ideaTitles), food = rows.flatMap((r) => r.foodNames), trips = [...new Set(rows.flatMap((r) => r.tripNames))]
  return {
    label, ideas: rows.reduce((n, r) => n + r.ideas, 0), food: rows.reduce((n, r) => n + r.food, 0), travel: rows.reduce((n, r) => n + r.travel, 0),
    tips: { ideas: tipText(`${head} 想法 ${ideas.length}`, ideas), food: tipText(`${head} 美食 ${food.length}`, food), travel: tipText(`${head} 旅程`, trips) },
  }
}

/** 活動節奏的格子：週／月＝一天一格；季＝一週（7 天）一格；年＝一個月一格；日＝不畫（只有一天） */
export function rhythmCells(series: readonly SeriesRow[], level: RhythmLevel): { cells: RhythmCell[]; aggregated: boolean } {
  if (level === 'day' || series.length === 0) return { cells: [], aggregated: false }
  if (level === 'week' || level === 'month') {
    return { aggregated: false, cells: series.map((s) => cellFrom(String(dayOfMonth(s)), s.date.slice(5), [s])) }
  }
  const groups = new Map<string, SeriesRow[]>()
  series.forEach((s, i) => {
    const key = level === 'year' ? s.date.slice(0, 7) : String(Math.floor(i / 7))
    groups.set(key, [...(groups.get(key) ?? []), s])
  })
  const cells = [...groups.entries()].map(([key, rows]) => cellFrom(
    level === 'year' ? `${Number(key.slice(5))}月` : rows[0]!.date.slice(5).replace('-', '/'),
    level === 'year' ? key : `${rows[0]!.date.slice(5)}～${rows[rows.length - 1]!.date.slice(5)}`,
    rows,
  ))
  return { cells, aggregated: true }
}

/** 地圖釘 → 畫布座標（緯度越大越上方）。只有一個點放正中央；全部同緯／經度時該軸置中。 */
export function pinPositions(pins: readonly Pin[], w: number, h: number, pad = 14): Array<Pin & { x: number; y: number }> {
  if (pins.length === 0) return []
  const lats = pins.map((p) => p.lat), lngs = pins.map((p) => p.lng)
  const [minLat, maxLat, minLng, maxLng] = [Math.min(...lats), Math.max(...lats), Math.min(...lngs), Math.max(...lngs)]
  const at = (v: number, lo: number, hi: number, size: number) => (hi === lo ? size / 2 : pad + ((v - lo) / (hi - lo)) * (size - 2 * pad))
  return pins.map((p) => ({ ...p, x: Math.round(at(p.lng, minLng, maxLng, w)), y: Math.round(h - at(p.lat, minLat, maxLat, h)) }))
}

const dayNum = (d: string) => Math.floor(Date.parse(`${d}T00:00:00Z`) / 86_400_000)

/** 旅程甘特條：在 [range 起, range 迄] 這段時間軸上的位置（百分比）；超出本期的部分裁掉 */
export function ganttBars(trips: readonly TripBar[], range: readonly [string, string]) {
  const lo = dayNum(range[0]), span = dayNum(range[1]) - lo + 1
  if (!Number.isFinite(lo) || span <= 0) return []
  return trips.map((t) => {
    const s = Math.max(dayNum(t.start), lo), e = Math.min(dayNum(t.end), lo + span - 1)
    const ok = Number.isFinite(s) && Number.isFinite(e) && e >= s
    return { ...t, leftPct: ok ? ((s - lo) / span) * 100 : 0, widthPct: ok ? ((e - s + 1) / span) * 100 : 0 }
  })
}

/** 整期是否一點資料都沒有（三個主題都空）——畫面顯示「這期沒有紀錄」而不是三張全 0 的卡 */
export function isEmptyReport(r: PeriodReport): boolean {
  return r.ideas.new + r.ideas.done + r.ideas.started === 0 && r.food.added + r.food.visited === 0 && r.travel.tripDays === 0
}
