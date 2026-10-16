// ─────────────────────────────────────────────
// 🍜 美食地圖（2026-10-15 原型）——資料型別與純函式，不碰 React / DOM / 網路。
//
// 資料來源（規劃，尚未接上）：HERMES 在日記寫 `### HH:MM 🍜 店名`（格式見
// docs/portal-audit-2026-10.md「美食地圖」一節），kb-pipeline 萃取成
// pipeline/state/food.json，再由 pusher 推到入口網。比照想法庫（ideas）：
// 入口網只顯示、不寫入；狀態更新一律「複製一句話貼給 HERMES」寫回日記。
//
// 原型階段畫面只吃 foodSample.ts 的示範資料；parseFoodPayload 先寫好，
// 日後接 /api/hermes-food 時直接拿來驗證 payload（壞掉的列丟掉、不讓整頁掛掉）。
// ─────────────────────────────────────────────

/** 想吃 → 去過 → 愛店／不再去。只有 visited/favorite 算「去過」 */
export type FoodStatus = 'want' | 'visited' | 'favorite' | 'skip'

export const FOOD_STATUSES: FoodStatus[] = ['want', 'visited', 'favorite', 'skip']

export const FOOD_STATUS_LABEL: Record<FoodStatus, string> = {
  want: '想吃', visited: '去過', favorite: '愛店', skip: '不再去',
}
export const FOOD_STATUS_ICON: Record<FoodStatus, string> = {
  want: '🔖', visited: '✅', favorite: '❤️', skip: '🚫',
}
/** 日記狀態更新寫法的記號：`### HH:MM 🍜✅ 店名 去過` */
export const FOOD_STATUS_MARK: Record<FoodStatus, string> = {
  want: '🍜🔖', visited: '🍜✅', favorite: '🍜❤️', skip: '🍜🚫',
}

/** 地點種類：美食與旅遊共用同一張地圖（使用者 2026-10-15 決定旅遊資料一起遷移） */
export type PlaceKind = 'food' | 'sight' | 'stay' | 'other'
export const PLACE_KINDS: PlaceKind[] = ['food', 'sight', 'stay', 'other']

/** 一張相片。url 只收 https:// 或站內 `/` 開頭的路徑（擋掉 javascript:、data: 等），thumb 是縮圖 */
export interface FoodPhoto {
  url: string
  thumb: string | null
  w: number | null
  h: number | null
  /** 拍攝時間 YYYY-MM-DD */
  takenAt: string | null
  caption: string | null
}

export interface FoodPlace {
  /** FOOD-0001，由萃取器配發，跨重跑穩定 */
  id: string
  name: string
  /** 城市＋區，例如「台北 大安」；給清單分組與篩選用 */
  area: string | null
  address: string | null
  lat: number | null
  lng: number | null
  /** 類型：拉麵、小吃、甜點… */
  cuisine: string | null
  tags: string[]
  status: FoodStatus
  /** 1–4（$ ~ $$$$） */
  priceLevel: number | null
  /** 為什麼想吃（日記原句） */
  why: string | null
  /** 誰推薦／在哪看到：我、朋友名、IG… */
  source: string | null
  mustTry: string[]
  /** 去過之後的評分 1–5 */
  rating: number | null
  /** 第一次出現在日記的日期 YYYY-MM-DD */
  addedAt: string
  /** 最近一次去的日期 YYYY-MM-DD */
  visitedAt: string | null
  /** 出現在哪幾天的日記（回溯原始紀錄用） */
  days: string[]
  mapUrl: string | null
  kind: PlaceKind
  /** 相片（封面是第一張）；沒有相片時是空陣列 */
  photos: FoodPhoto[]
}

