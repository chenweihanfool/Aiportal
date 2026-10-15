import type { HermesPlace, HermesPlaceKind, HermesPlacePhoto, HermesPlaceStatus } from "@workspace/db"

// 🍜 美食及旅遊地圖：驗證 HERMES 推上來的地點清單。規則與前端 gis-portal/src/foodMap.ts 的 parseFoodPlace 一致。
// 使用者 2026-10-15：「找不到地點就略過」——沒有合法座標的地點整筆略過、計入 skipped，不報錯。

export const PLACES_MAX = 2000
const PHOTOS_MAX = 24
const LIST_MAX = 50
const KINDS: HermesPlaceKind[] = ["food", "sight", "stay", "other"]
const STATUSES: HermesPlaceStatus[] = ["want", "visited", "favorite", "skip"]
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/

export interface SanitizedPlaces {
  places: HermesPlace[]
  generatedAt: string | null
  /** 略過幾筆：沒有合法座標、缺必填欄位、重複 id */
  skipped: number
}

const str = (v: unknown, max = 500): string | null => (typeof v === "string" && v.trim() ? v.trim().slice(0, max) : null)
const dateOrNull = (v: unknown): string | null => {
  const s = str(v, 10)
  return s && DATE_RE.test(s) ? s : null
}
const inRange = (v: unknown, lo: number, hi: number): number | null =>
  typeof v === "number" && Number.isFinite(v) && v >= lo && v <= hi ? v : null
const posNum = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) && v > 0 ? v : null)
const strList = (v: unknown): string[] =>
  Array.isArray(v) ? v.flatMap((x) => (typeof x === "string" && x.trim() ? [x.trim().slice(0, 500)] : [])).slice(0, LIST_MAX) : []
const dateList = (v: unknown): string[] =>
  Array.isArray(v) ? v.filter((x): x is string => typeof x === "string" && DATE_RE.test(x)).slice(0, LIST_MAX) : []

/** 只允許 https:// 或站內絕對路徑 `/…`（不含 `//`）、不含空白；其他（javascript:、data: 等）一律丟掉 */
export function safeImageUrl(v: unknown): string | null {
  if (typeof v !== "string") return null
  const u = v.trim()
  if (u.length > 2048) return null
  if (/^https:\/\/[^\s]+$/i.test(u)) return u
  if (/^\/(?!\/)[^\s]*$/.test(u)) return u
  return null
}

/** 相片清單：url 不合法的丟掉，最多 24 張 */
export function sanitizePhotos(v: unknown): HermesPlacePhoto[] {
  if (!Array.isArray(v)) return []
  const out: HermesPlacePhoto[] = []
  for (const item of v) {
    if (!item || typeof item !== "object") continue
    const r = item as Record<string, unknown>
    const url = safeImageUrl(r["url"])
    if (!url) continue
    out.push({
      url,
      thumb: safeImageUrl(r["thumb"]),
      w: posNum(r["w"]),
      h: posNum(r["h"]),
      takenAt: dateOrNull(r["takenAt"]),
      caption: str(r["caption"], 500),
    })
    if (out.length >= PHOTOS_MAX) break
  }
  return out
}

/**
 * 從 Google 地圖分享連結取座標（同前端 coordsFromMapUrl）：`/@25.03,121.56,17z`、`?q=…`、`?ll=…`、`!3d…!4d…`。
 * 短網址（maps.app.goo.gl）沒有座標，回 null。
 */
export function coordsFromMapUrl(url: string | null | undefined): { lat: number; lng: number } | null {
  if (!url) return null
  const pats = [
    /!3d(-?\d+(?:\.\d+)?)!4d(-?\d+(?:\.\d+)?)/,
    /@(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)/,
    /[?&](?:q|ll|query|destination)=(-?\d+(?:\.\d+)?)(?:,|%2C)(-?\d+(?:\.\d+)?)/i,
  ]
  for (const re of pats) {
    const m = url.match(re)
    if (m) {
      const lat = Number(m[1]), lng = Number(m[2])
      if (Number.isFinite(lat) && Number.isFinite(lng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180) return { lat, lng }
    }
  }
  return null
}

/** 驗證單筆；回 null 表示略過（缺必填欄位、非法狀態、沒有座標） */
function sanitizePlace(raw: unknown): HermesPlace | null {
  if (!raw || typeof raw !== "object") return null
  const r = raw as Record<string, unknown>
  const id = str(r["id"], 40)
  const name = str(r["name"], 200)
  const addedAt = dateOrNull(r["addedAt"])
  const status = r["status"]
  if (!id || !name || !addedAt || !STATUSES.includes(status as HermesPlaceStatus)) return null
  const mapUrl = str(r["mapUrl"])
  let lat = inRange(r["lat"], -90, 90)
  let lng = inRange(r["lng"], -180, 180)
  if (lat === null || lng === null) {
    // 只給了地圖連結時從連結拿座標；短網址拿不到就略過
    const fromUrl = coordsFromMapUrl(mapUrl)
    lat = fromUrl?.lat ?? null
    lng = fromUrl?.lng ?? null
  }
  if (lat === null || lng === null) return null
  return {
    id, name,
    kind: KINDS.includes(r["kind"] as HermesPlaceKind) ? (r["kind"] as HermesPlaceKind) : "food",
    status: status as HermesPlaceStatus,
    area: str(r["area"], 500),
    address: str(r["address"], 500),
    lat, lng,
    cuisine: str(r["cuisine"], 500),
    tags: strList(r["tags"]),
    priceLevel: inRange(r["priceLevel"], 1, 4),
    why: str(r["why"], 500),
    source: str(r["source"], 500),
    mustTry: strList(r["mustTry"]),
    rating: inRange(r["rating"], 1, 5),
    addedAt,
    visitedAt: dateOrNull(r["visitedAt"]),
    days: dateList(r["days"]),
    mapUrl,
    photos: sanitizePhotos(r["photos"]),
  }
}

/** 驗證整包 `{ places: [...], generatedAt? }`。格式不對或超過 2000 筆回錯誤訊息字串（呼叫端回 400）。 */
export function sanitizePlacesPayload(body: unknown): SanitizedPlaces | string {
  if (!body || typeof body !== "object") return "body 不是物件"
  const b = body as Record<string, unknown>
  if (!Array.isArray(b["places"])) return "places 不是陣列"
  const raws = b["places"] as unknown[]
  if (raws.length > PLACES_MAX) return `places 超過 ${PLACES_MAX} 筆`
  const seen = new Set<string>()
  const accepted: HermesPlace[] = []
  let skipped = 0
  for (const raw of raws) {
    const p = sanitizePlace(raw)
    if (!p) { skipped += 1; continue }
    if (seen.has(p.id)) { skipped += 1; continue }
    seen.add(p.id)
    accepted.push(p)
  }
  accepted.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
  return { places: accepted, generatedAt: dateOrNull(b["generatedAt"]), skipped }
}
