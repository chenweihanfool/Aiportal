// 首頁「我的心得樹」的純函式（2.99.0）：寬容解析 /api/insights、把心得排成由下往上長的樹、統計與月份序列。
// 不碰 DOM、不用 Math.random（抖動一律用 id 的雜湊），同一輸入永遠得到同一輸出。元件在 InsightTree.tsx，網路在 insightApi.ts。
// 名詞：心得＝一句話；群（cluster）＝主枝；脈絡（thread）＝同一體會的一串，長成一條枝；relation：new 新生／reinforce 印證／refine 修正／overturn 推翻。

export type InsightRelation = 'new' | 'reinforce' | 'refine' | 'overturn'
export type InsightProvenance = 'quote' | 'relay' | 'tag'

export const RELATION_LABEL: Record<InsightRelation, string> = { new: '新生', reinforce: '印證', refine: '修正', overturn: '推翻' }
export const PROVENANCE_LABEL: Record<InsightProvenance, string> = { quote: '原話', relay: '轉述', tag: '#心得' }

export interface Insight {
  id: string
  date: string
  time: string | null
  text: string
  provenance: InsightProvenance
  cluster: string
  thread: string
  relation: InsightRelation
  parent: string | null
}
export interface InsightCluster { id: string; name: string; count: number }
export interface InsightData { total: number; thisMonth: number; clusters: InsightCluster[]; insights: Insight[] }
export interface InsightDetail {
  id: string
  date: string
  time: string | null
  text: string
  evidence: string
  provenance: InsightProvenance
  cluster: { id: string; name: string }
  thread: string
  relation: InsightRelation
  parent: string | null
  source: string
  threadItems: Insight[]
}

// ─────────────────────────────────────────────
// 寬容解析
// ─────────────────────────────────────────────

const isRec = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)
const str = (v: unknown): string | null => (typeof v === 'string' ? v : null)
const nonEmpty = (v: unknown): string | null => (typeof v === 'string' && v.trim() !== '' ? v : null)
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/
const TIME_RE = /^\d{2}:\d{2}$/
const MONTH_RE = /^\d{4}-\d{2}$/
const RELATIONS: readonly string[] = ['new', 'reinforce', 'refine', 'overturn']
const PROVENANCES: readonly string[] = ['quote', 'relay', 'tag']

const isRelation = (v: unknown): v is InsightRelation => typeof v === 'string' && RELATIONS.includes(v)
const isProvenance = (v: unknown): v is InsightProvenance => typeof v === 'string' && PROVENANCES.includes(v)

/** 一則心得（列表項格式）；欄位不對回 null */
export function parseInsightItem(raw: unknown): Insight | null {
  if (!isRec(raw)) return null
  const id = nonEmpty(raw.id)
  const date = str(raw.date)
  const text = nonEmpty(raw.text)
  const cluster = nonEmpty(raw.cluster)
  const thread = nonEmpty(raw.thread)
  if (id === null || date === null || !DATE_RE.test(date) || text === null || cluster === null || thread === null) return null
  if (!isProvenance(raw.provenance) || !isRelation(raw.relation)) return null
  const parentRaw = raw.parent
  if (parentRaw !== null && parentRaw !== undefined && typeof parentRaw !== 'string') return null
  const time = str(raw.time)
  return {
    id, date, time: time !== null && TIME_RE.test(time) ? time : null, text, provenance: raw.provenance, cluster, thread, relation: raw.relation,
    parent: typeof parentRaw === 'string' && parentRaw !== '' ? parentRaw : null,
  }
}

const cmpInsight = (a: Insight, b: Insight): number =>
  a.date < b.date ? -1 : a.date > b.date ? 1 : (a.time ?? '') < (b.time ?? '') ? -1 : (a.time ?? '') > (b.time ?? '') ? 1 : a.id < b.id ? -1 : a.id > b.id ? 1 : 0

/** GET /api/insights 的寬容解析：欄位不對的項略過；整體壞掉回 null */
export function parseInsights(raw: unknown): InsightData | null {
  if (!isRec(raw) || !Array.isArray(raw.insights)) return null
  const seen = new Set<string>()
  const insights: Insight[] = []
  for (const r of raw.insights) {
    const it = parseInsightItem(r)
    if (it === null || seen.has(it.id)) continue
    seen.add(it.id)
    insights.push(it)
  }
  insights.sort(cmpInsight)
  const clusters: InsightCluster[] = []
  if (Array.isArray(raw.clusters)) {
    for (const c of raw.clusters) {
      if (!isRec(c)) continue
      const id = nonEmpty(c.id)
      const name = nonEmpty(c.name)
      const count = typeof c.count === 'number' && Number.isFinite(c.count) && c.count >= 0 ? c.count : null
      if (id === null || name === null || count === null || clusters.some((x) => x.id === id)) continue
      clusters.push({ id, name, count })
    }
  }
  const total = typeof raw.total === 'number' && Number.isFinite(raw.total) && raw.total >= 0 ? raw.total : insights.length
  const thisMonth = typeof raw.thisMonth === 'number' && Number.isFinite(raw.thisMonth) && raw.thisMonth >= 0 ? raw.thisMonth : 0
  return { total, thisMonth, clusters, insights }
}

/** GET /api/insights/:id 的寬容解析；缺必要欄位回 null。threadItems 裡壞掉的項略過。 */
export function parseInsightDetail(raw: unknown): InsightDetail | null {
  if (!isRec(raw)) return null
  const base = parseInsightItem({ ...raw, cluster: isRec(raw.cluster) ? raw.cluster.id : raw.cluster })
  if (base === null || !isRec(raw.cluster)) return null
  const cid = nonEmpty(raw.cluster.id)
  if (cid === null) return null
  const items: Insight[] = []
  if (Array.isArray(raw.threadItems)) {
    for (const r of raw.threadItems) {
      const it = parseInsightItem(r)
      if (it !== null) items.push(it)
    }
  }
  items.sort(cmpInsight)
  return {
    id: base.id, date: base.date, time: base.time, text: base.text, evidence: str(raw.evidence) ?? '', provenance: base.provenance,
    cluster: { id: cid, name: str(raw.cluster.name) ?? cid }, thread: base.thread, relation: base.relation, parent: base.parent,
    source: str(raw.source) ?? '', threadItems: items,
  }
}

