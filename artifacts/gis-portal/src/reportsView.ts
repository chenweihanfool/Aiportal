// 週／月報頁的純函式（不碰 DOM，方便測）：挑報告、差異文字、長條比例、地圖釘位置、旅程甘特條。
import type { Pin, Report, ReportPeriod, SeriesRow, TripBar } from './reportsApi'

export const PERIOD_LABEL: Record<ReportPeriod, string> = { week: '週報', month: '月報' }

/** 該週期的報告，新到舊（推送端已排好；這裡再依起日排一次，不依賴推送端順序） */
export function reportsOf(reports: readonly Report[], period: ReportPeriod): Report[] {
  return reports.filter((r) => r.period === period).sort((a, b) => b.range[0].localeCompare(a.range[0]))
}

const md = (d: string) => `${Number(d.slice(5, 7))}/${Number(d.slice(8, 10))}`

export function periodLabel(r: Pick<Report, 'period' | 'range'>): string {
  if (r.period === 'month') return `${r.range[0].slice(0, 4)} 年 ${Number(r.range[0].slice(5, 7))} 月`
  return `${md(r.range[0])}–${md(r.range[1])}`
}

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

export type SeriesKey = 'ideas' | 'food' | 'travel'
export const SERIES_ROWS: ReadonlyArray<{ key: SeriesKey; label: string }> = [
  { key: 'ideas', label: '💡 想法' }, { key: 'food', label: '🍜 美食' }, { key: 'travel', label: '🧭 旅程' },
]
export const dayOfMonth = (row: SeriesRow) => Number(row.date.slice(8, 10))

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
export function isEmptyReport(r: Report): boolean {
  return r.ideas.new + r.ideas.done + r.ideas.started === 0 && r.food.added + r.food.visited === 0 && r.travel.tripDays === 0
}
