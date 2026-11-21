// 旅遊面向頁（#dim/travel）的兩張主圖用的純函式：年度旅行日曆、足跡縣市方格圖。
// 全部不碰網路與 DOM，元件在 TravelCharts.tsx。
import type { FoodPlace } from './foodMap'
import type { Trip } from './tripsApi'

// ── 日期小工具（YYYY-MM-DD，一律用 UTC 正午避開時區與夏令時間） ──
const MS_DAY = 86_400_000
const ms = (iso: string): number => Date.parse(`${iso}T12:00:00Z`)

export function addDays(iso: string, n: number): string {
  return new Date(ms(iso) + n * MS_DAY).toISOString().slice(0, 10)
}
export function dayDiff(from: string, to: string): number {
  return Math.round((ms(to) - ms(from)) / MS_DAY)
}
const weekday = (iso: string): number => new Date(ms(iso)).getUTCDay()

// 防呆：資料壞掉（end 比 start 早很多、年份打錯）時不要展開成幾萬天
const MAX_TRIP_DAYS = 400

function rangeDays(start: string, end: string): string[] {
  if (end < start) return []
  const n = Math.min(dayDiff(start, end), MAX_TRIP_DAYS - 1)
  return Array.from({ length: n + 1 }, (_, i) => addDays(start, i))
}

const byStart = (a: Trip, b: Trip): number => a.start.localeCompare(b.start) || a.id.localeCompare(b.id)

function dayMap(trips: readonly Trip[]): Map<string, Trip[]> {
  const m = new Map<string, Trip[]>()
  for (const t of [...trips].sort(byStart)) {
    for (const d of rangeDays(t.start, t.end)) {
      const l = m.get(d)
      if (l) l.push(t)
      else m.set(d, [t])
    }
  }
  return m
}

// ── 旅行日 ──

/** 已成行（status 不是 planned）的趟次，每個日期對到涵蓋它的趟次（依 start、id 排序，同日多趟取第一趟）。可跨年 */
export function travelDayMap(trips: readonly Trip[]): Map<string, Trip[]> {
  return dayMap(trips.filter((t) => t.status !== 'planned'))
}

/** 還沒成行（planned）的趟次涵蓋的日期 */
export function plannedDayMap(trips: readonly Trip[]): Map<string, Trip[]> {
  return dayMap(trips.filter((t) => t.status === 'planned'))
}

/** 去過的美食地點的日子：status visited／favorite 且 kind food，取 visitedAt 與 days */
export function foodVisitDays(places: readonly FoodPlace[]): Set<string> {
  const s = new Set<string>()
  for (const p of places) {
    if (p.kind !== 'food' || (p.status !== 'visited' && p.status !== 'favorite')) continue
    if (p.visitedAt) s.add(p.visitedAt)
    for (const d of p.days) s.add(d)
  }
  return s
}

export interface CalCell {
  date: string
  /** 涵蓋這天的已成行趟次（可能多趟） */
  trips: Trip[]
  /** 涵蓋這天的 planned 趟次 */
  planned: Trip[]
  food: boolean
  today: boolean
}

export interface CalendarView {
  year: number
  /** 每個元素是一週（欄），固定 7 格，週日在上；null＝不在這一年的空格 */
  weeks: (CalCell | null)[][]
  /** 今年到今天為止的旅行天數 */
  daysThisYear: number
  /** 去年同期（1/1 到去年的同一個月日）的旅行天數 */
  daysLastYear: number
}

/** 去年的「同一天」；2/29 退到 2/28 */
export function sameDayLastYear(today: string): string {
  const y = Number(today.slice(0, 4)) - 1
  const md = today.slice(5)
  return `${y}-${md === '02-29' ? '02-28' : md}`
}