// ─────────────────────────────────────────────
// 日期與月份
// ─────────────────────────────────────────────

/** 台北今天 YYYY-MM-DD */
export function taipeiDay(now: Date): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Taipei', year: 'numeric', month: '2-digit', day: '2-digit' }).format(now)
}

const dayNumber = (d: string): number => Date.UTC(+d.slice(0, 4), +d.slice(5, 7) - 1, +d.slice(8, 10)) / 86_400_000

/** 近 30 天（含今天、含第 30 天前；未來日期當作剛長出來）內的心得會發光 */
export const GLOW_DAYS = 30

/** 從第一則心得的月份到 now 當月、連續不缺月的 YYYY-MM；沒有心得時只有當月；心得比 now 晚時延伸到最晚那個月 */
export function monthSeries(data: Pick<InsightData, 'insights'>, now: Date = new Date()): string[] {
  const cur = taipeiDay(now).slice(0, 7)
  let first = cur
  let last = cur
  for (const it of data.insights) {
    const m = it.date.slice(0, 7)
    if (!MONTH_RE.test(m)) continue
    if (m < first) first = m
    if (m > last) last = m
  }
  const out: string[] = []
  let y = +first.slice(0, 4)
  let mo = +first.slice(5, 7)
  const endY = +last.slice(0, 4)
  const endM = +last.slice(5, 7)
  while (y < endY || (y === endY && mo <= endM)) {
    out.push(`${y}-${String(mo).padStart(2, '0')}`)
    mo++
    if (mo > 12) { mo = 1; y++ }
  }
  return out
}

// ─────────────────────────────────────────────
// 統計
// ─────────────────────────────────────────────

export interface InsightStats {
  total: number
  thisMonth: number
  topCluster: { name: string; count: number } | null
  /** 脈絡（同一體會）條數 */
  threads: number
  /** 被印證最多次的脈絡：第一則心得的前 20 字與印證次數；沒有任何印證時為 null */
  topReinforced: { text: string; count: number } | null
}

/** 心得總數（API 的 total，沒有就數 insights）、本月新增、最常長在哪一群 */
export function insightStats(data: InsightData, now: Date): InsightStats {
  const month = taipeiDay(now).slice(0, 7)
  const thisMonth = data.insights.length > 0 ? data.insights.filter((i) => i.date.slice(0, 7) === month).length : data.thisMonth
  const counts = new Map<string, number>()
  for (const i of data.insights) counts.set(i.cluster, (counts.get(i.cluster) ?? 0) + 1)
  let top: { id: string; n: number } | null = null
  const order = [...data.clusters.map((c) => c.id), ...[...counts.keys()].filter((k) => !data.clusters.some((c) => c.id === k))]
  for (const id of order) {
    const n = counts.get(id) ?? 0
    if (n > 0 && (top === null || n > top.n)) top = { id, n }
  }
  const topCluster = top ? { name: data.clusters.find((c) => c.id === top!.id)?.name ?? top.id, count: top.n } : null
  const threadCount = new Map<string, { first: Insight; n: number }>()
  for (const i of data.insights) {
    const t = threadCount.get(i.thread)
    if (!t) threadCount.set(i.thread, { first: i, n: i.relation === 'reinforce' ? 1 : 0 })
    else if (i.relation === 'reinforce') t.n++
  }
  let best: { first: Insight; n: number } | null = null
  for (const t of threadCount.values()) if (t.n > 0 && (best === null || t.n > best.n)) best = t
  const topReinforced = best ? { text: best.first.text.length > 20 ? `${best.first.text.slice(0, 20)}…` : best.first.text, count: best.n } : null
  return { total: Math.max(data.total, data.insights.length), thisMonth, topCluster, threads: threadCount.size, topReinforced }
}

/** 搜尋結果裡「同脈絡」的迷你時間線：同一個 thread 在目前結果中可見的心得，依日期排序 */
export interface ThreadDot { id: string; date: string; relation: InsightRelation; self: boolean }
export function threadDots(selfId: string, thread: string, hits: ReadonlyArray<{ id: string; date: string | null; meta?: { thread: string; relation: InsightRelation } }>): ThreadDot[] {
  const dots: ThreadDot[] = []
  for (const h of hits) {
    if (!h.meta || h.meta.thread !== thread) continue
    dots.push({ id: h.id, date: h.date ?? '', relation: h.meta.relation, self: h.id === selfId })
  }
  dots.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
  return dots
}

/** #insight/<id> 的 id（網址編碼還原）；不是這種 hash 回 null */
export function insightIdFromHash(hash: string): string | null {
  if (!hash.startsWith('#insight/')) return null
  const rest = hash.slice('#insight/'.length)
  if (rest === '') return null
  try { return decodeURIComponent(rest) } catch { return rest }
}

// ─────────────────────────────────────────────
// 排版（樹高＝時間）
// ─────────────────────────────────────────────

export type InsightLimbLevel = 'trunk' | 'cluster' | 'thread'

