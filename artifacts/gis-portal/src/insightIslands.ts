// 島嶼全景＋橫向時間軸的純函式（3.15.0）：島嶼版面（螺旋擺放）、鏡頭（對準、縮放）、時間軸排列與月份分箱。
// 不碰 DOM、不用 Math.random；同一輸入永遠得到同一輸出。畫面元件在 InsightIslands.tsx，資料型別沿用 insightTree.ts。

import { GLOW_DAYS, taipeiDay } from './insightTree'
import type { Insight, InsightRelation } from './insightTree'

export const ISLAND = { cellW: 128, cellH: 42, gap: 7, pad: 18, label: 44, margin: 46 } as const
export const TIMELINE = { minGap: 50, spMin: 62, cardW: 176, cardH: 46, maxLanes: 4, laneGap: 10, axisPad: 24 } as const

const dayNumber = (d: string): number => Date.UTC(+d.slice(0, 4), +d.slice(5, 7) - 1, +d.slice(8, 10)) / 86_400_000

const byDateId = (a: Insight, b: Insight): number => (a.date < b.date ? -1 : a.date > b.date ? 1 : a.id < b.id ? -1 : a.id > b.id ? 1 : 0)

// ─────────────────────────────────────────────
// 排序
// ─────────────────────────────────────────────

export type Ordered = Insight & { depth: number }

/** 子心得緊接在親代後（遞迴）；親代不在清單內的當根；根依 date 升冪、同日依 id */
export function threadOrder(items: readonly Insight[]): Ordered[] {
  const byId = new Map(items.map((i) => [i.id, i]))
  const kids = new Map<string, Insight[]>()
  for (const i of items) {
    if (i.parent === null || !byId.has(i.parent)) continue
    const list = kids.get(i.parent)
    if (list) list.push(i)
    else kids.set(i.parent, [i])
  }
  for (const list of kids.values()) list.sort(byDateId)
  const out: Ordered[] = []
  const walk = (i: Insight, depth: number): void => {
    out.push({ ...i, depth })
    const list = kids.get(i.id)
    if (list) for (const c of list) walk(c, depth + 1)
  }
  const roots = items.filter((i) => i.parent === null || !byId.has(i.parent)).sort(byDateId)
  for (const r of roots) walk(r, 0)
  return out
}

/** 島上格子的順序：先 threadOrder，再以 thread 分組，組依「組內最新 date」降冪（同值依 thread 字串），組內保持 threadOrder 順序 */
export function islandOrder(items: readonly Insight[]): Ordered[] {
  const groups = new Map<string, Ordered[]>()
  for (const it of threadOrder(items)) {
    const list = groups.get(it.thread)
    if (list) list.push(it)
    else groups.set(it.thread, [it])
  }
  const list = [...groups.entries()].map(([thread, its]) => {
    let last = ''
    for (const it of its) if (it.date > last) last = it.date
    return { thread, its, last }
  })
  list.sort((a, b) => (a.last < b.last ? 1 : a.last > b.last ? -1 : a.thread < b.thread ? -1 : a.thread > b.thread ? 1 : 0))
  return list.flatMap((g) => g.its)
}

// ─────────────────────────────────────────────
// 島嶼版面
// ─────────────────────────────────────────────

export interface IslandCell { id: string; x: number; y: number; depth: number }   // 世界座標，格子左上角
export interface Island { id: string; x: number; y: number; w: number; h: number; cols: number; rows: number; cells: IslandCell[]; last: string; fresh: number }
export interface Rect { x: number; y: number; w: number; h: number }
export interface IslandWorld { islands: Island[]; bounds: Rect }

interface Draft {
  id: string
  flat: Ordered[]
  cols: number
  rows: number
  w: number
  h: number
  last: string
  fresh: number
  x: number
  y: number
}