export interface FoodData {
  available: boolean
  places: FoodPlace[]
  receivedAt: string | null
  /** true＝畫面顯示的是示範資料，不是知識庫的真資料 */
  sample?: boolean
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/
const isStr = (v: unknown): v is string => typeof v === 'string' && v.trim().length > 0
const strOrNull = (v: unknown): string | null => (isStr(v) ? v.trim() : null)
const numOrNull = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null)
const strList = (v: unknown): string[] => (Array.isArray(v) ? v.filter(isStr).map((s) => s.trim()) : [])

function inRange(v: number | null, lo: number, hi: number): number | null {
  return v !== null && v >= lo && v <= hi ? v : null
}

/** 只允許 https:// 或站內絕對路徑 `/…`（不含 `//`）；其他一律當作沒有 */
export function safeImageUrl(v: unknown): string | null {
  if (!isStr(v)) return null
  const u = v.trim()
  if (/^https:\/\/[^\s]+$/i.test(u)) return u
  if (/^\/(?!\/)[^\s]*$/.test(u)) return u
  return null
}

/** 驗證相片清單：壞的丟掉、最多 24 張（payload 太大時不讓整頁卡住） */
export function parsePhotos(v: unknown): FoodPhoto[] {
  if (!Array.isArray(v)) return []
  const out: FoodPhoto[] = []
  for (const item of v) {
    if (!item || typeof item !== 'object') continue
    const r = item as Record<string, unknown>
    const url = safeImageUrl(r['url'])
    if (!url) continue
    const takenAt = strOrNull(r['takenAt'])
    const w = numOrNull(r['w'])
    const h = numOrNull(r['h'])
    out.push({
      url,
      thumb: safeImageUrl(r['thumb']),
      w: w !== null && w > 0 ? w : null,
      h: h !== null && h > 0 ? h : null,
      takenAt: takenAt && DATE_RE.test(takenAt) ? takenAt : null,
      caption: strOrNull(r['caption']),
    })
    if (out.length >= 24) break
  }
  return out
}

/** 封面縮圖：第一張相片的縮圖，沒有縮圖就用原圖；沒有相片回 null */
export function coverPhoto(p: Pick<FoodPlace, 'photos'>): string | null {
  const f = p.photos[0]
  return f ? f.thumb ?? f.url : null
}

/** 驗證單筆；缺 id／name／合法 status／addedAt 的列整筆丟掉（回 null） */
export function parseFoodPlace(raw: unknown): FoodPlace | null {
  if (!raw || typeof raw !== 'object') return null
  const r = raw as Record<string, unknown>
  const id = strOrNull(r['id'])
  const name = strOrNull(r['name'])
  const status = r['status']
  const addedAt = strOrNull(r['addedAt'])
  if (!id || !name || !addedAt || !DATE_RE.test(addedAt)) return null
  if (typeof status !== 'string' || !(FOOD_STATUSES as string[]).includes(status)) return null
  let lat = inRange(numOrNull(r['lat']), -90, 90)
  let lng = inRange(numOrNull(r['lng']), -180, 180)
  if (lat === null || lng === null) {
    // 只給了 Google 地圖連結時，從連結裡拿座標（不用另外呼叫地理編碼服務）
    const fromUrl = coordsFromMapUrl(strOrNull(r['mapUrl']))
    lat = fromUrl?.lat ?? null
    lng = fromUrl?.lng ?? null
  }
  const visitedAt = strOrNull(r['visitedAt'])
  return {
    id, name,
    area: strOrNull(r['area']),
    address: strOrNull(r['address']),
    lat, lng,
    cuisine: strOrNull(r['cuisine']),
    tags: strList(r['tags']),
    status: status as FoodStatus,
    priceLevel: inRange(numOrNull(r['priceLevel']), 1, 4),
    why: strOrNull(r['why']),
    source: strOrNull(r['source']),
    mustTry: strList(r['mustTry']),
    rating: inRange(numOrNull(r['rating']), 1, 5),
    addedAt,
    visitedAt: visitedAt && DATE_RE.test(visitedAt) ? visitedAt : null,
    days: strList(r['days']).filter((d) => DATE_RE.test(d)),
    mapUrl: strOrNull(r['mapUrl']),
    kind: (PLACE_KINDS as string[]).includes(r['kind'] as string) ? (r['kind'] as PlaceKind) : 'food',
    photos: parsePhotos(r['photos']),
  }
}

