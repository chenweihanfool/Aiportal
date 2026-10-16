// 年度回顧（#year／#year/<年>，P2-1，2026-10-16）的純函式：全部由既有資料算出來——幸福指數歷史（含各面向 components）、遊記、美食地圖。
// 不新增後端。沒有資料的就是 null／空，不補 0、不編造。
import { DIMENSIONS } from './dimensions'
import type { FoodPlace } from './foodMap'
import type { Trip } from './tripsApi'

const DAY_MS = 24 * 60 * 60 * 1000
const dayMs = (iso: string) => Date.parse(`${iso}T00:00:00Z`)

/** #year → 目前這一年；#year/2026 → 2026；年份不合理（<2000、>2100、不是整數）或格式不對 → null；不是 #year 開頭 → null */
export function yearFromHash(hash: string, currentYear: number): number | null {
  if (hash === '#year') return currentYear
  const m = /^#year\/(\d{4})$/.exec(hash)
  if (!m) return null
  const y = Number(m[1])
  return y >= 2000 && y <= 2100 ? y : null
}

export interface HistoryDay { date: string; displayedScore: number; components?: Record<string, number | null> | null }
const inYear = (date: string, year: number) => typeof date === 'string' && date.slice(0, 4) === String(year)
const round1 = (n: number) => Math.round(n * 10) / 10

export interface YearHhi {
  count: number
  avg: number | null
  best: { date: string; value: number } | null
  worst: { date: string; value: number } | null
  /** 1–12 月各月平均（沒有紀錄的月份 avg＝null、days＝0） */
  months: Array<{ month: number; avg: number | null; days: number }>
}

export function hhiYear(history: ReadonlyArray<HistoryDay> | null | undefined, year: number): YearHhi {
  const days = (Array.isArray(history) ? history : []).filter((h) => h && inYear(h.date, year) && Number.isFinite(h.displayedScore))
  const sums = Array.from({ length: 12 }, () => ({ sum: 0, n: 0 }))
  let best: YearHhi['best'] = null
  let worst: YearHhi['worst'] = null
  let total = 0
  for (const h of days) {
    const mi = Number(h.date.slice(5, 7)) - 1
    if (mi >= 0 && mi < 12) { sums[mi]!.sum += h.displayedScore; sums[mi]!.n += 1 }
    total += h.displayedScore
    if (!best || h.displayedScore > best.value) best = { date: h.date.slice(0, 10), value: h.displayedScore }
    if (!worst || h.displayedScore < worst.value) worst = { date: h.date.slice(0, 10), value: h.displayedScore }
  }
  return {
    count: days.length,
    avg: days.length ? round1(total / days.length) : null,
    best, worst,
    months: sums.map((s, i) => ({ month: i + 1, avg: s.n ? round1(s.sum / s.n) : null, days: s.n })),
  }
}

export interface YearDimension { key: string; label: string; icon: string; color: string; avg: number | null; days: number }

/** 六面向各自的年平均（取每天 components），由高到低；沒有資料的面向排最後（avg＝null） */
export function dimensionsYear(history: ReadonlyArray<HistoryDay> | null | undefined, year: number): YearDimension[] {
  const rows: YearDimension[] = DIMENSIONS.map((d) => {
    let sum = 0
    let n = 0
    for (const h of Array.isArray(history) ? history : []) {
      if (!h || !inYear(h.date, year) || !h.components || typeof h.components !== 'object') continue
      const v = h.components[d.key]
      if (typeof v === 'number' && Number.isFinite(v)) { sum += Math.min(100, Math.max(0, v)); n += 1 }
    }
    return { key: d.key, label: d.label, icon: d.icon, color: d.color, avg: n ? round1(sum / n) : null, days: n }
  })
  return rows.sort((a, b) => (b.avg ?? -1) - (a.avg ?? -1))
}

export interface YearTrips { count: number; days: number; areas: string[]; longest: { name: string; days: number } | null }

/** 該年的旅行：有任何一天落在這一年的趟次都算；天數只算落在這一年內的（含頭尾）；規劃中（planned）的不算 */
export function tripsYear(trips: ReadonlyArray<Trip> | null | undefined, year: number): YearTrips {
  const lo = dayMs(`${year}-01-01`)
  const hi = dayMs(`${year}-12-31`)
  let count = 0
  let days = 0
  let longest: YearTrips['longest'] = null
  const areas: string[] = []
  for (const t of Array.isArray(trips) ? trips : []) {
    if (!t || t.status === 'planned') continue
    const s = Math.max(dayMs(t.start), lo)
    const e = Math.min(dayMs(t.end), hi)
    if (!(e >= s)) continue
    const d = Math.round((e - s) / DAY_MS) + 1
    count += 1
    days += d
    if (!longest || d > longest.days) longest = { name: t.name, days: d }
    if (t.area && !areas.includes(t.area)) areas.push(t.area)
  }
  return { count, days, areas, longest }
}

export interface YearPlaces { visited: number; food: number; favorites: number }

/** 該年去過（visitedAt 落在那一年）的地點；food＝其中美食；favorites＝其中狀態是愛店的 */
export function placesYear(places: ReadonlyArray<FoodPlace> | null | undefined, year: number): YearPlaces {
  let visited = 0
  let food = 0
  let favorites = 0
  for (const p of Array.isArray(places) ? places : []) {
    if (!p || !p.visitedAt || !inYear(p.visitedAt, year)) continue
    visited += 1
    if (p.kind === 'food') food += 1
    if (p.status === 'favorite') favorites += 1
  }
  return { visited, food, favorites }
}
