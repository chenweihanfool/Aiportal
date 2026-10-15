// 🧳 遊記的 /api/hermes-trips 讀取（只讀；寫入一律由 HERMES 的管線推上來，契約見 docs/trips-api.md）。
// 比照 foodApi.ts：私領域資料用 x-admin-password（解鎖後的 token）。
import { parsePhotos, safeImageUrl, type FoodPhoto } from './foodMap'

const API_BASE = import.meta.env.BASE_URL ?? '/'

export type TripStatus = 'planned' | 'ongoing' | 'done'
export const TRIP_STATUSES: TripStatus[] = ['planned', 'ongoing', 'done']

/** 一個條目：日記原文（純文字，保留換行）＋相片；photosPending＝還沒有網址的相片張數 */
export interface TripEntry {
  /** HH:MM */
  time: string
  text: string
  photos: FoodPhoto[]
  photosPending: number
}

export interface TripDay {
  /** YYYY-MM-DD，落在趟次的 [start, end] 內 */
  date: string
  title: string | null
  /** 對應 hermes-places 的 id；找不到地點就不畫 */
  placeIds: string[]
  entries: TripEntry[]
}

export interface Trip {
  id: string
  name: string
  start: string
  end: string
  status: TripStatus
  area: string | null
  summary: string | null
  cover: string | null
  placeIds: string[]
  days: TripDay[]
}

export interface TripData {
  available: boolean
  trips: Trip[]
  receivedAt: string | null
  /** true＝畫面顯示的是示範資料，不是知識庫的真資料 */
  sample?: boolean
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/

/** 真的存在的日期（擋掉 2026-02-31）；與伺服器 validDate 相同做法 */
const isDate = (v: unknown): v is string => {
  if (typeof v !== 'string' || !DATE_RE.test(v)) return false
  const t = Date.parse(`${v}T00:00:00Z`)
  return Number.isFinite(t) && new Date(t).toISOString().slice(0, 10) === v
}
const strOrNull = (v: unknown, max = 2000): string | null => (typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : null)
const idList = (v: unknown): string[] => (Array.isArray(v) ? [...new Set(v.flatMap(x => (typeof x === 'string' && x.trim() ? [x.trim()] : [])))] : [])

/** 依台北今天推狀態（伺服器沒給合法值時用）：end 已過＝done，start 還沒到＝planned，其餘 ongoing */
export function deriveTripStatus(start: string, end: string, today: string): TripStatus {
  if (end < today) return 'done'
  if (start > today) return 'planned'
  return 'ongoing'
}

/** 今天（台北時間）YYYY-MM-DD */
export function taipeiTodayIso(now: Date = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Taipei', year: 'numeric', month: '2-digit', day: '2-digit' }).format(now)
}

/** 驗證一個條目；時間不合法或沒有任何內容的略過（與伺服器規則一致） */
function parseEntry(raw: unknown): TripEntry | null {
  if (!raw || typeof raw !== 'object') return null
  const r = raw as Record<string, unknown>
  const time = typeof r['time'] === 'string' ? r['time'].trim() : ''
  if (!TIME_RE.test(time)) return null
  const text = typeof r['text'] === 'string' ? r['text'].replace(/\r\n?/g, '\n').trim() : ''
  const photos = parsePhotos(r['photos'])
  const pending = typeof r['photosPending'] === 'number' && Number.isInteger(r['photosPending']) && r['photosPending'] >= 0 ? r['photosPending'] : 0
  if (!text && photos.length === 0 && pending === 0) return null
  return { time, text, photos, photosPending: pending }
}

/** 驗證一趟；缺 id／name、日期不合法、end < start 回 null（整筆不顯示） */
export function parseTrip(raw: unknown, now: Date = new Date()): Trip | null {
  if (!raw || typeof raw !== 'object') return null
  const r = raw as Record<string, unknown>
  const id = strOrNull(r['id'], 60)
  const name = strOrNull(r['name'], 200)
  const start = r['start']
  const end = r['end']
  if (!id || !name || !isDate(start) || !isDate(end) || end < start) return null
  const days: TripDay[] = []
  if (Array.isArray(r['days'])) {
    for (const d of r['days']) {
      if (!d || typeof d !== 'object') continue
      const dr = d as Record<string, unknown>
      if (!isDate(dr['date']) || dr['date'] < start || dr['date'] > end) continue
      const entries = Array.isArray(dr['entries'])
        ? dr['entries'].map(parseEntry).filter((e): e is TripEntry => e !== null).sort((a, b) => (a.time < b.time ? -1 : a.time > b.time ? 1 : 0))
        : []
      days.push({ date: dr['date'], title: strOrNull(dr['title'], 200), placeIds: idList(dr['placeIds']), entries })
    }
  }
  days.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0))
  const status = typeof r['status'] === 'string' && (TRIP_STATUSES as string[]).includes(r['status'])
    ? (r['status'] as TripStatus)
    : deriveTripStatus(start, end, taipeiTodayIso(now))
  return {
    id, name, start, end, status,
    area: strOrNull(r['area'], 200),
    summary: strOrNull(r['summary'], 2000),
    cover: safeImageUrl(r['cover']),
    placeIds: idList(r['placeIds']),
    days,
  }
}

/** 驗證整包 trips；同 id 只留第一筆；壞掉的趟次丟掉，不讓整頁掛掉 */
export function parseTripList(raw: unknown, now: Date = new Date()): Trip[] {
  if (!Array.isArray(raw)) return []
  const seen = new Set<string>()
  const out: Trip[] = []
  for (const item of raw) {
    const t = parseTrip(item, now)
    if (t && !seen.has(t.id)) { seen.add(t.id); out.push(t) }
  }
  return out
}

/** 把 GET /api/hermes-trips 的回應轉成 TripData；available 非 true 或沒有合法趟次一律當作沒有資料 */
export function tripDataFromResponse(raw: unknown, now: Date = new Date()): TripData {
  if (!raw || typeof raw !== 'object') return { available: false, trips: [], receivedAt: null }
  const r = raw as Record<string, unknown>
  if (r['available'] !== true) return { available: false, trips: [], receivedAt: null }
  const trips = parseTripList(r['trips'], now)
  return {
    available: trips.length > 0,
    trips,
    receivedAt: typeof r['receivedAt'] === 'string' ? r['receivedAt'] : null,
  }
}

export async function apiFetchTrips(pw: string): Promise<TripData> {
  const r = await fetch(`${API_BASE}api/hermes-trips`, { headers: { 'x-admin-password': pw } })
  if (!r.ok) throw new Error(`Failed to fetch trips (${r.status})`)
  return tripDataFromResponse(await r.json())
}