/** 驗證整包 payload：`{ places: [...], receivedAt }`；格式不對回 available=false，不丟例外 */
export function parseFoodPayload(raw: unknown): FoodData {
  if (!raw || typeof raw !== 'object' || !Array.isArray((raw as Record<string, unknown>)['places'])) {
    return { available: false, places: [], receivedAt: null }
  }
  const r = raw as Record<string, unknown>
  const seen = new Set<string>()
  const places: FoodPlace[] = []
  for (const item of r['places'] as unknown[]) {
    const p = parseFoodPlace(item)
    if (p && !seen.has(p.id)) { seen.add(p.id); places.push(p) }
  }
  return { available: true, places, receivedAt: strOrNull(r['receivedAt']) }
}

/**
 * 從 Google 地圖分享連結取座標：`/@25.03,121.56,17z`、`?q=25.03,121.56`、`?ll=…`、`!3d25.03!4d121.56`。
 * 短網址（maps.app.goo.gl）沒有座標，回 null——要由萃取器展開或請 HERMES 補。
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

export type FoodStatusFilter = FoodStatus | 'been' | 'all'

export interface FoodFilter {
  /** 省略或 'all'＝美食與旅遊都要 */
  kind?: PlaceKind | 'all'
  status: FoodStatusFilter
  tag: string | null
  area: string | null
  query: string
}

export const isBeen = (s: FoodStatus) => s === 'visited' || s === 'favorite'

export function filterPlaces(places: FoodPlace[], f: FoodFilter): FoodPlace[] {
  const q = f.query.trim().toLowerCase()
  return places.filter((p) => {
    if (f.kind && f.kind !== 'all' && p.kind !== f.kind) return false
    if (f.status === 'been' ? !isBeen(p.status) : f.status !== 'all' && p.status !== f.status) return false
    if (f.tag && !p.tags.includes(f.tag) && p.cuisine !== f.tag) return false
    if (f.area && p.area !== f.area) return false
    if (!q) return true
    const hay = [p.name, p.area, p.address, p.cuisine, p.why, p.source, ...p.tags, ...p.mustTry].filter(Boolean).join(' ').toLowerCase()
    return hay.includes(q)
  })
}

export type FoodSort = 'oldestWant' | 'recent' | 'rating'

/**
 * oldestWant：想吃最久的排前面（「該去吃了吧」）；去過的接在後面依最近去過。
 * recent：最近加入／最近去過。rating：評分高的先，沒評分墊底。同分以 id 穩定排序。
 */
export function sortPlaces(places: FoodPlace[], mode: FoodSort): FoodPlace[] {
  const lastTouch = (p: FoodPlace) => (p.visitedAt && p.visitedAt > p.addedAt ? p.visitedAt : p.addedAt)
  const cmp: Record<FoodSort, (a: FoodPlace, b: FoodPlace) => number> = {
    oldestWant: (a, b) => {
      const aw = a.status === 'want' ? 0 : 1, bw = b.status === 'want' ? 0 : 1
      if (aw !== bw) return aw - bw
      if (aw === 0) return a.addedAt.localeCompare(b.addedAt)
      return lastTouch(b).localeCompare(lastTouch(a))
    },
    recent: (a, b) => lastTouch(b).localeCompare(lastTouch(a)),
    rating: (a, b) => (b.rating ?? 0) - (a.rating ?? 0),
  }
  return [...places].sort((a, b) => cmp[mode](a, b) || a.id.localeCompare(b.id))
}

export function daysBetween(fromIso: string, now: Date): number {
  const t = Date.parse(`${fromIso}T00:00:00+08:00`)
  if (!Number.isFinite(t)) return 0
  return Math.max(0, Math.floor((now.getTime() - t) / 86_400_000))
}

