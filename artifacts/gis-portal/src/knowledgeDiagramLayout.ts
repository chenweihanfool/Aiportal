// 知識頁圖解（2.81.0）的版面計算：純函式，不碰 DOM。元件在 KnowledgeDiagram.tsx，資料型別與解析在 knowledgeView.ts。
// 三種圖：flow（泳道×階段）、timeline（多軌時間軸＋推估下一次＋數值折線）、map（觀察→框架→判斷）。

import type { DiagramNodeBase, DiagramTimelineItem, FlowDiagram, FlowNode, MapDiagram, TimelineDiagram } from './knowledgeView'
import type { HermesTopicQuote } from './hermesDocApi'

/* ───────── 共用：證據強度、矩形 ───────── */

export type Strength = 'ai' | 'multi' | 'one'

/** ai 為真 → AI 續寫；否則 src 不重複數 ≥2 → 多份來源；=1 → 僅一例 */
export function strengthOf(n: { ai?: boolean; src: readonly number[] }): Strength {
  if (n.ai) return 'ai'
  return new Set(n.src).size >= 2 ? 'multi' : 'one'
}

export const STRENGTH_TEXT: Record<Strength, string> = { ai: 'AI 續寫，待驗證', multi: '多份來源', one: '僅一例' }

const STRENGTH_RANK: Record<Strength, number> = { ai: 0, one: 1, multi: 2 }
/** 兩端取較弱者（ai < 僅一例 < 多份來源） */
export function weakerStrength(a: Strength, b: Strength): Strength {
  return STRENGTH_RANK[a] <= STRENGTH_RANK[b] ? a : b
}

export interface Rect { x: number; y: number; w: number; h: number }

/** 兩個矩形的內部有交集（只碰到邊不算） */
export function rectsOverlap(a: Rect, b: Rect): boolean {
  return a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h
}

/**
 * 點來源時帶給原文面板的 q：沿用 2.77 的 topic doc quotes（meta.quotes），
 * 取第一個 ref＝n 且有文字的摘錄（優先「原文且對到這句」的），只取第一行、最多 80 字；找不到回空字串（面板不標亮）。
 */
export function quoteQueryFor(quotes: readonly HermesTopicQuote[] | null | undefined, n: number): string {
  if (!quotes) return ''
  const hits = quotes.filter((q) => q && q.ref === n && typeof q.text === 'string' && q.text.trim() !== '')
  const best = hits.find((q) => q.fromOriginal && !q.weak) ?? hits[0]
  if (!best || !best.text) return ''
  const line = best.text.split(/\r?\n/).map((l) => l.trim()).find((l) => l !== '') ?? ''
  return [...line].slice(0, 80).join('')
}

/** 粗估一段文字畫出來的寬度（CJK 一字約一個字級，ASCII 約半個） */
export function textWidth(s: string, fontSize: number): number {
  let w = 0
  for (const ch of s) w += ch.charCodeAt(0) > 0x2e80 ? fontSize : fontSize * 0.56
  return Math.ceil(w)
}

/* ───────── flow：泳道（列）× 階段（欄） ───────── */

const F = { LW: 118, CW: 178, TOP: 44, LH: 150, BW: 150, BH: 76, DW: 166, DH: 96 } as const

export interface FlowBox { id: string; cx: number; cy: number; rect: Rect; shape: 'step' | 'decision' }
export interface FlowEdgeLine {
  from: string; to: string; label?: string; back: boolean
  /** SVG path d */
  d: string
  lx: number; ly: number; anchor: 'start' | 'middle'
}
export interface FlowLayout {
  width: number; height: number
  lanes: Array<{ label: string; y: number; h: number }>
  phases: Array<{ label: string; x: number; cx: number }>
  nodes: FlowBox[]
  edges: FlowEdgeLine[]
}

function flowSize(n: FlowNode): { w: number; h: number } {
  return n.shape === 'decision' ? { w: F.DW, h: F.DH } : { w: F.BW, h: F.BH }
}