/** groups: cluster id → 該群心得。now 用來算 fresh（date 在 taipeiDay(now) 往前 GLOW_DAYS 天內，含當天）。 */
export function layoutIslands(groups: ReadonlyMap<string, readonly Insight[]>, now: Date): IslandWorld {
  const todayN = dayNumber(taipeiDay(now))
  const drafts: Draft[] = []
  for (const [id, items] of groups) {
    const flat = islandOrder(items)
    const n = flat.length
    if (n === 0) continue
    const cols = Math.max(1, Math.min(n, Math.round(Math.sqrt((n * ISLAND.cellH) / ISLAND.cellW) * 1.25)))
    const rows = Math.ceil(n / cols)
    let last = ''
    let fresh = 0
    for (const it of items) {
      if (it.date > last) last = it.date
      if (todayN - dayNumber(it.date) <= GLOW_DAYS) fresh++
    }
    drafts.push({ id, flat, cols, rows, w: cols * ISLAND.cellW + ISLAND.pad * 2 - ISLAND.gap, h: rows * ISLAND.cellH + ISLAND.pad * 2 - ISLAND.gap, last, fresh, x: 0, y: 0 })
  }
  if (drafts.length === 0) return { islands: [], bounds: { x: 0, y: 0, w: 0, h: 0 } }

  // 依面積大到小（同面積依 id）沿螺旋擺放，不重疊（上方留標籤空間）
  const placed: Rect[] = []
  const byArea = [...drafts].sort((a, b) => b.w * b.h - a.w * a.h || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
  for (const I of byArea) {
    for (let t = 0; ; t++) {
      const a = t * 0.42
      const r = t * 9
      const R: Rect = { x: Math.cos(a) * r * 1.25 - I.w / 2, y: Math.sin(a) * r * 0.85 - I.h / 2, w: I.w, h: I.h }
      const clear = placed.every((p) =>
        R.x + R.w + ISLAND.margin < p.x || p.x + p.w + ISLAND.margin < R.x ||
        R.y + R.h + ISLAND.margin + ISLAND.label < p.y || p.y + p.h + ISLAND.margin + ISLAND.label < R.y)
      if (clear) {
        I.x = R.x
        I.y = R.y
        placed.push(R)
        break
      }
    }
  }

  let x0 = Infinity
  let y0 = Infinity
  let x1 = -Infinity
  let y1 = -Infinity
  for (const I of drafts) {
    x0 = Math.min(x0, I.x)
    y0 = Math.min(y0, I.y - ISLAND.label)
    x1 = Math.max(x1, I.x + I.w)
    y1 = Math.max(y1, I.y + I.h)
  }

  const islands: Island[] = [...drafts]
    .sort((a, b) => (a.last < b.last ? 1 : a.last > b.last ? -1 : a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
    .map((I) => ({
      id: I.id, x: I.x, y: I.y, w: I.w, h: I.h, cols: I.cols, rows: I.rows,
      cells: I.flat.map((it, j) => ({ id: it.id, x: I.x + ISLAND.pad + (j % I.cols) * ISLAND.cellW, y: I.y + ISLAND.pad + Math.floor(j / I.cols) * ISLAND.cellH, depth: it.depth })),
      last: I.last,
      fresh: I.fresh,
    }))
  return { islands, bounds: { x: x0, y: y0, w: x1 - x0, h: y1 - y0 } }
}

// ─────────────────────────────────────────────
// 鏡頭
// ─────────────────────────────────────────────

export interface Camera { x: number; y: number; k: number }   // 世界中心點與縮放

export function worldToScreen(cam: Camera, wx: number, wy: number, viewW: number, viewH: number): [number, number] {
  return [(wx - cam.x) * cam.k + viewW / 2, (wy - cam.y) * cam.k + viewH / 2]
}

export function fitCamera(r: Rect, viewW: number, viewH: number, frac = 0.9): Camera {
  return { x: r.x + r.w / 2, y: r.y + r.h / 2, k: Math.min((viewW * frac) / r.w, (viewH * frac) / r.h) }
}

/** 縮放後游標 (mx,my)（相對檢視區左上）底下的世界點不動；k 夾在 [kMin,kMax] */
export function zoomAt(cam: Camera, mx: number, my: number, factor: number, viewW: number, viewH: number, kMin: number, kMax: number): Camera {
  const wx = cam.x + (mx - viewW / 2) / cam.k
  const wy = cam.y + (my - viewH / 2) / cam.k
  const k = Math.min(kMax, Math.max(kMin, cam.k * factor))
  return { x: wx - (mx - viewW / 2) / k, y: wy - (my - viewH / 2) / k, k }
}

/** 對準島：k = clamp(fitCamera(島含上方 40 的高度, 0.86).k, 1.35, 2.6)，再夾 [kMin,kMax]；中心 y 往上 12 */
export function islandCamera(is: Island, viewW: number, viewH: number, kMin: number, kMax: number): Camera {
  const fit = fitCamera({ x: is.x, y: is.y, w: is.w, h: is.h + 40 }, viewW, viewH, 0.86).k
  const k = Math.min(kMax, Math.max(kMin, Math.min(2.6, Math.max(1.35, fit))))
  return { x: is.x + is.w / 2, y: is.y + is.h / 2 - 12, k }
}

/** 語意縮放層級：k<0.75 'overview'；<1.3 'short'；<2.2 'full'；其餘 'read' */
export function zoomLevel(k: number): 'overview' | 'short' | 'full' | 'read' {
  return k < 0.75 ? 'overview' : k < 1.3 ? 'short' : k < 2.2 ? 'full' : 'read'
}

// ─────────────────────────────────────────────
// 時間軸
// ─────────────────────────────────────────────

export interface TimelineMonth { x: number; label: string; year: boolean }
export interface TimelineArc { from: number; to: number; relation: InsightRelation; thread: string }   // from/to 是 items 索引
export interface TimelineLayout { xs: number[]; lanes: number[]; laneCount: number; width: number; axisY: number; height: number; months: TimelineMonth[]; arcs: TimelineArc[] }

/** items 必須已依 date 升冪（函式內不重排；呼叫端負責）。viewW 是時間軸可視寬。 */
export function layoutTimeline(items: readonly Insight[], viewW: number): TimelineLayout {
  const n = items.length
  if (n === 0) {
    const axisY = TIMELINE.axisPad
    return { xs: [], lanes: [], laneCount: 0, width: viewW, axisY, height: axisY + 70, months: [], arcs: [] }
  }

  const first = dayNumber(items[0]!.date)
  const last = dayNumber(items[n - 1]!.date)
  const span = Math.max((n - 1) * TIMELINE.spMin, Math.min(viewW * 0.7, (n - 1) * 300))
  // 位置＝名次與時間的混合：保留時間感，又不讓同一段時間的心得疊在一起
  const xs: number[] = []
  for (let i = 0; i < n; i++) {
    const r = n > 1 ? i / (n - 1) : 0.5
    const t = last > first ? (dayNumber(items[i]!.date) - first) / (last - first) : r
    xs.push((0.55 * r + 0.45 * t) * span)
  }
  for (let i = 1; i < n; i++) xs[i] = Math.max(xs[i]!, xs[i - 1]! + TIMELINE.minGap)
  const half = viewW / 2
  for (let i = 0; i < n; i++) xs[i] = xs[i]! + half
  const width = xs[n - 1]! + half

  // 排：依序放進第一個放得下的排，都不行就放 laneEnd 最小的排；最多 maxLanes 排
  const laneEnd: number[] = []
  for (let l = 0; l < TIMELINE.maxLanes; l++) laneEnd.push(-Infinity)
  const lanes: number[] = []
  for (const x of xs) {
    let lane = laneEnd.findIndex((end) => end + TIMELINE.laneGap <= x - TIMELINE.cardW / 2)
    if (lane < 0) lane = laneEnd.indexOf(Math.min(...laneEnd))
    lanes.push(lane)
    laneEnd[lane] = x + TIMELINE.cardW / 2
  }
  let laneCount = 0
  for (const lane of lanes) if (lane + 1 > laneCount) laneCount = lane + 1
  const axisY = laneCount * (TIMELINE.cardH + TIMELINE.laneGap) + TIMELINE.axisPad

  // 月份刻度：每個新月份第一則，換年（含第一則）顯示 YYYY/MM
  const months: TimelineMonth[] = []
  let lastMonth = ''
  let lastYear = ''
  for (let i = 0; i < n; i++) {
    const m = items[i]!.date.slice(0, 7)
    if (m === lastMonth) continue
    lastMonth = m
    const y = m.slice(0, 4)
    const year = y !== lastYear
    lastYear = y
    months.push({ x: xs[i]! - 10, label: year ? `${y}/${m.slice(5)}` : `${m.slice(5)}月`, year })
  }

  const indexOf = new Map(items.map((it, i) => [it.id, i]))
  const arcs: TimelineArc[] = []
  for (let i = 0; i < n; i++) {
    const it = items[i]!
    if (it.parent === null) continue
    const from = indexOf.get(it.parent)
    if (from === undefined) continue
    arcs.push({ from, to: i, relation: it.relation, thread: it.thread })
  }

  return { xs, lanes, laneCount, width, axisY, height: axisY + 70, months, arcs }
}

/** 讓 x 在 viewW 寬的可視區正中央所需的 scrollLeft（不夾值） */
export function centerScroll(x: number, viewW: number): number {
  return x - viewW / 2
}

/** 近 months 個月（含本月，以 taipeiDay(now) 的年月為最後一格）每月心得數，舊→新 */
export function monthBins(items: readonly Insight[], now: Date, months = 24): number[] {
  const bins: number[] = []
  for (let i = 0; i < months; i++) bins.push(0)
  const today = taipeiDay(now)
  const endY = +today.slice(0, 4)
  const endM = +today.slice(5, 7)
  for (const it of items) {
    const diff = (endY - +it.date.slice(0, 4)) * 12 + (endM - +it.date.slice(5, 7))
    if (diff < 0 || diff >= months) continue
    const k = months - 1 - diff
    bins[k] = bins[k]! + 1
  }
  return bins
}