/** 想吃（美食）與想去（景點、住宿、其他）：同一個 want 狀態，依種類分開計 */
export const isWantEat = (p: FoodPlace): boolean => p.status === 'want' && p.kind === 'food'
export const isWantGo = (p: FoodPlace): boolean => p.status === 'want' && p.kind !== 'food'

/** 狀態篩選「想吃／想去」鈕的字：依目前選的種類顯示 */
export function wantFilterLabel(kind: PlaceKind | 'all' | undefined): string {
  return kind === 'food' ? '🔖 想吃' : kind === undefined || kind === 'all' ? '🔖 想吃／想去' : '🔖 想去'
}
/** 排序「等最久」鈕的字：依目前選的種類顯示 */
export function oldestWantSortLabel(kind: PlaceKind | 'all' | undefined): string {
  return kind === 'food' ? '想吃最久' : kind === undefined || kind === 'all' ? '想吃／想去最久' : '想去最久'
}

export interface FoodStats {
  total: number
  /** 想吃＋想去（全部 want） */
  want: number
  /** 想吃（美食）與想去（非美食）各幾個，以及各自等最久的一個 */
  wantEat: number
  wantGo: number
  oldestWantEat: { place: FoodPlace; days: number } | null
  oldestWantGo: { place: FoodPlace; days: number } | null
  been: number
  favorite: number
  /** 去過 ÷（想吃＋去過），不含「不再去」；沒有資料回 null */
  conversionPct: number | null
  oldestWant: { place: FoodPlace; days: number } | null
  /** 今年（台北時間）去過幾家 */
  beenThisYear: number
  /** 有座標、畫得上地圖的筆數 */
  mapped: number
}

function oldestOf(list: FoodPlace[], now: Date): { place: FoodPlace; days: number } | null {
  const o = [...list].sort((a, b) => a.addedAt.localeCompare(b.addedAt) || a.id.localeCompare(b.id))[0]
  return o ? { place: o, days: daysBetween(o.addedAt, now) } : null
}

export function foodStats(places: FoodPlace[], now: Date): FoodStats {
  const want = places.filter((p) => p.status === 'want')
  const been = places.filter((p) => isBeen(p.status))
  const denom = want.length + been.length
  const oldest = [...want].sort((a, b) => a.addedAt.localeCompare(b.addedAt) || a.id.localeCompare(b.id))[0]
  const year = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Taipei', year: 'numeric' }).format(now)
  return {
    total: places.length,
    want: want.length,
    wantEat: want.filter(isWantEat).length,
    wantGo: want.filter(isWantGo).length,
    oldestWantEat: oldestOf(want.filter(isWantEat), now),
    oldestWantGo: oldestOf(want.filter(isWantGo), now),
    been: been.length,
    favorite: places.filter((p) => p.status === 'favorite').length,
    conversionPct: denom ? Math.round((been.length / denom) * 100) : null,
    oldestWant: oldest ? { place: oldest, days: daysBetween(oldest.addedAt, now) } : null,
    beenThisYear: been.filter((p) => p.visitedAt?.startsWith(year)).length,
    mapped: places.filter((p) => p.lat !== null && p.lng !== null).length,
  }
}

