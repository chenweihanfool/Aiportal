// 週／月報的圖表資料：用入口網已經有的想法庫（/api/hermes-ideas）、地點（/api/hermes-places）、遊記（/api/hermes-trips）
// 依報告的涵蓋期間現算——任何一期（含歷史）都有圖，不需要另外推送統計。純函式，不碰 DOM／網路。
// 設計：kb-pipeline docs/report-visual-design.md（2026-10-23 修訂：圖表整合進時間軸的報告，不另開頁面）。
// 旅遊只算有趟次檔的旅程（使用者 2026-10-22 裁定），日記裡的 🗺️ 景點不算。
import type { IdeaItem, IdeasData } from './boardApi'
import type { FoodPlace } from './foodMap'
import type { Trip } from './tripsApi'

export type Range = readonly [string, string]
export interface SeriesRow { date: string; ideas: number; food: number; travel: number }
export interface Pin { name: string; lat: number; lng: number; status: 'visited' | 'favorite' | 'want' }
export interface TripBar { id: string; title: string; start: string; end: string; daysInPeriod: number; photos: number; area: string | null }
export type Funnel = Record<'new' | 'evaluating' | 'doing' | 'done', number>

export interface PeriodReport {
  range: [string, string]
  /** 這一期還沒結束（結束日晚於今天） */
  partial: boolean
  ideas: {
    new: number; done: number; started: number; openAtEnd: number; doneRate: number | null
    funnel: Funnel
    byCategory: Record<string, number>
    /** 只在這一期含「今天」時有值：目前最值得先做的前三名（分數由伺服器依幸福指數最弱面向加權） */
    top3: Array<{ id: string; title: string; why: string[] }>
    oldestOpen: { id: string; title: string; days: number } | null
  }
  food: {
    added: number; visited: number; wantBacklog: number; avgRating: number | null
    byCuisine: Record<string, number>; byArea: Record<string, number>
    pins: Pin[]; oldestWant: { name: string; days: number } | null
  }
  travel: { trips: TripBar[]; tripDays: number; photos: number; areas: string[] }
  prev: { range: [string, string]; ideas: { new: number; done: number }; food: { added: number; visited: number }; travel: { tripDays: number; trips: number } }
  series: SeriesRow[]
}

export interface StatsInput {
  ideas: readonly IdeaItem[]
  /** 想法庫目前的前三名 id（IdeasData.top） */
  top: readonly string[]
  places: readonly FoodPlace[]
  trips: readonly Trip[]
}

export const MAX_PINS = 100
const OPEN = new Set(['new', 'evaluating', 'doing'])
const DAY_MS = 86_400_000

const dayNum = (d: string) => Math.floor(Date.parse(`${d.slice(0, 10)}T00:00:00Z`) / DAY_MS)
const fromNum = (n: number) => new Date(n * DAY_MS).toISOString().slice(0, 10)
const valid = (d: string | null | undefined): d is string => typeof d === 'string' && Number.isFinite(dayNum(d))
const inRange = (d: string | null | undefined, r: Range): boolean => valid(d) && d.slice(0, 10) >= r[0] && d.slice(0, 10) <= r[1]

/** 區間的天數（含頭尾）；壞區間回 0 */
export function spanDays(r: Range): number {
  const n = dayNum(r[1]) - dayNum(r[0]) + 1
  return Number.isFinite(n) && n > 0 ? n : 0
}

/** 上一期：整個日曆月 → 上一個日曆月（月報不能用「往前推 31 天」，會跨月錯位）；其餘 → 緊接在前、長度相同的一段 */
export function prevRange(r: Range): [string, string] {
  const s = dayNum(r[0])
  if (r[0].slice(8, 10) === '01' && r[1] === fromNum(dayNum(nextMonthStart(r[0])) - 1)) {
    const end = fromNum(s - 1)
    return [`${end.slice(0, 8)}01`, end]
  }
  const n = spanDays(r)
  return [fromNum(s - n), fromNum(s - 1)]
}

/** 下個月 1 號 */
function nextMonthStart(d: string): string {
  const y = Number(d.slice(0, 4)), m = Number(d.slice(5, 7))
  return m === 12 ? `${y + 1}-01-01` : `${y}-${String(m + 1).padStart(2, '0')}-01`
}

export function eachDay(r: Range): string[] {
  const n = spanDays(r)
  const s = dayNum(r[0])
  return Array.from({ length: n }, (_, i) => fromNum(s + i))
}

const count = (items: Iterable<string | null | undefined>): Record<string, number> => {
  const out: Record<string, number> = {}
  for (const x of items) if (x) out[x] = (out[x] ?? 0) + 1
  return Object.fromEntries(Object.entries(out).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])))
}

function ideasStats(input: StatsInput, r: Range, today: string): PeriodReport['ideas'] {
  const all = input.ideas
  const born = all.filter((it) => inRange(it.bornAt, r))
  const hist = (it: IdeaItem, status: string) => (it.history ?? []).some((h) => h.status === status && inRange(h.at, r))
  const done = all.filter((it) => hist(it, 'done'))
  const started = all.filter((it) => hist(it, 'doing'))
  const open = all.filter((it) => OPEN.has(it.status) && valid(it.bornAt) && it.bornAt.slice(0, 10) <= r[1])
  const base = done.length + open.length
  const funnel: Funnel = { new: 0, evaluating: 0, doing: 0, done: 0 }
  for (const it of born) if (it.status in funnel) funnel[it.status as keyof Funnel] += 1
  const oldest = open.filter((it) => valid(it.bornAt)).sort((a, b) => a.bornAt.localeCompare(b.bornAt) || a.id.localeCompare(b.id))[0]
  const byId = new Map(all.map((it) => [it.id, it]))
  const includesToday = r[0] <= today && today <= r[1]
  return {
    new: born.length, done: done.length, started: started.length, openAtEnd: open.length,
    doneRate: base > 0 ? Math.round((done.length / base) * 100) / 100 : null,
    funnel,
    byCategory: count(born.map((it) => it.category)),
    top3: includesToday
      ? input.top.slice(0, 3).flatMap((id) => { const it = byId.get(id); return it ? [{ id: it.id, title: it.title, why: it.scoreWhy ?? [] }] : [] })
      : [],
    oldestOpen: oldest ? { id: oldest.id, title: oldest.title, days: dayNum(r[1]) - dayNum(oldest.bornAt) } : null,
  }
}

