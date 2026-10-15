import type { HermesTrip, HermesTripDay, HermesTripEntry, HermesTripStatus } from "@workspace/db"
import { dateOrNull, safeImageUrl, sanitizePhotos, str } from "./hermesPlaces"

// 🧳 遊記：驗證 HERMES 推上來的趟次清單（契約見 docs/trips-api.md）。
// 規則與前端 gis-portal/src/tripsApi.ts 的 parseTrip 一致。格式不對或超過上限的整包回錯誤字串（400）；
// 單一趟次不合法（缺 id／name／日期、end < start）就整筆略過、計入 skipped，不報錯。

export const TRIPS_MAX = 50
export const TRIP_DAYS_MAX = 60
export const DAY_ENTRIES_MAX = 200
export const TRIP_PHOTOS_MAX = 600
export const ENTRY_TEXT_MAX = 4000
const STATUSES: HermesTripStatus[] = ["planned", "ongoing", "done"]
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/
const ID_MAX = 60
const PLACE_ID_MAX = 40
const ID_LIST_MAX = 200

export interface SanitizedTrips {
  trips: HermesTrip[]
  generatedAt: string | null
  /** 略過幾趟：缺必填欄位、日期不合法、end < start、重複 id */
  skipped: number
}

/** 台北時間的今天 YYYY-MM-DD（判斷趟次狀態用） */
export function taipeiToday(now: Date): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Taipei", year: "numeric", month: "2-digit", day: "2-digit" }).format(now)
}

/** 真的存在的日期（擋掉 2026-02-31 這種）；不合法回 null */
function validDate(v: unknown): string | null {
  const s = dateOrNull(v)
  if (!s) return null
  const t = Date.parse(`${s}T00:00:00Z`)
  return Number.isFinite(t) && new Date(t).toISOString().slice(0, 10) === s ? s : null
}

/** 合法的 status 照用；不合法就依日期推：end < 今天＝done，start > 今天＝planned，其餘＝ongoing */
function deriveStatus(v: unknown, start: string, end: string, today: string): HermesTripStatus {
  if (STATUSES.includes(v as HermesTripStatus)) return v as HermesTripStatus
  if (end < today) return "done"
  if (start > today) return "planned"
  return "ongoing"
}

/** id 清單（地點 id）：修剪、去空、去重、最多 200 筆 */
function idList(v: unknown, max = PLACE_ID_MAX): string[] {
  if (!Array.isArray(v)) return []
  const out: string[] = []
  for (const x of v) {
    const s = str(x, max)
    if (s && !out.includes(s)) out.push(s)
    if (out.length >= ID_LIST_MAX) break
  }
  return out
}

/** 一個條目：time 必須是 HH:MM；text 純文字（換行統一成 \n）；text、相片、待處理相片都空的略過 */
function sanitizeEntry(raw: unknown): HermesTripEntry | null {
  if (!raw || typeof raw !== "object") return null
  const r = raw as Record<string, unknown>
  const time = typeof r["time"] === "string" ? r["time"].trim() : ""
  if (!TIME_RE.test(time)) return null
  const text = typeof r["text"] === "string" ? r["text"].replace(/\r\n?/g, "\n").trim().slice(0, ENTRY_TEXT_MAX) : ""
  const photos = sanitizePhotos(r["photos"])
  const pending = typeof r["photosPending"] === "number" && Number.isInteger(r["photosPending"]) && r["photosPending"] >= 0 ? r["photosPending"] : 0
  if (!text && photos.length === 0 && pending === 0) return null
  return { time, text, photos, photosPending: pending }
}

/**
 * 天：date 必須落在 [start, end]，否則略過該日。同一天重複的 date 合併條目；
 * 天數超過 60 的後面日子略過；每天條目依 time 排序（穩定）、最多 200 筆；相片總數超過 600 的丟掉多的。
 */
function sanitizeDays(raw: unknown, start: string, end: string): HermesTripDay[] {
  if (!Array.isArray(raw)) return []
  const byDate = new Map<string, HermesTripDay>()
  for (const item of raw) {
    if (!item || typeof item !== "object") continue
    const r = item as Record<string, unknown>
    const date = validDate(r["date"])
    if (!date || date < start || date > end) continue
    let day = byDate.get(date)
    if (!day) {
      if (byDate.size >= TRIP_DAYS_MAX) continue
      day = { date, title: null, placeIds: [], entries: [] }
      byDate.set(date, day)
    }
    day.title = day.title ?? str(r["title"], 200)
    day.placeIds = idList([...day.placeIds, ...idList(r["placeIds"])])
    if (Array.isArray(r["entries"])) {
      for (const e of r["entries"]) {
        const en = sanitizeEntry(e)
        if (en) day.entries.push(en)
      }
    }
  }
  const days = [...byDate.values()].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0))
  let budget = TRIP_PHOTOS_MAX
  for (const d of days) {
    d.entries = d.entries
      .sort((a, b) => (a.time < b.time ? -1 : a.time > b.time ? 1 : 0))
      .slice(0, DAY_ENTRIES_MAX)
      .map((en) => {
        const photos = en.photos.slice(0, budget)
        budget -= photos.length
        return { ...en, photos }
      })
      .filter((en) => en.text || en.photos.length > 0 || en.photosPending > 0)
  }
  return days
}

/** 一趟；回 null 表示略過（缺 id／name、日期不合法、end < start） */
function sanitizeTrip(raw: unknown, today: string): HermesTrip | null {
  if (!raw || typeof raw !== "object") return null
  const r = raw as Record<string, unknown>
  const id = str(r["id"], ID_MAX)
  const name = str(r["name"], 200)
  const start = validDate(r["start"])
  const end = validDate(r["end"])
  if (!id || !name || !start || !end || end < start) return null
  return {
    id,
    name,
    start,
    end,
    status: deriveStatus(r["status"], start, end, today),
    area: str(r["area"], 200),
    summary: str(r["summary"], 2000),
    cover: safeImageUrl(r["cover"]),
    placeIds: idList(r["placeIds"]),
    days: sanitizeDays(r["days"], start, end),
  }
}

/**
 * 驗證整包 `{ trips: [...], generatedAt? }`。格式不對或超過 50 趟回錯誤訊息字串（呼叫端回 400）。
 * now 只給測試用（決定 status 推算的「今天」，台北時間）。
 */
export function sanitizeTripsPayload(body: unknown, now: Date = new Date()): SanitizedTrips | string {
  if (!body || typeof body !== "object") return "body 不是物件"
  const b = body as Record<string, unknown>
  if (!Array.isArray(b["trips"])) return "trips 不是陣列"
  const raws = b["trips"] as unknown[]
  if (raws.length > TRIPS_MAX) return `trips 超過 ${TRIPS_MAX} 筆`
  const today = taipeiToday(now)
  const seen = new Set<string>()
  const accepted: HermesTrip[] = []
  let skipped = 0
  for (const raw of raws) {
    const t = sanitizeTrip(raw, today)
    if (!t || seen.has(t.id)) { skipped += 1; continue }
    seen.add(t.id)
    accepted.push(t)
  }
  // 新的在前（依 start 由新到舊），同日依 id
  accepted.sort((a, b) => (a.start < b.start ? 1 : a.start > b.start ? -1 : a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
  return { trips: accepted, generatedAt: dateOrNull(b["generatedAt"]), skipped }
}