export interface InsightLimb {
  id: string
  /** 填色輪廓的 SVG path（由粗到細；座標已落在 [0,width]×[0,height] 內） */
  d: string
  level: InsightLimbLevel
  /** 起點寬度（＝widthStart；脈絡枝＝1.5＋1.2×印證次數，上限 8） */
  width: number
  widthStart: number
  widthEnd: number
  withered: boolean
  /** 這一段最早的心得月份 YYYY-MM（重播用）；樹幹是整棵樹最早的月份，沒有心得時為 null */
  firstMonth: string | null
  /** 所屬群在 layout.clusters 的序號（樹幹沒有） */
  clusterIndex?: number
  /** 同群不同脈絡的深淺（0～2） */
  shade?: number
  /** 中心線起點 */
  from: [number, number]
  /** 中心線終點（一律不低於起點：枝只往上長） */
  to: [number, number]
}
export interface InsightLeaf {
  id: string
  x: number
  y: number
  /** 碰撞半徑（葉形依它放大） */
  r: number
  clusterIndex: number
  glow: boolean
  withered: boolean
  relation: InsightRelation
  /** 葉尖方向：與垂直線夾角（度，正＝向右），沿所在枝條的切線 */
  angle: number
  shade: number
  /** 從樹幹到這片葉子的整條路徑上的枝段 id（滑過葉子時整條亮起） */
  path: string[]
}
export interface InsightClusterOut {
  id: string
  name: string
  /** upto 之內的心得數 */
  count: number
  /** 主枝末端 */
  x: number
  y: number
  /** 標籤膠囊的中心與大小；labelShown=false 時沒有意義 */
  lx: number
  ly: number
  lw: number
  lh: number
  labelShown: boolean
  /** 膠囊離主枝末端較遠，需要畫細引線 */
  leader: boolean
  /** 這一群所有枝葉（含標籤）的外框，聚焦時用 */
  bbox: { x0: number; y0: number; x1: number; y1: number }
}
export interface TimeTick { y: number; label: string; major: boolean }
export interface InsightTreeLayout {
  width: number
  height: number
  /** 窄畫布（手機）：葉子與標籤縮小 */
  compact: boolean
  trunk: InsightLimb
  limbs: InsightLimb[]
  leaves: InsightLeaf[]
  /** 與資料的群同序（全部都在；upto 內沒有心得的群 count＝0、不畫枝、不顯示標籤） */
  clusters: InsightClusterOut[]
  /** 時間刻度：年（major）與每半年／季／月（minor），y 隨日期單調（越晚越高） */
  ticks: TimeTick[]
  axis: { x: number; top: number; bottom: number; ground: number; dayMin: number; dayMax: number; trunkTop: number }
}
export interface InsightTreeOptions {
  width: number
  height: number
  now: Date
  /** YYYY-MM：重播用，只輸出 date 在該月底以前的枝葉 */
  upto?: string
}

type P = [number, number]

/** FNV-1a → [0,1) */
function hash01(s: string): number {
  let h = 0x811c9dc5
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 0x01000193) >>> 0
  }
  return h / 0x100000000
}

const A1 = (n: number): number => Math.round(n * 10) / 10
const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v))
const fmtP = (p: P): string => `${A1(p[0])},${A1(p[1])}`

/** 印證次數 → 枝寬：1.5 + 1.2 × 次數，上限 8 */
export function threadWidth(reinforceCount: number): number {
  return Math.min(8, 1.5 + 1.2 * Math.max(0, reinforceCount))
}

/** 葉子半徑（依關係；窄畫布乘 0.82） */
const LEAF_R: Record<InsightRelation, number> = { new: 6, reinforce: 8.5, refine: 8, overturn: 7.5 }

/** 葉形（單位座標，葉尖朝上、中心在原點；乘上 r 後使用）。新生＝嫩芽水滴、印證＝飽滿葉＋葉脈、修正＝葉＋旁邊多一小分岔、推翻＝微垂的枯葉 */
export interface LeafShape { kind: 'bud' | 'leaf' | 'fork' | 'dead'; d: string; vein: string | null }
const SHAPES: Record<InsightRelation, LeafShape> = {
  new: { kind: 'bud', d: 'M0,-1.15 C0.75,-0.35 0.62,0.7 0,1 C-0.62,0.7 -0.75,-0.35 0,-1.15Z', vein: null },
  reinforce: { kind: 'leaf', d: 'M0,-1.5 C1.15,-0.8 1.1,0.75 0,1.3 C-1.1,0.75 -1.15,-0.8 0,-1.5Z', vein: 'M0,-1.1 L0,1.15' },
  refine: { kind: 'fork', d: 'M0,-1.35 C1,-0.7 0.95,0.7 0,1.2 C-0.95,0.7 -1,-0.7 0,-1.35Z M0.55,0.55 C1.3,0.15 1.9,0.3 2.15,0.75 C1.5,1.05 0.95,1.05 0.55,0.55Z', vein: 'M0,-0.9 L0,1 M0.3,0.4 L0.55,0.55' },
  overturn: { kind: 'dead', d: 'M-0.1,-1.2 C0.8,-0.5 0.9,0.5 0.2,1.25 C-0.5,0.8 -0.85,-0.3 -0.1,-1.2Z', vein: 'M-0.05,-0.9 C0.2,-0.2 0.2,0.4 0.15,1' },
}
export function leafShape(relation: InsightRelation): LeafShape { return SHAPES[relation] }

// ── 小工具 ──
const cubicAt = (a: P, b: P, c: P, d: P, t: number): P => {
  const u = 1 - t
  return [
    u * u * u * a[0] + 3 * u * u * t * b[0] + 3 * u * t * t * c[0] + t * t * t * d[0],
    u * u * u * a[1] + 3 * u * u * t * b[1] + 3 * u * t * t * c[1] + t * t * t * d[1],
  ]
}
const cubicDir = (a: P, b: P, c: P, d: P, t: number): P => {
  const u = 1 - t
  return [
    3 * u * u * (b[0] - a[0]) + 6 * u * t * (c[0] - b[0]) + 3 * t * t * (d[0] - c[0]),
    3 * u * u * (b[1] - a[1]) + 6 * u * t * (c[1] - b[1]) + 3 * t * t * (d[1] - c[1]),
  ]
}
/** 沿中心線取樣點、每點一個寬度，產生兩側偏移的填色輪廓 */
function ribbon(pts: P[], ws: number[]): string {
  const n = pts.length
  const left: P[] = []
  const right: P[] = []
  for (let k = 0; k < n; k++) {
    const prev = pts[Math.max(0, k - 1)]!
    const next = pts[Math.min(n - 1, k + 1)]!
    const tx = next[0] - prev[0]
    const ty = next[1] - prev[1]
    const len = Math.hypot(tx, ty) || 1
    const nx = -ty / len
    const ny = tx / len
    const h = ws[k]! / 2
    left.push([pts[k]![0] + nx * h, pts[k]![1] + ny * h])
    right.push([pts[k]![0] - nx * h, pts[k]![1] - ny * h])
  }
  return `M${left.map(fmtP).join('L')}L${right.reverse().map(fmtP).join('L')}Z`
}
const angleOf = (dir: P): number => (Math.atan2(dir[0], -dir[1]) * 180) / Math.PI