/** 標籤＋類型出現次數，多的在前（同數依字典序），給篩選膠囊用 */
export function tagCounts(places: FoodPlace[]): Array<[string, number]> {
  const m = new Map<string, number>()
  for (const p of places) {
    const keys = new Set([...(p.cuisine ? [p.cuisine] : []), ...p.tags])
    for (const k of keys) m.set(k, (m.get(k) ?? 0) + 1)
  }
  return [...m.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
}

export function areaCounts(places: FoodPlace[]): Array<[string, number]> {
  const m = new Map<string, number>()
  for (const p of places) if (p.area) m.set(p.area, (m.get(p.area) ?? 0) + 1)
  return [...m.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
}

export interface MapPoint { id: string; x: number; y: number; status: FoodStatus }
export interface MapProjection {
  points: MapPoint[]
  bounds: { minLat: number; maxLat: number; minLng: number; maxLng: number }
}

/** 沒有任何座標時的預設範圍：台灣本島 */
export const TAIWAN_BOUNDS = { minLat: 21.85, maxLat: 25.35, minLng: 119.95, maxLng: 122.05 }

/**
 * 原型用的無底圖投影：等距圓柱＋cos(緯度) 修正，保持長寬比、置中在 w×h 裡。
 * 範圍取有座標的點外擴 15%（至少 0.02 度，避免只有一家店時除以 0）。
 * 正式版改用 Leaflet／MapLibre 加底圖時，這個函式只留給「沒有網路底圖」的退路。
 */
export function projectPlaces(places: FoodPlace[], w: number, h: number, pad = 16): MapProjection {
  const geo = places.filter((p): p is FoodPlace & { lat: number; lng: number } => p.lat !== null && p.lng !== null)
  let b = { ...TAIWAN_BOUNDS }
  if (geo.length) {
    const lats = geo.map((p) => p.lat), lngs = geo.map((p) => p.lng)
    const minLat = Math.min(...lats), maxLat = Math.max(...lats), minLng = Math.min(...lngs), maxLng = Math.max(...lngs)
    const dLat = Math.max(0.02, (maxLat - minLat) * 0.15), dLng = Math.max(0.02, (maxLng - minLng) * 0.15)
    b = { minLat: minLat - dLat, maxLat: maxLat + dLat, minLng: minLng - dLng, maxLng: maxLng + dLng }
  }
  const k = Math.cos((((b.minLat + b.maxLat) / 2) * Math.PI) / 180)
  const spanX = (b.maxLng - b.minLng) * k
  const spanY = b.maxLat - b.minLat
  const scale = Math.min((w - 2 * pad) / spanX, (h - 2 * pad) / spanY)
  const offX = (w - spanX * scale) / 2
  const offY = (h - spanY * scale) / 2
  const points = geo.map((p) => ({
    id: p.id,
    x: Math.round((offX + (p.lng - b.minLng) * k * scale) * 10) / 10,
    y: Math.round((offY + (b.maxLat - p.lat) * scale) * 10) / 10,
    status: p.status,
  }))
  return { points, bounds: b }
}

/** 可以從目前狀態改成哪些狀態（給「複製給 HERMES」按鈕） */
export function nextFoodStatuses(s: FoodStatus): FoodStatus[] {
  return FOOD_STATUSES.filter((x) => x !== s)
}

/**
 * 複製到 Telegram 給 HERMES 的那句話（入口網不寫入）：
 * `🍜✅ FOOD-0003「拉麵店」去過 評分 4｜補充`
 */
export function foodStatusMessage(p: FoodPlace, next: FoodStatus, rating: number | null, note: string): string {
  const parts = [`${FOOD_STATUS_MARK[next]} ${p.id}「${p.name}」${FOOD_STATUS_LABEL[next]}`]
  if (rating !== null && isBeen(next)) parts.push(`評分 ${Math.min(5, Math.max(1, Math.round(rating)))}`)
  const n = note.trim()
  return parts.join(' ') + (n ? `｜${n}` : '')
}

export const priceLabel = (n: number | null) => (n === null ? '—' : '$'.repeat(n))
export const stars = (n: number | null) => (n === null ? '—' : '★'.repeat(n) + '☆'.repeat(5 - n))

// ─────────────────────────────────────────────
// 📍 附近：以目前位置為基準，由近到遠列出有座標的地點（手機隨身用）。
// 位置只在瀏覽器裡計算，不送到任何伺服器；沒有座標的地點算不出距離，另外計數。
// ─────────────────────────────────────────────

export interface LatLng { lat: number; lng: number }

export const KIND_LABEL: Record<PlaceKind, string> = { food: '美食', sight: '旅遊景點', stay: '住宿', other: '其他' }
export const KIND_ICON: Record<PlaceKind, string> = { food: '🍜', sight: '🧭', stay: '🛏️', other: '📍' }

/** 想吃（美食）／想去（旅遊等）：同一個 want 狀態，說法依種類不同 */
export function statusLabelFor(kind: PlaceKind, s: FoodStatus): string {
  if (s === 'want') return kind === 'food' ? '想吃' : '想去'
  if (s === 'visited') return kind === 'food' ? '去過' : '去過'
  return FOOD_STATUS_LABEL[s]
}

/** 兩點的球面距離（公尺，haversine） */
export function distanceM(a: LatLng, b: LatLng): number {
  const R = 6371008.8
  const rad = Math.PI / 180
  const dLat = (b.lat - a.lat) * rad
  const dLng = (b.lng - a.lng) * rad
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLng / 2) ** 2
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)))
}

