// ─────────────────────────────────────────────
// 🧳 遊記頁（#trips）的純函式：天數、相片數、第幾天、狀態標籤、每天路線文字、這趟要畫在地圖上的地點。
// 不碰 React／DOM／網路；日期一律用 UTC 午夜計算，避免時區造成少算或多算一天。
// ─────────────────────────────────────────────

import type { FoodPlace } from './foodMap'
import type { Trip, TripDay, TripStatus } from './tripsApi'

export const TRIP_STATUS_LABEL: Record<TripStatus, string> = { planned: '計畫中', ongoing: '進行中', done: '已結束' }

export const WEEKDAY_ZH = ['日', '一', '二', '三', '四', '五', '六']

/** 兩個 YYYY-MM-DD 相差幾天（to − from） */
export function dayDiff(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000)
}

/** 趟次總共幾天（含頭尾）：10/10–10/12 ＝ 3 天 */
export function tripSpanDays(t: Pick<Trip, 'start' | 'end'>): number {
  return dayDiff(t.start, t.end) + 1
}

/** 這一天是趟次的第幾天（從出發日算起）；Day N 的 N */
export function dayNumber(t: Pick<Trip, 'start'>, date: string): number {
  return dayDiff(t.start, date) + 1
}

/** 星期幾（中文一字） */
export function weekdayZh(date: string): string {
  return WEEKDAY_ZH[new Date(`${date}T00:00:00Z`).getUTCDay()] ?? ''
}

/** 2026-10-10 → 2026/10/10 */
export function slashDate(iso: string): string {
  return iso.replace(/-/g, '/')
}

/** 日期區間：同一天只寫一個；同年寫「2026/10/10 – 10/12」；跨年寫完整兩端 */
export function formatDateRange(start: string, end: string): string {
  if (start === end) return slashDate(start)
  if (start.slice(0, 4) === end.slice(0, 4)) return `${slashDate(start)} – ${end.slice(5).replace('-', '/')}`
  return `${slashDate(start)} – ${slashDate(end)}`
}

/** 「Day 2 · 2026/10/11（日）」 */
export function dayHeading(t: Pick<Trip, 'start'>, d: Pick<TripDay, 'date'>): string {
  return `Day ${dayNumber(t, d.date)} · ${slashDate(d.date)}（${weekdayZh(d.date)}）`
}

export interface TripStats {
  /** 趟次天數（含頭尾），不是有紀錄的天數 */
  days: number
  /** 有條目的天數 */
  recordedDays: number
  entries: number
  photos: number
  /** 日記引用了、但還沒有網址的相片 */
  pending: number
}

export function tripStats(t: Trip): TripStats {
  let entries = 0, photos = 0, pending = 0, recordedDays = 0
  for (const d of t.days) {
    if (d.entries.length > 0) recordedDays += 1
    for (const e of d.entries) {
      entries += 1
      photos += e.photos.length
      pending += e.photosPending
    }
  }
  return { days: tripSpanDays(t), recordedDays, entries, photos, pending }
}

/** 「12 張相片」；有處理中的另外寫「（另 3 張處理中）」 */
export function photoSummary(s: Pick<TripStats, 'photos' | 'pending'>): string {
  const base = `${s.photos} 張相片`
  return s.pending > 0 ? `${base}（另 ${s.pending} 張處理中）` : base
}

/** 整趟還沒有任何條目與相片 */
export function isEmptyTrip(t: Trip): boolean {
  const s = tripStats(t)
  return s.entries === 0 && s.photos === 0 && s.pending === 0
}

/** 每天路線：依當天 placeIds 的順序列出地點名稱（找不到的地點略過） */
export function dayRouteNames(d: Pick<TripDay, 'placeIds'>, places: FoodPlace[]): string[] {
  const byId = new Map(places.map((p) => [p.id, p]))
  return d.placeIds.map((id) => byId.get(id)?.name).filter((n): n is string => !!n)
}

/** 路線文字：「巷口牛肉麵 → 河岸早午餐」；沒有地點回 null */
export function dayRouteText(d: Pick<TripDay, 'placeIds'>, places: FoodPlace[]): string | null {
  const names = dayRouteNames(d, places)
  return names.length ? names.join(' → ') : null
}

/** 這趟要畫在地圖上的地點：趟次本身的 placeIds ＋ 每天的 placeIds（去重、保留順序），且要有座標 */
export function tripMapPlaces(t: Trip, places: FoodPlace[]): FoodPlace[] {
  const ids = [...new Set([...t.placeIds, ...t.days.flatMap((d) => d.placeIds)])]
  const byId = new Map(places.map((p) => [p.id, p]))
  return ids.map((id) => byId.get(id)).filter((p): p is FoodPlace => !!p && p.lat !== null && p.lng !== null)
}