/** 從 YYYY-MM-DD 的天數回推 YYYY-MM */
const monthOfDayNumber = (dn: number): string => new Date(Math.round(dn) * 86_400_000).toISOString().slice(0, 7)

/** 日期對應的高度（樹高＝時間）：最早的心得在 bottom、最晚（今天）在 top */
export function dateToY(axis: { top: number; bottom: number; dayMin: number; dayMax: number }, date: string): number {
  const span = Math.max(1, axis.dayMax - axis.dayMin)
  const f = clamp((dayNumber(date) - axis.dayMin) / span, 0, 1)
  return axis.bottom - f * (axis.bottom - axis.top)
}

/** 依資料量與寬度建議的樹高：樹冠撐滿卡片，不留大片空白 */
export function suggestTreeHeight(width: number, leafCount: number, monthCount: number): number {
  const base = Math.max(300, width * 0.6)
  return Math.round(Math.min(680, base + Math.min(220, leafCount * 1.1 + monthCount * 5)))
}

interface Branch { id: string; thread: string; items: Insight[]; forkFrom: string | null; width: number }
interface LeafRec { ins: Insight; branch: Branch; k: number; x: number; y: number; r: number; side: number; shade: number; ci: number }

/**
 * 排版。座標直接是畫布座標：樹高＝時間（最早的心得貼近地面、今天在最上面，葉子的高度就是它的日期）；
 * 群＝從樹幹在「該群第一則心得的高度」分出去的主枝（橫向位置依心得數分配，多的居中）；
 * 脈絡＝從主枝上依第一則日期長出、沿著主枝一路長上去的枝；refine 從 parent 葉分岔，overturn 讓 parent 葉與 parent 到被推翻點的那段枝枯萎。
 * 位置一律用全部資料算（重播時枝葉不會亂跳），upto 只決定輸出哪些。不用 Math.random。
 */