/** 從 a 看向 b 的方位角（0＝北，順時針，0–360） */
export function bearingDeg(a: LatLng, b: LatLng): number {
  const rad = Math.PI / 180
  const dLng = (b.lng - a.lng) * rad
  const y = Math.sin(dLng) * Math.cos(b.lat * rad)
  const x = Math.cos(a.lat * rad) * Math.sin(b.lat * rad) - Math.sin(a.lat * rad) * Math.cos(b.lat * rad) * Math.cos(dLng)
  return (Math.atan2(y, x) / rad + 360) % 360
}

const DIRS = ['北', '東北', '東', '東南', '南', '西南', '西', '西北']
export const bearingLabel = (deg: number) => DIRS[Math.round((((deg % 360) + 360) % 360) / 45) % 8]!

/** 100 公尺以內顯示到 10 公尺；1 公里以內到整數公尺；之後 km 一位小數；100 公里以上取整數 */
export function formatDistance(m: number): string {
  if (!Number.isFinite(m) || m < 0) return '—'
  if (m < 100) return `${Math.max(10, Math.round(m / 10) * 10)} m`
  if (m < 1000) return `${Math.round(m / 10) * 10} m`
  const km = m / 1000
  return km < 100 ? `${km.toFixed(1)} km` : `${Math.round(km)} km`
}

export interface NearbyItem { place: FoodPlace; meters: number; bearing: number }
export interface NearbyResult { items: NearbyItem[]; unmapped: number }

/**
 * 由近到遠。radiusM 為 null＝不限距離；wishOnly＝只留還沒去的（want）。
 * 距離相同時用 id 排序，結果穩定。unmapped＝符合其他條件、但沒有座標而算不出距離的筆數。
 */
export function nearbyPlaces(places: FoodPlace[], origin: LatLng, opts: { radiusM: number | null; wishOnly: boolean }): NearbyResult {
  const items: NearbyItem[] = []
  let unmapped = 0
  for (const p of places) {
    if (opts.wishOnly && p.status !== 'want') continue
    if (p.lat === null || p.lng === null) { unmapped += 1; continue }
    const at = { lat: p.lat, lng: p.lng }
    const meters = distanceM(origin, at)
    if (opts.radiusM !== null && meters > opts.radiusM) continue
    items.push({ place: p, meters, bearing: bearingDeg(origin, at) })
  }
  items.sort((a, b) => a.meters - b.meters || a.place.id.localeCompare(b.place.id))
  return { items, unmapped }
}

/** 開啟 Google 地圖導航（手機會喚起地圖 App）；沒有座標回 null。只是一般連結，不需要金鑰。 */
export function navigateUrl(p: Pick<FoodPlace, 'lat' | 'lng'>): string | null {
  if (p.lat === null || p.lng === null) return null
  return `https://www.google.com/maps/dir/?api=1&destination=${p.lat},${p.lng}`
}