const placeDates = (p: FoodPlace): string[] => [...(p.days ?? []), p.addedAt, p.visitedAt ?? ''].filter(valid)
const touched = (p: FoodPlace, r: Range) => placeDates(p).some((d) => inRange(d, r))

function foodStats(places: readonly FoodPlace[], r: Range): PeriodReport['food'] {
  const food = places.filter((p) => p.kind === 'food')
  const added = food.filter((p) => inRange(p.addedAt, r))
  const visited = food.filter((p) => (p.status === 'visited' || p.status === 'favorite') && inRange(p.visitedAt, r))
  const touch = food.filter((p) => touched(p, r))
  const want = food.filter((p) => p.status === 'want' && (!valid(p.addedAt) || p.addedAt <= r[1]))
  const rated = visited.map((p) => p.rating).filter((v): v is number => typeof v === 'number')
  const oldest = want.filter((p) => valid(p.addedAt)).sort((a, b) => a.addedAt.localeCompare(b.addedAt) || a.name.localeCompare(b.name))[0]
  const visitedSet = new Set(visited)
  return {
    added: added.length, visited: visited.length, wantBacklog: want.length,
    avgRating: rated.length ? Math.round((rated.reduce((a, b) => a + b, 0) / rated.length) * 10) / 10 : null,
    byCuisine: count(touch.map((p) => p.cuisine)), byArea: count(touch.map((p) => p.area)),
    pins: touch.filter((p) => p.lat !== null && p.lng !== null)
      .map((p): Pin => ({ name: p.name, lat: p.lat as number, lng: p.lng as number, status: visitedSet.has(p) ? 'visited' : p.status === 'favorite' ? 'favorite' : 'want' }))
      .slice(0, MAX_PINS),
    oldestWant: oldest ? { name: oldest.name, days: dayNum(r[1]) - dayNum(oldest.addedAt) } : null,
  }
}

function travelStats(trips: readonly Trip[], r: Range): PeriodReport['travel'] {
  const out: TripBar[] = []
  const tripDays = new Set<string>()
  let photos = 0
  for (const t of trips) {
    if (!valid(t.start) || !valid(t.end) || t.end < r[0] || t.start > r[1]) continue
    const lo = t.start > r[0] ? t.start : r[0]
    const hi = t.end < r[1] ? t.end : r[1]
    eachDay([lo, hi]).forEach((d) => tripDays.add(d))
    const ph = t.days.filter((d) => inRange(d.date, r)).reduce((n, d) => n + d.entries.reduce((m, e) => m + e.photos.length + e.photosPending, 0), 0)
    photos += ph
    out.push({ id: t.id, title: t.name, start: t.start, end: t.end, daysInPeriod: spanDays([lo, hi]), photos: ph, area: t.area })
  }
  return { trips: out, tripDays: tripDays.size, photos, areas: [...new Set(out.flatMap((t) => (t.area ? [t.area] : [])))].sort() }
}

function series(input: StatsInput, r: Range): SeriesRow[] {
  const born = count(input.ideas.filter((it) => valid(it.bornAt)).map((it) => it.bornAt.slice(0, 10)))
  const food: Record<string, number> = {}
  for (const p of input.places) {
    if (p.kind !== 'food') continue
    for (const d of [p.addedAt, p.visitedAt]) if (valid(d)) food[d] = (food[d] ?? 0) + 1
  }
  const tripDay = new Set<string>()
  for (const t of input.trips) if (valid(t.start) && valid(t.end)) eachDay([t.start, t.end]).forEach((d) => tripDay.add(d))
  return eachDay(r).map((date) => ({ date, ideas: born[date] ?? 0, food: food[date] ?? 0, travel: tripDay.has(date) ? 1 : 0 }))
}

/** 一期的圖表資料。r＝報告的涵蓋期間（含頭尾）；壞區間（起日晚於迄日、不是日期）回 null。 */
export function buildPeriodReport(input: StatsInput, r: Range, today: string): PeriodReport | null {
  if (spanDays(r) === 0) return null
  const pr = prevRange(r)
  const cur = { ideas: ideasStats(input, r, today), food: foodStats(input.places, r), travel: travelStats(input.trips, r) }
  const pIdeas = ideasStats(input, pr, today), pFood = foodStats(input.places, pr), pTravel = travelStats(input.trips, pr)
  return {
    range: [r[0], r[1]], partial: r[1] > today, ...cur,
    prev: {
      range: pr, ideas: { new: pIdeas.new, done: pIdeas.done }, food: { added: pFood.added, visited: pFood.visited },
      travel: { tripDays: pTravel.tripDays, trips: pTravel.trips.length },
    },
    series: series(input, r),
  }
}

export const inputFromData = (ideas: IdeasData | null, places: readonly FoodPlace[] | null, trips: readonly Trip[] | null): StatsInput => ({
  ideas: ideas?.ideas ?? [], top: ideas?.top ?? [], places: places ?? [], trips: trips ?? [],
})