export function layoutInsightTree(data: InsightData, opts: InsightTreeOptions): InsightTreeLayout {
  const W = Math.max(200, opts.width)
  const H = Math.max(200, opts.height)
  const compact = W < 520
  const PAD = 12
  const AXIS_W = compact ? 44 : 60
  const rs = (compact ? 0.82 : 1) * (data.insights.length <= 5 ? 1.6 : 1) // 心得很少時葉子放大，小樹苗也看得清楚
  const today = taipeiDay(opts.now)
  const todayN = dayNumber(today)
  const upto = opts.upto !== undefined && MONTH_RE.test(opts.upto) ? opts.upto : null

  const all = [...data.insights].sort(cmpInsight)
  const byIdAll = new Map(all.map((i) => [i.id, i]))
  const isVisible = (i: Insight): boolean => upto === null || i.date.slice(0, 7) <= upto

  // ── 群清單 ──
  const fullCount = new Map<string, number>()
  for (const i of all) fullCount.set(i.cluster, (fullCount.get(i.cluster) ?? 0) + 1)
  const clusterDefs: Array<{ id: string; name: string }> = []
  for (const c of data.clusters) if ((fullCount.get(c.id) ?? 0) > 0 && !clusterDefs.some((x) => x.id === c.id)) clusterDefs.push({ id: c.id, name: c.name })
  for (const id of fullCount.keys()) if (!clusterDefs.some((x) => x.id === id)) clusterDefs.push({ id, name: id })
  const nc = clusterDefs.length
  const cidx = new Map(clusterDefs.map((c, i) => [c.id, i]))

  // ── 時間軸 ──
  let dayMax = Math.max(todayN, all.length > 0 ? dayNumber(all[all.length - 1]!.date) : todayN)
  // 時間軸最少涵蓋 6 個月（最新月份往前 5 個月），資料很少時樹幹也有高度
  const endD = new Date(dayMax * 86_400_000)
  const minStart = Date.UTC(endD.getUTCFullYear(), endD.getUTCMonth() - 5, 1) / 86_400_000
  const dayMin = Math.min(all.length > 0 ? dayNumber(all[0]!.date) : todayN, minStart)
  if (dayMax <= dayMin) dayMax = dayMin + 1
  const few = all.length <= 12
  const ground = H - PAD - 6
  const yBottom = ground - 26
  const yTop = PAD + (compact ? 30 : 34)
  const axis = { x: AXIS_W - 8, top: yTop, bottom: yBottom, ground, dayMin, dayMax, trunkTop: ground }
  const yOfDn = (dn: number): number => yBottom - clamp((dn - dayMin) / (dayMax - dayMin), 0, 1) * (yBottom - yTop)
  const yOf = (date: string): number => yOfDn(dayNumber(date))
  const cx = AXIS_W + (W - AXIS_W) / 2
  const halfW = (W - AXIS_W) / 2 - PAD - 8
  const xMin = AXIS_W + PAD
  const xMax = W - PAD

  // ── 群的橫向位置：心得數多的居中，欄寬依份量 ──
  const nonEmpty = clusterDefs.map((_, i) => i)
  const avg = nc === 0 ? 0 : all.length / nc
  const weight = (i: number): number => (fullCount.get(clusterDefs[i]!.id) ?? 0) + avg * 0.5
  const sortedIdx = [...nonEmpty].sort((a, b) => weight(b) - weight(a) || a - b)
  const ordered: number[] = []
  sortedIdx.forEach((ci, k) => { if (k % 2 === 0) ordered.push(ci); else ordered.unshift(ci) })
  const wsum = ordered.reduce((s, ci) => s + weight(ci), 0) || 1
  const laneCenter = new Array<number>(nc).fill(0)
  const spreadW = few ? Math.min(halfW, 56 * nc + 40) : halfW // 群少時樹冠不用撐滿，依群數置中
  const laneHalf = new Array<number>(nc).fill(spreadW)
  let cur = -spreadW
  for (const ci of ordered) {
    const w = (2 * spreadW * weight(ci)) / wsum
    laneCenter[ci] = cur + w / 2
    laneHalf[ci] = w / 2
    cur += w
  }

  // ── 每群的主枝中心線（三次貝茲）：從樹幹在第一則的高度分出去，彎向外側再往上 ──
  interface CL { p0: P; p1: P; p2: P; p3: P; y0: number; y1: number; first: Insight; count: number }
  const cl: Array<CL | null> = new Array<CL | null>(nc).fill(null)
  for (let ci = 0; ci < nc; ci++) {
    const mine = all.filter((i) => i.cluster === clusterDefs[ci]!.id)
    if (mine.length === 0) continue
    const y0raw = yOf(mine[0]!.date)
    let y1 = Math.max(yTop - 10, Math.min(yOf(mine[mine.length - 1]!.date) - 22, y0raw - 46))
    if (few) y1 = yTop + 4 + (ci % 2) * 18 // 心得少：每群的枝都長到樹冠高度，錯開高低讓膠囊不打架
    const minRise = few ? Math.max(70, 0.3 * (yBottom - yTop)) : 46
    const y0 = Math.max(y0raw, y1 + minRise) // 枝的起點一定低於末端：只往上長
    const rise = y0 - y1
    const tipX = cx + laneCenter[ci]! * 0.88
    const dx = tipX - cx
    // 從樹幹分出的角度：離垂直 15°～60°
    const ddy = rise * 0.3
    const ddx = clamp(Math.abs(dx) * 0.45, ddy * Math.tan((15 * Math.PI) / 180), ddy * Math.tan((60 * Math.PI) / 180))
    const sgn = Math.abs(dx) < 1 ? (ci % 2 ? 1 : -1) : Math.sign(dx)
    cl[ci] = { p0: [cx, y0], p1: [cx + sgn * ddx, y0 - ddy], p2: [cx + dx, y0 - rise * 0.55], p3: [tipX, y1], y0, y1, first: mine[0]!, count: mine.length }
  }
  const pointOnCluster = (ci: number, t: number): P => { const c = cl[ci]!; return cubicAt(c.p0, c.p1, c.p2, c.p3, t) }
  const tAtY = (ci: number, y: number): number => {
    const c = cl[ci]!
    if (y >= c.y0) return 0
    if (y <= c.y1) return 1
    let lo = 0
    let hi = 1
    for (let k = 0; k < 24; k++) {
      const m = (lo + hi) / 2
      if (pointOnCluster(ci, m)[1] > y) lo = m; else hi = m
    }
    return (lo + hi) / 2
  }

  // ── 脈絡與分岔 → 每片葉子的暫定位置 ──
  const owner = new Map<string, string>()
  for (const i of all) if (!owner.has(i.thread)) owner.set(i.thread, i.cluster)
  const threadsOf = new Map<string, Insight[]>()
  for (const i of all) {
    if (!threadsOf.has(i.thread)) threadsOf.set(i.thread, [])
    threadsOf.get(i.thread)!.push(i)
  }
  const recs: LeafRec[] = []
  const recById = new Map<string, LeafRec>()
  const branchList: Array<{ b: Branch; ci: number; start: P | null; startLeaf: string | null; shade: number; dir: number }> = []
  const witheredLeaf = new Set<string>()
  const deadSeg = new Set<string>()

  for (let ci = 0; ci < nc; ci++) {
    const c = cl[ci]
    if (!c) continue
    const cid = clusterDefs[ci]!.id
    const threads = [...threadsOf.keys()].filter((t) => owner.get(t) === cid)
    threads.sort((a, b) => (threadsOf.get(a)![0]!.date < threadsOf.get(b)![0]!.date ? -1 : threadsOf.get(a)![0]!.date > threadsOf.get(b)![0]!.date ? 1 : a < b ? -1 : 1))
    threads.forEach((th, ti) => {
      const items = threadsOf.get(th)!
      const branches: Branch[] = []
      const branchOf = new Map<string, Branch>()
      const main: Branch = { id: th, thread: th, items: [], forkFrom: null, width: threadWidth(items.filter((x) => x.relation === 'reinforce').length) }
      branches.push(main)
      for (const it of items) {
        const p = it.parent !== null ? byIdAll.get(it.parent) : undefined
        const pb = p && p.thread === th ? branchOf.get(p.id) : undefined
        if (it.relation === 'refine' && p && pb) {
          const b: Branch = { id: `${th}~${it.id}`, thread: th, items: [it], forkFrom: p.id, width: 1.5 }
          branches.push(b)
          branchOf.set(it.id, b)
        } else if ((it.relation === 'reinforce' || it.relation === 'overturn') && pb) {
          pb.items.push(it)
          branchOf.set(it.id, pb)
        } else {
          main.items.push(it)
          branchOf.set(it.id, main)
        }
      }
      for (const b of branches) if (b.forkFrom !== null) b.width = threadWidth(b.items.filter((x) => x.relation === 'reinforce').length)
      const side0 = hash01(`side:${th}`) < 0.5 ? -1 : 1
      const mainSide = ti % 2 === 0 ? side0 : -side0
      const shade = ti % 3
      const off0 = 15 + 8 * (ti % 3)
      const phase = hash01(`ph:${th}`) * Math.PI * 2
      let forkN = 0
      for (const b of branches) {
        if (b.items.length === 0) continue
        let start: P | null = null
        let startLeaf: string | null = null
        let side = mainSide
        if (b.forkFrom === null) {
          // 從主枝上「稍早於第一則」的位置長出，枝才會斜著往上長到葉子，不是一根橫桿
          const ya = Math.min(ground - 30, yOf(b.items[0]!.date) + (compact ? 12 : 18))
          start = pointOnCluster(ci, tAtY(ci, ya))
        } else {
          startLeaf = b.forkFrom
          forkN++
          side = (forkN % 2 === 0 ? 1 : -1) * mainSide
        }
        branchList.push({ b, ci, start, startLeaf, shade, dir: side })
        b.items.forEach((it, k) => {
          const y = yOf(it.date)
          let x: number
          if (b.forkFrom === null) {
            const ct = tAtY(ci, y)
            x = pointOnCluster(ci, ct)[0] + side * (off0 + 6 * Math.sin(k * 1.9 + phase))
          } else {
            const pr = recById.get(b.forkFrom)
            x = (pr ? pr.x : cx) + side * (11 + 9 * Math.sqrt(k + 1)) + 3 * Math.sin(k * 2.3 + phase)
          }
          const rec: LeafRec = { ins: it, branch: b, k, x, y, r: LEAF_R[it.relation] * rs, side, shade, ci }
          recs.push(rec)
          recById.set(it.id, rec)
        })
        // 枯萎：overturn 的 parent 與它同一枝時，parent 之後到 overturn 的那段枝與中間的葉都枯萎；parent 葉一律枯萎
        const idxOf = new Map(b.items.map((x, k) => [x.id, k]))
        for (let k = 0; k < b.items.length; k++) {
          const it = b.items[k]!
          if (it.relation !== 'overturn' || it.parent === null) continue
          witheredLeaf.add(it.parent)
          const pk = idxOf.get(it.parent)
          if (pk === undefined || pk >= k) continue
          for (let j = pk; j < k; j++) witheredLeaf.add(b.items[j]!.id)
          for (let j = pk + 1; j <= k; j++) deadSeg.add(`t:${b.id}#${j}`)
        }
      }
    })
  }

  // ── 排擠：高度（日期）固定，只在水平方向把過近的葉子推開，再夾回畫布 ──
  const order = recs.map((_, i) => i).sort((a, b) => recs[a]!.y - recs[b]!.y || a - b)
  for (let pass = 0; pass < 24; pass++) {
    let moved = false
    for (let ii = 0; ii < order.length; ii++) {
      const a = recs[order[ii]!]!
      for (let jj = ii + 1; jj < order.length; jj++) {
        const b = recs[order[jj]!]!
        const dy = b.y - a.y
        const m = (a.r + b.r) * 1.05 + 2
        if (dy >= m) break
        const need = Math.sqrt(Math.max(0, m * m - dy * dy))
        const dx = b.x - a.x
        if (Math.abs(dx) >= need) continue
        const dir = dx === 0 ? (hash01(`${a.ins.id}|${b.ins.id}`) < 0.5 ? -1 : 1) : Math.sign(dx)
        const push = (need - Math.abs(dx)) / 2 + 0.2
        a.x -= dir * push
        b.x += dir * push
        moved = true
      }
    }
    for (const r of recs) r.x = clamp(r.x, xMin + r.r, xMax - r.r)
    if (!moved) break
  }
  for (const r of recs) r.x = A1(r.x)

  // ── 枝條：樹幹、主枝分段、脈絡分段（皆為由粗到細的填色輪廓）──
  const limbsAll: InsightLimb[] = []
  const leafPath = new Map<string, string[]>()
  const leafAngle = new Map<string, number>()
  const totalLeaves = Math.max(1, all.length)
  const trunkW0 = clamp(14 + 1.6 * Math.sqrt(totalLeaves), 14, 28)
  const earliestMonth = all.length > 0 ? all[0]!.date.slice(0, 7) : null

  const CH = 5
  const clusterChunkIds: string[][] = []
  for (let ci = 0; ci < nc; ci++) {
    const c = cl[ci]
    const ids: string[] = []
    clusterChunkIds.push(ids)
    if (!c) continue
    const cid = clusterDefs[ci]!.id
    const w0 = clamp(5 + 1.5 * Math.sqrt(c.count), 6, 13)
    const w1 = 2.6
    for (let k = 0; k < CH; k++) {
      const t0 = k / CH
      const t1 = (k + 1) / CH
      const pts: P[] = []
      const ws: number[] = []
      for (let s = 0; s <= 8; s++) {
        const t = t0 + ((t1 - t0) * s) / 8
        pts.push(cubicAt(c.p0, c.p1, c.p2, c.p3, t))
        ws.push(w0 + (w1 - w0) * Math.pow(t, 0.85))
      }
      const yStart = pts[0]![1]
      const fm = k === 0 ? c.first.date.slice(0, 7) : monthOfDayNumber(dayMin + ((yBottom - yStart) / (yBottom - yTop)) * (dayMax - dayMin))
      const id = `c:${cid}#${k}`
      ids.push(id)
      limbsAll.push({
        id, d: ribbon(pts, ws), level: 'cluster', width: A1(ws[0]!), widthStart: A1(ws[0]!), widthEnd: A1(ws[ws.length - 1]!), withered: false,
        firstMonth: fm < c.first.date.slice(0, 7) ? c.first.date.slice(0, 7) : fm, clusterIndex: ci, from: [A1(pts[0]![0]), A1(pts[0]![1])], to: [A1(pts[pts.length - 1]![0]), A1(pts[pts.length - 1]![1])],
      })
    }
  }

  for (const bl of branchList) {
    const { b, ci } = bl
    const items = b.items
    const n = items.length
    let startPt: P
    let basePath: string[]
    if (bl.startLeaf === null) {
      startPt = bl.start!
      basePath = ['trunk', ...clusterChunkIds[ci]!]
    } else {
      const pr = recById.get(bl.startLeaf)!
      startPt = [pr.x, pr.y]
      basePath = leafPath.get(bl.startLeaf) ?? ['trunk', ...clusterChunkIds[ci]!]
    }
    const anchors: P[] = [startPt, ...items.map((it) => { const r = recById.get(it.id)!; return [r.x, r.y] as P })]
    const wAt = (j: number): number => b.width * (1 - 0.5 * (j / n))
    const segIds: string[] = []
    for (let j = 0; j < n; j++) {
      const p0 = anchors[Math.max(0, j - 1)]!
      const p1 = anchors[j]!
      const p2 = anchors[j + 1]!
      const p3 = anchors[Math.min(n, j + 2)]!
      // 控制點的高度夾在起終點之間：每一段只往上，不會下垂再上翹
      const c1y = clamp(p1[1] + (p2[1] - p0[1]) / 6, p2[1], p1[1])
      const c2y = clamp(p2[1] - (p3[1] - p1[1]) / 6, p2[1], c1y)
      const c1: P = [p1[0] + (p2[0] - p0[0]) / 6, c1y]
      const c2: P = [p2[0] - (p3[0] - p1[0]) / 6, c2y]
      const pts: P[] = []
      const ws: number[] = []
      for (let s = 0; s <= 8; s++) {
        const t = s / 8
        pts.push(cubicAt(p1, c1, c2, p2, t))
        ws.push(wAt(j) + (wAt(j + 1) - wAt(j)) * t)
      }
      const it = items[j]!
      const id = `t:${b.id}#${j}`
      segIds.push(id)
      limbsAll.push({
        id, d: ribbon(pts, ws), level: 'thread', width: A1(ws[0]!), widthStart: A1(ws[0]!), widthEnd: A1(ws[ws.length - 1]!),
        withered: deadSeg.has(id), firstMonth: it.date.slice(0, 7), clusterIndex: ci, shade: bl.shade, from: [A1(p1[0]), A1(p1[1])], to: [A1(p2[0]), A1(p2[1])],
      })
      leafPath.set(it.id, [...basePath, ...segIds])
      const d = cubicDir(p1, c1, c2, p2, 1)
      let ang = angleOf(d)
      if (it.relation === 'overturn') ang += 38 * (bl.dir || 1)
      leafAngle.set(it.id, Math.round(ang))
    }
  }

  // ── 可見的部分 ──
  const visIns = all.filter(isVisible)
  const visLeaves = visIns.filter((i) => recById.has(i.id))
  const visCount = clusterDefs.map((c) => visIns.filter((i) => i.cluster === c.id).length)
  const limbs = limbsAll.filter((l) => l.level !== 'trunk' && (upto === null || (l.firstMonth !== null && l.firstMonth <= upto)))
  const visClusterStartY = visCount.map((n, ci) => (n > 0 && cl[ci] ? cl[ci]!.y0 : Infinity))
  const trunkTop = Math.min(ground - 46, ...visClusterStartY.filter((y) => Number.isFinite(y)).map((y) => y - 4))
  const trunkPts: P[] = []
  const trunkWs: number[] = []
  const bend = (hash01('trunk') - 0.5) * 10
  for (let s = 0; s <= 14; s++) {
    const t = s / 14
    trunkPts.push([cx + bend * Math.sin(Math.PI * t), ground + (trunkTop - ground) * t])
    trunkWs.push(trunkW0 * (1 - 0.55 * Math.pow(t, 0.8)))
  }
  // 樹幹頂端收成圓頭，不留平頂
  const topW = trunkWs[trunkWs.length - 1]!
  for (let c = 1; c <= 3; c++) {
    const f = c / 3
    trunkPts.push([trunkPts[trunkPts.length - 1]![0], trunkTop - (topW / 2) * Math.sin((f * Math.PI) / 2)])
    trunkWs.push(topW * Math.cos((f * Math.PI) / 2) + 0.2)
  }
  const trunk: InsightLimb = {
    id: 'trunk', d: ribbon(trunkPts, trunkWs), level: 'trunk', width: A1(trunkWs[0]!), widthStart: A1(trunkWs[0]!), widthEnd: A1(trunkWs[trunkWs.length - 1]!),
    withered: false, firstMonth: earliestMonth, from: [A1(trunkPts[0]![0]), A1(trunkPts[0]![1])], to: [A1(trunkPts[trunkPts.length - 1]![0]), A1(trunkPts[trunkPts.length - 1]![1])],
  }

  const leaves: InsightLeaf[] = visLeaves.map((i) => {
    const r = recById.get(i.id)!
    return {
      id: i.id, x: r.x, y: A1(r.y), r: A1(r.r), clusterIndex: r.ci, glow: todayN - dayNumber(i.date) <= GLOW_DAYS, withered: witheredLeaf.has(i.id),
      relation: i.relation, angle: leafAngle.get(i.id) ?? 0, shade: r.shade, path: leafPath.get(i.id) ?? ['trunk'],
    }
  })

  // ── 群標籤：色點＋群名＋則數的小膠囊，放在主枝末端附近；避開葉子與其他標籤，放不下往外側推並畫引線 ──
  const fs = compact ? 11 : 12.5
  const nameMax = compact ? 6 : 8
  const textW = (s: string): number => [...s].reduce((w, ch) => w + (/[\u0000-ÿ]/.test(ch) ? fs * 0.58 : fs), 0)
  const clusters: InsightClusterOut[] = clusterDefs.map((c, ci) => {
    const cc = cl[ci]
    const tip: P = cc ? cc.p3 : [cx, ground - 40]
    const nm = c.name.length > nameMax ? `${c.name.slice(0, nameMax - 1)}…` : c.name
    const lw = 10 + textW(nm) + (compact ? 0 : textW(String(visCount[ci]!)) + 8) + 12
    return { id: c.id, name: c.name, count: visCount[ci]!, x: A1(tip[0]), y: A1(tip[1]), lx: A1(tip[0]), ly: A1(tip[1]), lw: A1(lw), lh: A1(fs + 9), labelShown: false, leader: false, bbox: { x0: tip[0], y0: tip[1], x1: tip[0], y1: tip[1] } }
  })
  const placed: Array<{ x0: number; y0: number; x1: number; y1: number }> = []
  const hitsLeaf = (r: { x0: number; y0: number; x1: number; y1: number }): boolean =>
    leaves.some((l) => {
      const nx = clamp(l.x, r.x0, r.x1)
      const ny = clamp(l.y, r.y0, r.y1)
      return Math.hypot(l.x - nx, l.y - ny) < l.r * 1.25 + 2
    })
  const byCount = clusters.map((_, i) => i).filter((i) => clusters[i]!.count > 0).sort((a, b) => clusters[b]!.count - clusters[a]!.count || a - b)
  for (const i of byCount) {
    const c = clusters[i]!
    const hw = c.lw / 2
    const hh = c.lh / 2
    const cands: P[] = [
      [0, -hh - 8], [-hw - 4, -hh - 6], [hw + 4, -hh - 6], [0, -3 * hh - 6], [-hw - 6, -3 * hh - 4], [hw + 6, -3 * hh - 4],
      [-hw - 12, 0], [hw + 12, 0], [0, -5 * hh - 6], [-hw - 10, -5 * hh], [hw + 10, -5 * hh], [-hw - 16, 3 * hh], [hw + 16, 3 * hh],
    ]
    for (const [ox, oy] of cands) {
      const x = clamp(c.x + ox, hw + 2, W - hw - 2)
      const y = clamp(c.y + oy, hh + 2, H - hh - 2)
      const r = { x0: x - hw, y0: y - hh, x1: x + hw, y1: y + hh }
      if (hitsLeaf(r)) continue
      if (placed.some((o) => r.x0 < o.x1 + 3 && r.x1 > o.x0 - 3 && r.y0 < o.y1 + 3 && r.y1 > o.y0 - 3)) continue
      placed.push(r)
      c.lx = A1(x)
      c.ly = A1(y)
      c.labelShown = true
      c.leader = Math.hypot(x - c.x, y - c.y) > hh * 2.4
      break
    }
  }
  // 外框（聚焦用）
  clusters.forEach((c, ci) => {
    if (c.count === 0) return
    const bb = { x0: c.x - 8, y0: c.y - 8, x1: c.x + 8, y1: c.y + 8 }
    const grow = (x0: number, y0: number, x1: number, y1: number): void => { bb.x0 = Math.min(bb.x0, x0); bb.y0 = Math.min(bb.y0, y0); bb.x1 = Math.max(bb.x1, x1); bb.y1 = Math.max(bb.y1, y1) }
    for (const l of leaves) if (l.clusterIndex === ci) grow(l.x - l.r * 1.6, l.y - l.r * 1.6, l.x + l.r * 1.6, l.y + l.r * 1.6)
    if (c.labelShown) grow(c.lx - c.lw / 2, c.ly - c.lh / 2, c.lx + c.lw / 2, c.ly + c.lh / 2)
    c.bbox = { x0: A1(bb.x0), y0: A1(bb.y0), x1: A1(bb.x1), y1: A1(bb.y1) }
  })

  // ── 時間刻度：年與每半年／季／月 ──
  const ticks: TimeTick[] = []
  const spanMonths = (dayMax - dayMin) / 30.44
  const step = spanMonths >= 14 ? 6 : spanMonths >= 8 ? 3 : 1
  const d0 = new Date(dayMin * 86_400_000)
  let ty = d0.getUTCFullYear()
  let tm = d0.getUTCMonth() // 下一步先 +1 ＝從最早那個月的 1 號開始（可能比最早的心得早幾天，y 夾在底部）
  let lastY = Infinity
  for (let guard = 0; guard < 400; guard++) {
    tm++
    if (tm > 12) { tm = 1; ty++ }
    const dn = Date.UTC(ty, tm - 1, 1) / 86_400_000
    if (dn > dayMax) break
    if ((tm - 1) % step !== 0) continue
    const y = yOfDn(dn)
    if (lastY - y < 16) continue
    lastY = y
    ticks.push({ y: A1(y), label: tm === 1 ? String(ty) : `${ty}-${String(tm).padStart(2, '0')}`, major: tm === 1 })
  }

  return { width: W, height: H, compact, trunk, limbs, leaves, clusters, ticks, axis: { ...axis, trunkTop: A1(trunkTop) } }
}

