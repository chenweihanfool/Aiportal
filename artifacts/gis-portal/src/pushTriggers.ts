// 第 4 期 4-4 前端的純邏輯（無 React、無 DOM、無網路）：📌 提醒的日期選項與卡片、📍 附近、會前卡、卡片排序。
// 網路在 pushTriggersApi.ts；畫面在 PinButton.tsx 與 NowSection.tsx。契約見 docs/push-feedback-api.md。
import { addDays, cardKeyOf, type NowCard } from './nowCards'
import { knowledgeHref } from './topicNudges'
import { dossierHref, type DossierKind } from './dossier'
import { openAction, type SearchKind } from './omniSearch'

const TPE_OFFSET_MS = 8 * 3_600_000
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/

/** 台北日期 YYYY-MM-DD */
export const taipeiDate = (ms: number): string => new Date(ms + TPE_OFFSET_MS).toISOString().slice(0, 10)

/** 台北時間 HH:MM */
export const taipeiHm = (ms: number): string => new Date(ms + TPE_OFFSET_MS).toISOString().slice(11, 16)

/** YYYY-MM-DD → M/D（不補零） */
export const mdLabel = (date: string): string => {
  const m = /^\d{4}-(\d{2})-(\d{2})/.exec(date)
  return m ? `${Number(m[1])}/${Number(m[2])}` : date
}

// ─────────────────────────────────────────────
// 📌 日期選項
// ─────────────────────────────────────────────

export const PIN_MAX_DAYS = 366

export interface PinDueOption { id: 'tomorrow' | 'monday'; label: string; date: string }

/** 明天早上、下週一（今天之後的第一個週一；今天是週一＝7 天後） */
export function pinDueOptions(todayTpe: string): PinDueOption[] {
  const dow = new Date(`${todayTpe}T00:00:00Z`).getUTCDay()
  const ahead = (1 - dow + 7) % 7 || 7
  return [
    { id: 'tomorrow', label: '明天早上', date: addDays(todayTpe, 1) },
    { id: 'monday', label: '下週一', date: addDays(todayTpe, ahead) },
  ]
}

/** 自訂日期的合法範圍：今天～今天＋366 天 */
export const pinDateRange = (todayTpe: string): { min: string; max: string } => ({ min: todayTpe, max: addDays(todayTpe, PIN_MAX_DAYS) })

export const pinDateValid = (date: string, todayTpe: string): boolean => {
  if (!DATE_RE.test(date)) return false
  const { min, max } = pinDateRange(todayTpe)
  return date >= min && date <= max
}

// ─────────────────────────────────────────────
// 📌 釘選卡
// ─────────────────────────────────────────────

export interface Pin { id: number; targetKind: string; targetId: string; title: string; href: string; dueDate: string; createdAt: string }

/** GET /api/push/pins 的寬容解析：格式不對的項目略過 */
export function parsePins(raw: unknown): Pin[] {
  const list = (raw as { pins?: unknown } | null)?.pins
  if (!Array.isArray(list)) return []
  const out: Pin[] = []
  for (const p of list) {
    if (!p || typeof p !== 'object') continue
    const r = p as Record<string, unknown>
    if (typeof r.id !== 'number' || !Number.isInteger(r.id)) continue
    if (typeof r.title !== 'string' || typeof r.href !== 'string' || typeof r.dueDate !== 'string') continue
    out.push({
      id: r.id, targetKind: typeof r.targetKind === 'string' ? r.targetKind : '', targetId: typeof r.targetId === 'string' ? r.targetId : '',
      title: r.title, href: r.href, dueDate: r.dueDate, createdAt: typeof r.createdAt === 'string' ? r.createdAt : '',
    })
  }
  return out
}

export const RANK_MEETING = -2
export const RANK_PINNED = -1
export const RANK_NEARBY = 5

export function pinnedCards(pins: readonly Pin[], today: string): NowCard[] {
  return pins.map((p) => ({
    key: cardKeyOf({ kind: 'pinned', id: p.id }), kind: 'pinned' as const, forDate: today, at: null,
    why: '你釘選的提醒', title: p.title, lines: [`你在 ${mdLabel(p.dueDate)} 要我提醒`], point: '', rank: RANK_PINNED,
    href: p.href, pinId: p.id,
  }))
}

// ─────────────────────────────────────────────
// 📍 附近
// ─────────────────────────────────────────────

export interface LatLng { lat: number; lng: number }
export const NEARBY_METERS = 1000

export function haversineMeters(a: LatLng, b: LatLng): number {
  const R = 6_371_000
  const rad = (d: number) => (d * Math.PI) / 180
  const dLat = rad(b.lat - a.lat)
  const dLng = rad(b.lng - a.lng)
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)))
}

/** 距離 here 最近、且不超過 maxMeters（含）的一個地點；沒有座標的略過；沒有就 null */
export function nearestPlace<T extends { lat: number | null; lng: number | null }>(places: readonly T[], here: LatLng, maxMeters = NEARBY_METERS): { place: T; meters: number } | null {
  let best: { place: T; meters: number } | null = null
  for (const p of places) {
    if (typeof p.lat !== 'number' || typeof p.lng !== 'number' || !Number.isFinite(p.lat) || !Number.isFinite(p.lng)) continue
    const meters = haversineMeters(here, { lat: p.lat, lng: p.lng })
    if (meters <= maxMeters && (best === null || meters < best.meters)) best = { place: p, meters }
  }
  return best
}