export function layoutFlow(d: FlowDiagram): FlowLayout {
  const cxOf = (phase: number) => F.LW + F.CW / 2 + phase * F.CW
  const cyOf = (lane: number) => F.TOP + F.LH / 2 + lane * F.LH
  const width = F.LW + d.phases.length * F.CW + 10
  const height = F.TOP + d.lanes.length * F.LH + 8
  const nodes: FlowBox[] = d.nodes.map((n) => {
    const { w, h } = flowSize(n)
    const cx = cxOf(n.phase)
    const cy = cyOf(n.lane)
    return { id: n.id, cx, cy, rect: { x: cx - w / 2, y: cy - h / 2, w, h }, shape: n.shape }
  })
  const box = new Map(nodes.map((b) => [b.id, b]))
  const meta = new Map(d.nodes.map((n) => [n.id, n]))
  const edges: FlowEdgeLine[] = []
  for (const e of d.edges) {
    const A = box.get(e.from)
    const B = box.get(e.to)
    const a = meta.get(e.from)
    const b = meta.get(e.to)
    if (!A || !B || !a || !b) continue
    const wa = A.rect.w / 2, ha = A.rect.h / 2, wb = B.rect.w / 2, hb = B.rect.h / 2
    let path: string
    let lx: number, ly: number
    let anchor: 'start' | 'middle' = 'start'
    if (e.back) {
      // 回頭邊：走節點中線下方 10px 的線，繞到欄界線上直行
      const gx = b.phase < a.phase ? F.LW + (b.phase + 1) * F.CW + 3 : Math.max(A.cx + wa, B.cx + wb) + 8
      const leftward = b.phase < a.phase
      const sx = leftward ? A.cx - wa : A.cx + wa
      const ex = B.cx + wb
      path = `M${sx} ${A.cy + 10} H${gx} V${B.cy + 10} H${ex}`
      lx = gx + 4
      ly = (A.cy + B.cy) / 2
    } else if (a.phase === b.phase) {
      const down = b.lane > a.lane
      path = `M${A.cx} ${A.cy + (down ? ha : -ha)} V${B.cy + (down ? -hb : hb)}`
      lx = A.cx + 6
      ly = (A.cy + B.cy) / 2 + 4
    } else if (a.lane === b.lane) {
      const blocked = d.nodes.some((n) => n.lane === a.lane && n.phase > a.phase && n.phase < b.phase)
      if (blocked) {
        const yTop = A.cy - F.LH / 2 + 10
        path = `M${A.cx} ${A.cy - ha} V${yTop} H${B.cx} V${B.cy - hb}`
        lx = (A.cx + B.cx) / 2
        ly = yTop - 4
      } else {
        path = `M${A.cx + wa} ${A.cy} H${B.cx - wb}`
        lx = (A.cx + wa + B.cx - wb) / 2
        ly = A.cy - 8
      }
      anchor = 'middle'
    } else {
      const mx = F.LW + b.phase * F.CW
      path = `M${A.cx + wa} ${A.cy} H${mx} V${B.cy} H${B.cx - wb}`
      lx = mx + 5
      ly = (A.cy + B.cy) / 2
    }
    const line: FlowEdgeLine = { from: e.from, to: e.to, back: !!e.back, d: path, lx, ly, anchor }
    if (e.label) line.label = e.label
    edges.push(line)
  }
  return {
    width, height,
    lanes: d.lanes.map((label, i) => ({ label, y: F.TOP + i * F.LH, h: F.LH })),
    phases: d.phases.map((label, i) => ({ label, x: F.LW + i * F.CW, cx: cxOf(i) })),
    nodes, edges,
  }
}

export const FLOW_CONST = F

/* ───────── timeline：多軌、日期橫軸、今天線、推估下一次、數值折線 ───────── */

const DAY_MS = 86_400_000

/** 台北日曆日 YYYY-MM-DD（今天線與推估都以台北日期為準） */
export function taipeiToday(now: Date): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Taipei' }).format(now)
}
/** YYYY-MM-DD → 自 1970-01-01 起的日數（UTC，無時區問題） */
export function dayNum(date: string): number {
  return Math.round(Date.parse(`${date}T00:00:00Z`) / DAY_MS)
}
export function dateOfDayNum(n: number): string {
  return new Date(n * DAY_MS).toISOString().slice(0, 10)
}
const md = (date: string): string => `${Number(date.slice(5, 7))}/${Number(date.slice(8, 10))}`

/** 日數陣列的中位數；奇數取正中間，偶數取中間兩個的平均，結果四捨五入到整天（x.5 進位）。空陣列回 null */
export function medianDays(values: readonly number[]): number | null {
  if (values.length === 0) return null
  const s = [...values].sort((a, b) => a - b)
  const mid = Math.floor(s.length / 2)
  const m = s.length % 2 === 1 ? s[mid]! : (s[mid - 1]! + s[mid]!) / 2
  return Math.round(m)
}