export function buildCalendar(trips: readonly Trip[], places: readonly FoodPlace[], today: string): CalendarView {
  const year = Number(today.slice(0, 4))
  const tdm = travelDayMap(trips)
  const pdm = plannedDayMap(trips)
  const food = foodVisitDays(places)
  const first = `${year}-01-01`
  const last = `${year}-12-31`
  const total = dayDiff(first, last) + 1
  const weeks: (CalCell | null)[][] = []
  let col: (CalCell | null)[] = Array.from({ length: weekday(first) }, () => null)
  for (let i = 0; i < total; i++) {
    const date = addDays(first, i)
    col.push({ date, trips: tdm.get(date) ?? [], planned: pdm.get(date) ?? [], food: food.has(date), today: date === today })
    if (col.length === 7) { weeks.push(col); col = [] }
  }
  if (col.length) {
    while (col.length < 7) col.push(null)
    weeks.push(col)
  }
  let daysThisYear = 0
  for (const d of tdm.keys()) if (d >= first && d <= today) daysThisYear++
  const lastFrom = `${year - 1}-01-01`
  const lastTo = sameDayLastYear(today)
  let daysLastYear = 0
  for (const d of tdm.keys()) if (d >= lastFrom && d <= lastTo) daysLastYear++
  return { year, weeks, daysThisYear, daysLastYear }
}

/** 每週欄上方的月份標籤：該月 1 號所在的那一欄寫「n月」，其餘 null */
export function monthLabels(weeks: readonly (CalCell | null)[][]): (string | null)[] {
  return weeks.map((w) => {
    const c = w.find((x): x is CalCell => !!x && x.date.slice(8) === '01')
    return c ? `${Number(c.date.slice(5, 7))}月` : null
  })
}

/** 距上次旅行幾天：最近一個 ≤ 今天的旅行日；今天在旅行中＝0；從沒旅行過＝null */
export function daysSinceLastTrip(trips: readonly Trip[], today: string): number | null {
  let best: string | null = null
  for (const d of travelDayMap(trips).keys()) if (d <= today && (best === null || d > best)) best = d
  return best === null ? null : dayDiff(best, today)
}

/** 下一趟（start 在今天之後最早的一趟）與倒數天數；沒有就 null */
export function nextTrip(trips: readonly Trip[], today: string): { trip: Trip; inDays: number } | null {
  const t = trips.filter((x) => x.start > today).sort(byStart)[0]
  return t ? { trip: t, inDays: dayDiff(today, t.start) } : null
}

// ── 縣市 ──

export interface County {
  /** 全名，台統一用「台」 */
  name: string
  /** 格上的簡稱（兩字，新竹、嘉義的市縣用「竹市」「竹縣」「嘉市」「嘉縣」區分） */
  short: string
  /** 方格圖座標（欄、列，從 0 起算） */
  col: number
  row: number
}

// 5 欄 × 8 列的示意圖，大致依地理位置：離島（連江、金門、澎湖）放最左欄，北在上
export const COUNTIES: readonly County[] = [
  { name: '連江縣', short: '連江', col: 0, row: 0 },
  { name: '新北市', short: '新北', col: 3, row: 0 },
  { name: '基隆市', short: '基隆', col: 4, row: 0 },
  { name: '桃園市', short: '桃園', col: 2, row: 1 },
  { name: '台北市', short: '台北', col: 3, row: 1 },
  { name: '宜蘭縣', short: '宜蘭', col: 4, row: 1 },
  { name: '新竹市', short: '竹市', col: 1, row: 2 },
  { name: '新竹縣', short: '竹縣', col: 2, row: 2 },
  { name: '苗栗縣', short: '苗栗', col: 3, row: 2 },
  { name: '金門縣', short: '金門', col: 0, row: 3 },
  { name: '台中市', short: '台中', col: 2, row: 3 },
  { name: '南投縣', short: '南投', col: 3, row: 3 },
  { name: '花蓮縣', short: '花蓮', col: 4, row: 3 },
  { name: '彰化縣', short: '彰化', col: 1, row: 4 },
  { name: '雲林縣', short: '雲林', col: 2, row: 4 },
  { name: '嘉義縣', short: '嘉縣', col: 3, row: 4 },
  { name: '澎湖縣', short: '澎湖', col: 0, row: 5 },
  { name: '嘉義市', short: '嘉市', col: 1, row: 5 },
  { name: '台南市', short: '台南', col: 2, row: 5 },
  { name: '台東縣', short: '台東', col: 4, row: 6 },
  { name: '高雄市', short: '高雄', col: 2, row: 6 },
  { name: '屏東縣', short: '屏東', col: 3, row: 7 },
]

export const COUNTY_GRID = { cols: 5, rows: 8 } as const