/** 群標籤顯示文字（太長截短） */
export function clusterLabelText(name: string, max = 8): string {
  return name.length > max ? `${name.slice(0, max - 1)}…` : name
}

/** 聚焦某一群時的 viewBox：包住那一群的枝葉與標籤，維持畫布長寬比，不超出畫布；null＝全樹 */
export function focusViewBox(layout: Pick<InsightTreeLayout, 'width' | 'height' | 'clusters'>, clusterIndex: number | null): { x: number; y: number; w: number; h: number } {
  const W = layout.width
  const H = layout.height
  const c = clusterIndex === null ? undefined : layout.clusters[clusterIndex]
  if (!c || c.count === 0) return { x: 0, y: 0, w: W, h: H }
  const m = 16
  const bw = c.bbox.x1 - c.bbox.x0 + 2 * m
  const bh = c.bbox.y1 - c.bbox.y0 + 2 * m
  const aspect = W / H
  let w = Math.max(bw, bh * aspect, W * 0.42)
  let h = w / aspect
  if (w > W) { w = W; h = H }
  const x = clamp((c.bbox.x0 + c.bbox.x1) / 2 - w / 2, 0, W - w)
  const y = clamp((c.bbox.y0 + c.bbox.y1) / 2 - h / 2, 0, H - h)
  return { x: A1(x), y: A1(y), w: A1(w), h: A1(h) }
}