export function nearbyCard(place: { id: string; name: string }, meters: number, today: string): NowCard {
  return {
    key: cardKeyOf({ kind: 'nearby', placeId: place.id, date: today }), kind: 'nearby', forDate: today, at: null,
    why: '你就在附近', title: place.name, lines: [`距離約 ${Math.round(meters)} 公尺`], point: '', rank: RANK_NEARBY, href: '#food',
  }
}

// ─────────────────────────────────────────────
// 會前卡
// ─────────────────────────────────────────────

export interface CalendarEvent { start: string; end: string; allDay: boolean; title: string; location: string }
export interface CalendarFeed { computedAt: string; date: string; events: CalendarEvent[] }
export interface MeetingMatch { label: string; href: string }
export type MeetingMatcher = (title: string) => MeetingMatch | null

export const MEETING_WINDOW_MIN = 60

/** feed 外殼（{available, payload}）或已拆開的內容；還沒推過（available:false）、格式不對一律回 null＝今天沒有行程 */
export function parseCalendarFeed(raw: unknown): CalendarFeed | null {
  const root = raw as { available?: boolean; payload?: unknown } | null
  if (!root || typeof root !== 'object') return null
  const p = (root.payload !== undefined ? root.payload : root.available === undefined ? root : null) as Partial<CalendarFeed> | null
  if (!p || typeof p !== 'object' || typeof p.date !== 'string' || !Array.isArray(p.events)) return null
  const events: CalendarEvent[] = []
  for (const e of p.events) {
    if (!e || typeof e !== 'object') continue
    const r = e as Record<string, unknown>
    if (typeof r.start !== 'string' || typeof r.title !== 'string') continue
    events.push({
      start: r.start, end: typeof r.end === 'string' ? r.end : '', allDay: r.allDay === true, title: r.title, location: typeof r.location === 'string' ? r.location : '',
    })
  }
  return { computedAt: typeof p.computedAt === 'string' ? p.computedAt : '', date: p.date, events }
}

/** 開始前 0～60 分鐘（含）、非全天、feed 是今天（台北）、matcher 比得到才出卡 */
export function meetingCards(feed: CalendarFeed | null, nowMs: number, matcher: MeetingMatcher): NowCard[] {
  if (!feed) return []
  const today = taipeiDate(nowMs)
  if (feed.date !== today) return []
  const out: NowCard[] = []
  const seen = new Set<string>()
  for (const e of feed.events) {
    if (e.allDay) continue
    const startMs = Date.parse(e.start)
    if (!Number.isFinite(startMs)) continue
    const diffMin = (startMs - nowMs) / 60_000
    if (diffMin < 0 || diffMin > MEETING_WINDOW_MIN) continue
    const m = matcher(e.title)
    if (!m) continue
    const key = cardKeyOf({ kind: 'meeting', date: feed.date, start: e.start })
    if (seen.has(key)) continue
    seen.add(key)
    const hm = taipeiHm(startMs)
    out.push({
      key, kind: 'meeting', forDate: today, at: hm,
      why: '行程快開始了', title: `${hm} ${e.title}`, lines: [`會前看：${m.label}`], point: '', rank: RANK_MEETING, href: m.href,
    })
  }
  return out
}

/** 用知識題目與卷宗名稱做子字串比對（名稱至少 2 字；知識頁優先、同類取最長名稱） */
export function makeMeetingMatcher(topics: ReadonlyArray<{ id: string; name: string }>, dossiers: ReadonlyArray<{ kind: DossierKind; name: string }>): MeetingMatcher {
  const byLen = <T extends { name: string }>(xs: readonly T[]) => xs.filter((x) => x.name.trim().length >= 2).sort((a, b) => b.name.length - a.name.length)
  const ts = byLen(topics)
  const ds = byLen(dossiers)
  return (title) => {
    const t = ts.find((x) => title.includes(x.name.trim()))
    if (t) return { label: t.name, href: knowledgeHref(t.id) }
    const d = ds.find((x) => title.includes(x.name.trim()))
    if (d) return { label: d.name, href: dossierHref(d.kind, d.name) }
    return null
  }
}

/** 排序：meeting 最前，其次 pinned，其餘保持原順序 */
export function orderTriggerFirst(cards: readonly NowCard[]): NowCard[] {
  const meeting = cards.filter((c) => c.kind === 'meeting')
  const pinned = cards.filter((c) => c.kind === 'pinned')
  const rest = cards.filter((c) => c.kind !== 'meeting' && c.kind !== 'pinned')
  return [...meeting, ...pinned, ...rest]
}

// ─────────────────────────────────────────────
// 📌 按鈕的目標（搜尋命中 → 釘選內容）
// ─────────────────────────────────────────────

export type PinTargetKind = 'case' | 'person' | 'object' | 'topic' | 'event' | 'concept' | 'method' | 'source' | 'idea' | 'place' | 'trip'
export interface PinTarget { targetKind: PinTargetKind; targetId: string; title: string; href: string }

/** 搜尋命中的釘選目標；開啟動作沒有 hash 的類別（想法、事件、工具、日記…）回 null＝不顯示按鈕 */
export function pinTargetFor(item: { kind: SearchKind; id: string; title: string }): PinTarget | null {
  const a = openAction(item.kind, item.id)
  const href = a.type === 'hash' ? `#${a.hash}` : a.type === 'dossier' ? dossierHref(a.kind, a.name) : null
  if (!href || item.kind === 'tool' || item.kind === 'diary') return null
  return { targetKind: item.kind, targetId: item.id, title: item.title, href }
}