// 臺→台；去掉開頭的郵遞區號與「台灣」
const norm = (s: string): string => s.replace(/臺/g, '台').replace(/^[\s\d-]+/, '').replace(/^台灣\s*/, '').trim()

// 簡稱（去掉市縣）→ 縣市；新竹、嘉義市縣同名，要看後面接什麼
const SHORT_TO_NAME: Record<string, string> = {
  連江: '連江縣', 新北: '新北市', 基隆: '基隆市', 桃園: '桃園市', 台北: '台北市', 宜蘭: '宜蘭縣', 苗栗: '苗栗縣', 金門: '金門縣',
  台中: '台中市', 南投: '南投縣', 花蓮: '花蓮縣', 彰化: '彰化縣', 雲林: '雲林縣', 澎湖: '澎湖縣', 台南: '台南市', 台東: '台東縣',
  高雄: '高雄市', 屏東: '屏東縣',
}
const CITY_DISTRICTS: Record<string, RegExp> = {
  新竹: /^\s*(東區|北區|香山)/,
  嘉義: /^\s*(東區|西區)/,
}
const COUNTY_DISTRICTS: Record<string, RegExp> = {
  新竹: /^\s*(竹北|竹東|湖口|新豐|新埔|關西|芎林|寶山|北埔|峨眉|橫山|尖石|五峰)/,
  嘉義: /^\s*(太保|朴子|布袋|大林|民雄|溪口|新港|六腳|東石|義竹|鹿草|水上|中埔|竹崎|梅山|番路|大埔|阿里山)/,
}

function countyOfText(raw: string | null | undefined): string | null {
  if (!raw) return null
  const s = norm(raw)
  if (!s) return null
  for (const c of COUNTIES) if (s.startsWith(c.name)) return c.name
  for (const [short, name] of Object.entries(SHORT_TO_NAME)) if (s.startsWith(short)) return name
  for (const base of ['新竹', '嘉義']) {
    if (!s.startsWith(base)) continue
    const rest = s.slice(base.length)
    if (CITY_DISTRICTS[base]!.test(rest)) return `${base}市`
    if (COUNTY_DISTRICTS[base]!.test(rest)) return `${base}縣`
    return null
  }
  return null
}

/** 地點在哪個縣市（回傳全名，台統一寫「台」）：先看 address 開頭，再看 area 開頭；認不出回 null */
export function countyOf(place: Pick<FoodPlace, 'address' | 'area'>): string | null {
  return countyOfText(place.address) ?? countyOfText(place.area)
}

export interface FootprintView {
  /** 縣市全名 → 去過的地點數（22 縣市都有，0 次也有） */
  counts: Map<string, number>
  visitedCounties: number
  /** 去過但認不出縣市的地點數 */
  unknown: number
  /** 去過的地點總數 */
  total: number
}

/** 去過的地點：非 planned 趟次的 placeIds 對到的地點，加上 status visited／favorite 的地點；同一地點只算一次 */
export function buildFootprint(trips: readonly Trip[], places: readonly FoodPlace[]): FootprintView {
  const byId = new Map(places.map((p) => [p.id, p]))
  const been = new Map<string, FoodPlace>()
  for (const t of trips) {
    if (t.status === 'planned') continue
    for (const id of t.placeIds) {
      const p = byId.get(id)
      if (p) been.set(p.id, p)
    }
  }
  for (const p of places) if (p.status === 'visited' || p.status === 'favorite') been.set(p.id, p)
  const counts = new Map<string, number>(COUNTIES.map((c) => [c.name, 0]))
  let unknown = 0
  for (const p of been.values()) {
    const c = countyOf(p)
    if (c) counts.set(c, (counts.get(c) ?? 0) + 1)
    else unknown++
  }
  let visitedCounties = 0
  for (const n of counts.values()) if (n > 0) visitedCounties++
  return { counts, visitedCounties, unknown, total: been.size }
}

/** 次數 → 0～4 階（0 空白框） */
export function footprintLevel(n: number): 0 | 1 | 2 | 3 | 4 {
  if (n <= 0) return 0
  if (n === 1) return 1
  if (n <= 3) return 2
  if (n <= 7) return 3
  return 4
}