/** 側欄群清單的每一列：則數、最近一次長葉的日期、近 12 個月每月則數（含當月，舊→新） */
export interface ClusterSummary { id: string; name: string; count: number; lastDate: string | null; months: number[] }
export function clusterSummaries(data: InsightData, now: Date): ClusterSummary[] {
  const cur = taipeiDay(now).slice(0, 7)
  const keys: string[] = []
  let y = +cur.slice(0, 4)
  let m = +cur.slice(5, 7)
  for (let k = 0; k < 12; k++) {
    keys.unshift(`${y}-${String(m).padStart(2, '0')}`)
    m--
    if (m < 1) { m = 12; y-- }
  }
  const ids: Array<{ id: string; name: string }> = []
  for (const c of data.clusters) if (!ids.some((x) => x.id === c.id)) ids.push({ id: c.id, name: c.name })
  for (const i of data.insights) if (!ids.some((x) => x.id === i.cluster)) ids.push({ id: i.cluster, name: i.cluster })
  const out: ClusterSummary[] = ids.map((c) => ({ id: c.id, name: c.name, count: 0, lastDate: null, months: new Array<number>(12).fill(0) }))
  const byId = new Map(out.map((c) => [c.id, c]))
  for (const i of data.insights) {
    const c = byId.get(i.cluster)
    if (!c) continue
    c.count++
    if (c.lastDate === null || i.date > c.lastDate) c.lastDate = i.date
    const k = keys.indexOf(i.date.slice(0, 7))
    if (k >= 0) c.months[k]!++
  }
  return out.filter((c) => c.count > 0)
}
