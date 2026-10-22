// 週／月報的視覺化統計（feed kb-report-stats v1；推送端 kb-pipeline scripts/report-stats-pusher.py，自己節流成約每小時一次）。
// 這裡只負責取回與逐欄防呆：推送端以後加欄位不會弄壞畫面，缺欄位一律當 0／空。數字怎麼算見 kb-pipeline docs/report-visual-design.md。
const API_BASE = import.meta.env.BASE_URL ?? '/'

export type ReportPeriod = 'week' | 'month'
export interface SeriesRow { date: string; ideas: number; food: number; travel: number }
export interface Pin { name: string; lat: number; lng: number; status: 'visited' | 'favorite' | 'want' }
export interface TripBar { id: string; title: string; start: string; end: string; daysInPeriod: number; photos: number; area: string | null }
export interface Report {
  period: ReportPeriod
  range: [string, string]
  partial: boolean
  ideas: {
    new: number; done: number; started: number; openAtEnd: number; doneRate: number | null
    funnel: Record<'new' | 'evaluating' | 'doing' | 'done', number>
    byCategory: Record<string, number>
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
export interface ReportsFeed { computedAt: string; reports: Report[]; warnings: string[] }

const rec = (v: unknown): Record<string, unknown> => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {})
const num = (v: unknown, d = 0): number => (typeof v === 'number' && Number.isFinite(v) ? v : d)
const numOrNull = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null)
const str = (v: unknown, d = ''): string => (typeof v === 'string' ? v : d)
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : [])
const counts = (v: unknown): Record<string, number> => {
  const out: Record<string, number> = {}
  for (const [k, n] of Object.entries(rec(v))) if (typeof n === 'number' && Number.isFinite(n)) out[k] = n
  return out
}
const pair = (v: unknown): [string, string] | null => {
  const a = arr(v)
  return a.length === 2 && typeof a[0] === 'string' && typeof a[1] === 'string' ? [a[0], a[1]] : null
}

export function parseReport(raw: unknown): Report | null {
  const r = rec(raw)
  const period = r.period === 'week' || r.period === 'month' ? r.period : null
  const range = pair(r.range)
  if (!period || !range) return null
  const ideas = rec(r.ideas), food = rec(r.food), travel = rec(r.travel), prev = rec(r.prev), meta = rec(r.meta)
  const funnel = rec(ideas.funnel)
  const oldestOpen = rec(ideas.oldestOpen), oldestWant = rec(food.oldestWant)
  const pIdeas = rec(prev.ideas), pFood = rec(prev.food), pTravel = rec(prev.travel)
  return {
    period, range, partial: meta.partial === true,
    ideas: {
      new: num(ideas.new), done: num(ideas.done), started: num(ideas.started), openAtEnd: num(ideas.openAtEnd), doneRate: numOrNull(ideas.doneRate),
      funnel: { new: num(funnel.new), evaluating: num(funnel.evaluating), doing: num(funnel.doing), done: num(funnel.done) },
      byCategory: counts(ideas.byCategory),
      top3: arr(ideas.top3).map(rec).filter((t) => typeof t.id === 'string' && typeof t.title === 'string')
        .map((t) => ({ id: str(t.id), title: str(t.title), why: arr(t.why).filter((w): w is string => typeof w === 'string') })),
      oldestOpen: typeof oldestOpen.id === 'string' ? { id: str(oldestOpen.id), title: str(oldestOpen.title), days: num(oldestOpen.days) } : null,
    },
    food: {
      added: num(food.added), visited: num(food.visited), wantBacklog: num(food.wantBacklog), avgRating: numOrNull(food.avgRating),
      byCuisine: counts(food.byCuisine), byArea: counts(food.byArea),
      pins: arr(food.pins).map(rec).filter((p) => typeof p.lat === 'number' && typeof p.lng === 'number')
        .map((p) => ({ name: str(p.name, '—'), lat: num(p.lat), lng: num(p.lng), status: p.status === 'visited' || p.status === 'favorite' ? p.status : 'want' })),
      oldestWant: typeof oldestWant.name === 'string' ? { name: str(oldestWant.name), days: num(oldestWant.days) } : null,
    },
    travel: {
      trips: arr(travel.trips).map(rec).filter((t) => typeof t.id === 'string')
        .map((t) => ({ id: str(t.id), title: str(t.title, str(t.id)), start: str(t.start), end: str(t.end), daysInPeriod: num(t.daysInPeriod), photos: num(t.photos), area: typeof t.area === 'string' ? t.area : null })),
      tripDays: num(travel.tripDays), photos: num(travel.photos), areas: arr(travel.areas).filter((a): a is string => typeof a === 'string'),
    },
    prev: {
      range: pair(prev.range) ?? ['', ''],
      ideas: { new: num(pIdeas.new), done: num(pIdeas.done) },
      food: { added: num(pFood.added), visited: num(pFood.visited) },
      travel: { tripDays: num(pTravel.tripDays), trips: num(pTravel.trips) },
    },
    series: arr(r.series).map(rec).filter((s) => typeof s.date === 'string')
      .map((s) => ({ date: str(s.date), ideas: num(s.ideas), food: num(s.food), travel: num(s.travel) })),
  }
}

/** 推送端還沒推過／格式不對 → null（畫面顯示「還沒有資料」，不是錯誤） */
export function parseReportsFeed(raw: unknown): ReportsFeed | null {
  const root = rec(raw)
  if (root.available !== true) return null
  const p = rec(root.payload)
  if (typeof p.computedAt !== 'string') return null
  const reports = arr(p.reports).map(parseReport).filter((r): r is Report => r !== null)
  return { computedAt: p.computedAt, reports, warnings: arr(p.warnings).filter((w): w is string => typeof w === 'string') }
}

export async function apiFetchReports(pw: string): Promise<ReportsFeed | null> {
  const r = await fetch(`${API_BASE}api/feed/kb-report-stats`, { headers: { 'x-admin-password': pw } })
  if (!r.ok) throw new Error('Failed to fetch report stats')
  return parseReportsFeed(await r.json())
}