export interface TrackForecast {
  trackId: string; label: string
  /** 預計下一次的日期 YYYY-MM-DD */
  date: string
  /** 距今天幾天（過了為負） */
  inDays: number
  /** 過去事件間隔的中位數（日） */
  intervalDays: number
  /** 用了幾個過去事件 */
  basedOn: number
  overdue: boolean
}

/**
 * 每軌：過去事件（date ≤ 今天，同一天只算一次）≥2 個，取相鄰間隔的中位數，預計下一次＝最後一次過去事件＋中位數。
 * 少於 2 個過去事件的軌沒有推估。回傳依預計日期排序。
 */
export function forecastTracks(d: TimelineDiagram, now: Date): TrackForecast[] {
  const today = dayNum(taipeiToday(now))
  const out: TrackForecast[] = []
  for (const tr of d.tracks) {
    const days = [...new Set(d.items.filter((i) => i.track === tr.id).map((i) => dayNum(i.date)).filter((n) => n <= today))].sort((a, b) => a - b)
    if (days.length < 2) continue
    const gaps = days.slice(1).map((n, i) => n - days[i]!)
    const interval = medianDays(gaps)!
    const next = days[days.length - 1]! + interval
    out.push({ trackId: tr.id, label: tr.label, date: dateOfDayNum(next), inDays: next - today, intervalDays: interval, basedOn: days.length, overdue: next < today })
  }
  return out.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0))
}

export interface TimelineMark {
  key: string
  kind: 'item' | 'forecast'
  /** items 的索引；forecast 為 null */
  itemIndex: number | null
  trackIndex: number
  label: string
  sub?: string
  date: string
  end?: string
  x: number
  /** 有 end 時的右端 x，否則同 x */
  xEnd: number
  strength: Strength
  unknown: boolean
  /** 標記（圓點／長條）的中心 y */
  markerY: number
  /** 含標記與文字的外框；同一軌內互不相交 */
  rect: Rect
}
export interface TimelineMetricLayout {
  label: string; unit?: string; y: number; h: number
  min: number; max: number
  points: Array<{ x: number; y: number; date: string; value: number; src: number[] }>
  path: string
}
export interface TimelineLayout {
  width: number; height: number
  ticks: Array<{ x: number; label: string }>
  todayX: number; todayLabel: string
  tracks: Array<{ id: string; label: string; y: number; h: number }>
  marks: TimelineMark[]
  metrics: TimelineMetricLayout[]
  forecasts: TrackForecast[]
  /** 軸區域 [x0, x1] */
  axis: { x0: number; x1: number; top: number; bottom: number }
}

const T = { ML: 96, PADL: 56, PADR: 70, AXIS_TOP: 34, SUB: 44, TRACK_PAD: 10, METRIC_H: 104, FONT: 12, MARK_H: 38, PX_DAY: 6, MIN_W: 700, MAX_W: 3200 } as const
export const TIMELINE_CONST = T

