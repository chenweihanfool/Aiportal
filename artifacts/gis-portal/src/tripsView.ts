// ─────────────────────────────────────────────
// 🧳 遊記頁（#trips）的純函式：天數、相片數、第幾天、狀態標籤、每天路線文字、這趟要畫在地圖上的地點。
// 不碰 React／DOM／網路；日期一律用 UTC 午夜計算，避免時區造成少算或多算一天。
// ─────────────────────────────────────────────

import type { FoodPlace } from './foodMap'
import type { Trip, TripDay, TripEntry, TripStatus } from './tripsApi'

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

// ─────────────────────────────────────────────
// 條目文字的結構化：日記原文第一行是標題（「類別 — 主題」是常見寫法），其餘是內文。
// 折疊時只顯示「類別 chip＋主題＋一行預覽」，展開才看內文；全部是純文字處理，渲染由 MarkdownView 產生元素。
// ─────────────────────────────────────────────

export interface EntryParts {
  /** 去掉「（附照片）」後的標題（第一行） */
  title: string
  /** 「類別 — 主題」左半（最多 12 字）；沒有這種寫法為 null */
  category: string | null
  /** 主題：有類別時是右半，否則是整個標題 */
  topic: string
  /** 第一行以外的內容；標題很長又沒有內文時，整段標題當內文 */
  body: string
  /** 標題寫了「（附照片）」 */
  photoMark: boolean
}

const LONG_TITLE = 60
const PHOTO_MARK_RE = /\s*[（(]\s*附照片\s*[）)]\s*$/
const CATEGORY_RE = /^(.{1,12}?)\s+[—–]\s+(.+)$/

export function splitEntryText(text: string): EntryParts {
  const lines = text.replace(/\r\n?/g, '\n').split('\n')
  const first = lines.findIndex((l) => l.trim() !== '')
  if (first < 0) return { title: '', category: null, topic: '', body: '', photoMark: false }
  let title = lines[first]!.trim()
  const photoMark = PHOTO_MARK_RE.test(title)
  if (photoMark) title = title.replace(PHOTO_MARK_RE, '').trim()
  let body = lines.slice(first + 1).join('\n').trim()
  const m = CATEGORY_RE.exec(title)
  const category = m ? m[1]!.trim() : null
  const topic = m ? m[2]!.trim() : title
  if (!body && title.length > LONG_TITLE) body = title
  return { title, category, topic, body, photoMark }
}

/** 條目能不能展開：有內文、有相片（含處理中）才值得展開；只有一行短標題就不用 */
export function isEntryExpandable(e: TripEntry): boolean {
  const p = splitEntryText(e.text)
  return p.body !== '' || e.photos.length > 0 || e.photosPending > 0
}

/** 內文第一個非空行，去掉常見 markdown 記號後截短，當折疊時的一行預覽 */
export function entryPreview(body: string, max = 60): string {
  const line = body.split('\n').map((l) => l.trim()).find((l) => l !== '') ?? ''
  const plain = line
    .replace(/^[-*+]\s+/, '')
    .replace(/^\d+[.)]\s+/, '')
    .replace(/\*\*|__|`/g, '')
    .replace(/\[\[([^\]|]*\|)?([^\]]*)\]\]/g, '$2')
    .trim()
  return plain.length > max ? `${plain.slice(0, max)}…` : plain
}

/** 一天的摘要：前 n 個條目的主題（折疊的那天用，不用展開就知道大概做了什麼） */
export function dayDigest(d: Pick<TripDay, 'entries'>, n = 3): string {
  const topics = d.entries.map((e) => splitEntryText(e.text).topic).filter((t) => t !== '')
  if (topics.length === 0) return ''
  const shown = topics.slice(0, n).map((t) => (t.length > 18 ? `${t.slice(0, 18)}…` : t)).join('、')
  return topics.length > n ? `${shown} 等 ${topics.length} 則` : shown
}

/** 一天的相片數（含處理中） */
export function dayPhotoCount(d: Pick<TripDay, 'entries'>): number {
  return d.entries.reduce((n, e) => n + e.photos.length + e.photosPending, 0)
}

/** 預設展開哪幾天：進行中的趟次展開最後一個有條目的日子（最新的）；其他趟次展開第一個有條目的日子 */
export function defaultOpenDays(t: Pick<Trip, 'status' | 'days'>): string[] {
  const recorded = t.days.filter((d) => d.entries.length > 0)
  if (recorded.length === 0) return []
  const pick = t.status === 'ongoing' ? recorded[recorded.length - 1]! : recorded[0]!
  return [pick.date]
}