export function layoutTimeline(d: TimelineDiagram, now: Date): TimelineLayout {
  const today = taipeiToday(now)
  const forecasts = forecastTracks(d, now)

  const allDays: number[] = [dayNum(today)]
  for (const i of d.items) { allDays.push(dayNum(i.date)); if (i.end) allDays.push(dayNum(i.end)) }
  for (const m of d.metrics) for (const p of m.points) allDays.push(dayNum(p.date))
  for (const f of forecasts) allDays.push(dayNum(f.date))
  const d0 = Math.min(...allDays) - 10
  const d1 = Math.max(...allDays) + 10
  const span = d1 - d0
  const axisW = Math.min(T.MAX_W, Math.max(T.MIN_W, span * T.PX_DAY))
  const x0 = T.ML + T.PADL
  const xOf = (day: number) => x0 + ((day - d0) / span) * axisW
  const width = x0 + axisW + T.PADR

  // 月份刻度
  const ticks: TimelineLayout['ticks'] = []
  const start = new Date(d0 * DAY_MS)
  let y = start.getUTCFullYear()
  let m = start.getUTCMonth() + 1
  for (let guard = 0; guard < 400; guard++) {
    m += 1
    if (m > 12) { m = 1; y += 1 }
    const first = Date.UTC(y, m - 1, 1) / DAY_MS
    if (first > d1) break
    ticks.push({ x: xOf(first), label: m === 1 || ticks.length === 0 ? `${y}/${m}` : `${m}月` })
  }

  // 每軌把事件＋推估排進子列（貪婪：放進第一個放得下的子列），外框因此互不相交
  interface Draft { kind: 'item' | 'forecast'; itemIndex: number | null; trackIndex: number; label: string; sub?: string; date: string; end?: string; strength: Strength; unknown: boolean; dayStart: number; dayEnd: number }
  const drafts: Draft[][] = d.tracks.map(() => [])
  d.items.forEach((it: DiagramTimelineItem, idx) => {
    const ti = d.tracks.findIndex((t) => t.id === it.track)
    if (ti < 0) return
    const dr: Draft = { kind: 'item', itemIndex: idx, trackIndex: ti, label: it.label, date: it.date, strength: strengthOf(it), unknown: !!it.unknown, dayStart: dayNum(it.date), dayEnd: dayNum(it.end ?? it.date) }
    if (it.sub) dr.sub = it.sub
    if (it.end) dr.end = it.end
    drafts[ti]!.push(dr)
  })
  for (const f of forecasts) {
    const ti = d.tracks.findIndex((t) => t.id === f.trackId)
    drafts[ti]!.push({ kind: 'forecast', itemIndex: null, trackIndex: ti, label: `推估 ${md(f.date)}`, date: f.date, strength: 'one', unknown: false, dayStart: dayNum(f.date), dayEnd: dayNum(f.date) })
  }

  const marks: TimelineMark[] = []
  const tracks: TimelineLayout['tracks'] = []
  let top = T.AXIS_TOP
  d.tracks.forEach((tr, ti) => {
    const list = drafts[ti]!.sort((a, b) => a.dayStart - b.dayStart || (a.itemIndex ?? 1e9) - (b.itemIndex ?? 1e9))
    const rights: number[] = []
    const placed: Array<{ dr: Draft; row: number; rect: Rect; x: number; xEnd: number }> = []
    for (const dr of list) {
      const x = xOf(dr.dayStart)
      const xEnd = xOf(dr.dayEnd)
      const tw = Math.max(textWidth(dr.label, T.FONT), textWidth(md(dr.date), T.FONT - 1), 16) + 8
      const left = Math.min(x - tw / 2, x - 8)
      const right = Math.max(x + tw / 2, xEnd + 8)
      let row = rights.findIndex((r) => r + 6 <= left)
      if (row < 0) { row = rights.length; rights.push(0) }
      rights[row] = right
      placed.push({ dr, row, rect: { x: left, y: 0, w: right - left, h: T.MARK_H }, x, xEnd })
    }
    const rows = Math.max(1, rights.length)
    const h = rows * T.SUB + T.TRACK_PAD
    for (const p of placed) {
      const rowTop = top + T.TRACK_PAD / 2 + p.row * T.SUB
      p.rect.y = rowTop
      const mark: TimelineMark = {
        key: p.dr.kind === 'item' ? `i${p.dr.itemIndex}` : `f${tr.id}`,
        kind: p.dr.kind, itemIndex: p.dr.itemIndex, trackIndex: ti, label: p.dr.label, date: p.dr.date,
        x: p.x, xEnd: p.xEnd, strength: p.dr.strength, unknown: p.dr.unknown, markerY: rowTop + 8, rect: p.rect,
      }
      if (p.dr.sub) mark.sub = p.dr.sub
      if (p.dr.end) mark.end = p.dr.end
      marks.push(mark)
    }
    tracks.push({ id: tr.id, label: tr.label, y: top, h })
    top += h
  })

  // 數值折線
  const metrics: TimelineMetricLayout[] = d.metrics.map((mt) => {
    const y0 = top
    const vals = mt.points.map((p) => p.value)
    let min = Math.min(...vals)
    let max = Math.max(...vals)
    if (min === max) { min -= 1; max += 1 }
    const yOf = (v: number) => y0 + T.METRIC_H - 18 - ((v - min) / (max - min)) * (T.METRIC_H - 36)
    const pts = [...mt.points].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0)).map((p) => ({ x: xOf(dayNum(p.date)), y: yOf(p.value), date: p.date, value: p.value, src: p.src }))
    const out: TimelineMetricLayout = { label: mt.label, y: y0, h: T.METRIC_H, min, max, points: pts, path: pts.map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x} ${p.y}`).join(' ') }
    if (mt.unit) out.unit = mt.unit
    top += T.METRIC_H
    return out
  })

  const height = top + 28
  return {
    width, height, ticks,
    todayX: xOf(dayNum(today)), todayLabel: `今天 ${md(today)}`,
    tracks, marks, metrics, forecasts,
    axis: { x0, x1: x0 + axisW, top: T.AXIS_TOP, bottom: top },
  }
}

/* ───────── map：觀察 → 框架 → 判斷 三欄，中間一條共同核心帶 ───────── */

const M = { W: 1180, C1: 30, BW1: 290, C2: 450, BW2: 280, C3: 860, BW3: 290, ROW: 86, TOP: 100, BH: 60, FH: 66 } as const
export const MAP_CONST = M

export interface MapBox { id: string; col: 'o' | 'f' | 'j'; cx: number; cy: number; rect: Rect; strength: Strength }
export interface MapLinkLine { from: string; to: string; d: string; strength: Strength }
export interface MapLayout {
  width: number; height: number
  headers: Array<{ label: string; x: number }>
  /** 共同核心帶（背景，框架欄在它上面） */
  core: Rect & { label: string; tx: number; ty: number }
  nodes: MapBox[]
  links: MapLinkLine[]
}

export function layoutMap(d: MapDiagram): MapLayout {
  const rows = Math.max(d.observations.length, d.frameworks.length, d.judgments.length)
  const height = M.TOP + rows * M.ROW + 20
  const strength = new Map<string, Strength>()
  for (const n of [...d.observations, ...d.frameworks, ...d.judgments]) strength.set(n.id, strengthOf(n))

  // 同欄均勻鋪開；框架依連到的觀察順位、判斷依連到的框架順位排序（減少交叉）
  const spread = (list: readonly DiagramNodeBase[]) => {
    const pitch = (rows * M.ROW) / Math.max(1, list.length)
    return new Map(list.map((n, i) => [n.id, M.TOP + pitch * (i + 0.5)] as const))
  }
  const order = (list: readonly DiagramNodeBase[], prevIndex: Map<string, number>, side: 'from' | 'to') => {
    const key = (n: DiagramNodeBase, i: number) => {
      const idx = d.links.filter((l) => (side === 'to' ? l.to : l.from) === n.id).map((l) => prevIndex.get(side === 'to' ? l.from : l.to)).filter((v): v is number => v !== undefined)
      return idx.length ? idx.reduce((a, b) => a + b, 0) / idx.length : i
    }
    return list.map((n, i) => ({ n, k: key(n, i), i })).sort((a, b) => a.k - b.k || a.i - b.i).map((x) => x.n)
  }
  const obs = [...d.observations]
  const fw = order(d.frameworks, new Map(obs.map((n, i) => [n.id, i])), 'to')
  const jd = order(d.judgments, new Map(fw.map((n, i) => [n.id, i])), 'to')
  const oy = spread(obs), fy = spread(fw), jy = spread(jd)

  const nodes: MapBox[] = []
  const add = (list: readonly DiagramNodeBase[], ys: Map<string, number>, col: 'o' | 'f' | 'j', x: number, w: number, h: number) => {
    for (const n of list) {
      const cy = ys.get(n.id)!
      nodes.push({ id: n.id, col, cx: x + w / 2, cy, rect: { x, y: cy - h / 2, w, h }, strength: strength.get(n.id)! })
    }
  }
  add(obs, oy, 'o', M.C1, M.BW1, M.BH)
  add(fw, fy, 'f', M.C2, M.BW2, M.FH)
  add(jd, jy, 'j', M.C3, M.BW3, M.BH)

  const box = new Map(nodes.map((b) => [b.id, b]))
  const links: MapLinkLine[] = []
  for (const l of d.links) {
    const A = box.get(l.from)
    const B = box.get(l.to)
    if (!A || !B) continue
    const x1 = A.rect.x + A.rect.w
    const x2 = B.rect.x
    const mx = (x1 + x2) / 2
    links.push({ from: l.from, to: l.to, d: `M${x1} ${A.cy} C${mx} ${A.cy}, ${mx} ${B.cy}, ${x2} ${B.cy}`, strength: weakerStrength(A.strength, B.strength) })
  }
  return {
    width: M.W, height,
    headers: [
      { label: '觀察：看到的事', x: M.C1 + M.BW1 / 2 },
      { label: '框架：壓出來的判斷工具', x: M.C2 + M.BW2 / 2 },
      { label: '判斷：拿去做什麼', x: M.C3 + M.BW3 / 2 },
    ],
    core: { x: M.C2 - 18, y: 44, w: M.BW2 + 36, h: height - 56, label: d.core, tx: M.C2 + M.BW2 / 2, ty: 70 },
    nodes, links,
  }
}
