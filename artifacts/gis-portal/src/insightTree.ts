// 首頁「我的心得樹」的純函式（2.99.0；3.0.0 改成一棵人生樹）：寬容解析 /api/insights、把心得排成由下往上長的樹、統計與月份序列。
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
// 排版（3.0.0：一棵樹＝人生；主枝＝主題；時間沿主枝往外走）
// ─────────────────────────────────────────────

export type InsightLimbLevel = 'trunk' | 'cluster' | 'thread'
/** 葉的新舊：0 近 30 天（發光）、1 一年內、2 一～三年、3 三年以上 */
export type InsightAge = 0 | 1 | 2 | 3

export interface InsightLimb {
  id: string
  /** 填色輪廓的 SVG path（由粗到細） */
  d: string
  level: InsightLimbLevel
  width: number
  widthStart: number
  widthEnd: number
  withered: boolean
  /** 這一段最早的心得月份 YYYY-MM（重播用）；樹幹是整棵樹最早的月份，沒有心得時為 null */
  firstMonth: string | null
  clusterIndex?: number
  shade?: number
  from: [number, number]
  to: [number, number]
}
export interface InsightLeaf {
  id: string
  x: number
  y: number
  r: number
  clusterIndex: number
  glow: boolean
  withered: boolean
  relation: InsightRelation
  /** 葉尖方向（度，正＝向右），沿所在細枝的切線 */
  angle: number
  shade: number
  age: InsightAge
  /** 所屬脈絡細枝從主枝分出的位置 0（樹幹）～1（枝梢）：隨脈絡第一則的日期由內往外單調遞增 */
  bt: number
  /** 沿所在細枝的位置 0～1（同脈絡內由舊到新遞增，最新在細枝梢） */
  tw: number
  /** 從樹幹到這片葉子的整條路徑上的枝段 id（滑過葉子時整條亮起） */
  path: string[]
}
/** 總覽時被聚合的一叢葉子 */
export interface InsightClump { id: string; clusterIndex: number; x: number; y: number; r: number; count: number; bt: number }
/** 一條畫出來的脈絡細枝：分出點、理想末端、與主枝切線的夾角（度）、長度 */
export interface InsightTwig { id: string; clusterIndex: number; fx: number; fy: number; ex: number; ey: number; angle: number; length: number }
export interface BranchTick { label: string; t: number; x: number; y: number }
export interface InsightClusterOut {
  id: string
  name: string
  /** upto 之內的心得數 */
  count: number
  /** 主枝末端 */
  x: number
  y: number
  /** 主枝與樹幹的接點（該主題第一次出現） */
  ax: number
  ay: number
  side: 1 | -1
  /** 主枝長度（接點到枝梢的直線距離） */
  len: number
  firstDate: string
  /** 膠囊的中心與大小 */
  lx: number
  ly: number
  lw: number
  lh: number
  /** true＝膠囊放得下、預設顯示；false＝縮成色點，滑過／聚焦／點清單時才放大 */
  labelShown: boolean
  text: string
  showCount: boolean
  /** 這一群所有枝葉（含標籤）的外框，聚焦時用 */
  bbox: { x0: number; y0: number; x1: number; y1: number }
  /** 聚焦這一群時沿主枝的時間標籤（其他時候為空） */
  ticks: BranchTick[]
}
export interface InsightTreeLayout {
  width: number
  height: number
  compact: boolean
  trunk: InsightLimb
  limbs: InsightLimb[]
  leaves: InsightLeaf[]
  clumps: InsightClump[]
  twigs: InsightTwig[]
  /** 依「該主題第一次出現」由舊到新排序（最早的在樹幹最下面）；與資料的群順序可能不同 */
  clusters: InsightClusterOut[]
  /** 總覽元素數（枝＋葉＋葉叢＋樹幹） */
  elementCount: number
  axis: { x: number; ground: number; top: number; bottom: number; trunkTop: number; cx: number }
}
export interface InsightTreeOptions {
  width: number
  height: number
  now: Date
  /** YYYY-MM：重播用，只輸出 date 在該月底以前的枝葉 */
  upto?: string
  /** 聚焦的群 id：該群畫出全部脈絡與每片葉；沒有（或不存在）就是總覽 */
  focus?: string | null
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

const LEAF_R: Record<InsightRelation, number> = { new: 6, reinforce: 8.5, refine: 8, overturn: 7.5 }

/** 葉形（單位座標，葉尖朝上、中心在原點；乘上 r 後使用） */
export interface LeafShape { kind: 'bud' | 'leaf' | 'fork' | 'dead'; d: string; vein: string | null }
const SHAPES: Record<InsightRelation, LeafShape> = {
  new: { kind: 'bud', d: 'M0,-1.15 C0.75,-0.35 0.62,0.7 0,1 C-0.62,0.7 -0.75,-0.35 0,-1.15Z', vein: null },
  reinforce: { kind: 'leaf', d: 'M0,-1.5 C1.15,-0.8 1.1,0.75 0,1.3 C-1.1,0.75 -1.15,-0.8 0,-1.5Z', vein: 'M0,-1.1 L0,1.15' },
  refine: { kind: 'fork', d: 'M0,-1.35 C1,-0.7 0.95,0.7 0,1.2 C-0.95,0.7 -1,-0.7 0,-1.35Z M0.55,0.55 C1.3,0.15 1.9,0.3 2.15,0.75 C1.5,1.05 0.95,1.05 0.55,0.55Z', vein: 'M0,-0.9 L0,1 M0.3,0.4 L0.55,0.55' },
  overturn: { kind: 'dead', d: 'M-0.1,-1.2 C0.8,-0.5 0.9,0.5 0.2,1.25 C-0.5,0.8 -0.85,-0.3 -0.1,-1.2Z', vein: 'M-0.05,-0.9 C0.2,-0.2 0.2,0.4 0.15,1' },
}
export function leafShape(relation: InsightRelation): LeafShape { return SHAPES[relation] }

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

/** Catmull-Rom 一段（p1→p2）的取樣點（含兩端） */
function segPts(p0: P, p1: P, p2: P, p3: P, n = 6): P[] {
  const c1: P = [p1[0] + (p2[0] - p0[0]) / 6, p1[1] + (p2[1] - p0[1]) / 6]
  const c2: P = [p2[0] - (p3[0] - p1[0]) / 6, p2[1] - (p3[1] - p1[1]) / 6]
  const out: P[] = []
  for (let s = 0; s <= n; s++) out.push(cubicAt(p1, c1, c2, p2, s / n))
  return out
}

/** 葉的新舊分級（以天數） */
export function leafAge(ageDays: number): InsightAge {
  return ageDays <= GLOW_DAYS ? 0 : ageDays <= 365 ? 1 : ageDays <= 1095 ? 2 : 3
}

/** 建議的樹繪圖區高度：桌機約 min(78vh, 900)，手機依寬度 */
export function suggestTreeHeight(width: number, viewportH = 900): number {
  if (width < 520) return Math.round(clamp(width * 1.45, 420, 620))
  return Math.round(clamp(Math.min(viewportH * 0.78, 900), 480, 900))
}

/** 總覽元素數上限（枝＋葉＋葉叢） */
export const OVERVIEW_ELEMENT_CAP = 400
const TWIG_CAP = 5
const CLUMP_CAP = 2
const RECENT_DAYS = 90

/**
 * 排版。一棵樹＝人生：每個群一條從樹幹長出的主枝，接點依「該群第一則心得的日期」由下往上等距排開（只是先後，不是比例），左右交錯；
 * 時間沿主枝由內往外走，越外越新、最新在枝梢；脈絡是從主枝分出、沿主枝並行的細枝，內部同樣由舊到新。
 * 位置一律用全部資料算（重播、聚焦時枝葉不會亂跳），總覽時每群只畫約 24 片葉，其餘聚成葉叢；聚焦的群畫全部。不用 Math.random。
 */
export function layoutInsightTree(data: InsightData, opts: InsightTreeOptions): InsightTreeLayout {
  const W = Math.max(200, opts.width)
  const H = Math.max(200, opts.height)
  const compact = W < 520
  const PAD = 12
  const all = [...data.insights].sort(cmpInsight)
  const rs = (compact ? 0.82 : 1) * (all.length <= 5 ? 1.6 : 1)
  const todayN = dayNumber(taipeiDay(opts.now))
  const upto = opts.upto !== undefined && MONTH_RE.test(opts.upto) ? opts.upto : null
  const byIdAll = new Map(all.map((i) => [i.id, i]))
  const isVisible = (i: Insight): boolean => upto === null || i.date.slice(0, 7) <= upto

  // ── 群：依第一則日期排序（最早在最下面） ──
  const nameOf = new Map(data.clusters.map((c) => [c.id, c.name]))
  const firstOf = new Map<string, Insight>()
  const itemsOf = new Map<string, Insight[]>()
  for (const i of all) {
    if (!firstOf.has(i.cluster)) firstOf.set(i.cluster, i)
    if (!itemsOf.has(i.cluster)) itemsOf.set(i.cluster, [])
    itemsOf.get(i.cluster)!.push(i)
  }
  const cids = [...itemsOf.keys()].sort((a, b) => (firstOf.get(a)!.date < firstOf.get(b)!.date ? -1 : firstOf.get(a)!.date > firstOf.get(b)!.date ? 1 : a < b ? -1 : 1))
  const nc = cids.length
  const cidx = new Map(cids.map((c, i) => [c, i]))

  // ── 樹幹與主枝接點（等距） ──
  const trunkW0 = clamp(14 + 1.6 * Math.sqrt(Math.max(1, all.length)), 14, compact ? 20 : 28)
  const TRUNK_BEND = 4
  const cx = W / 2
  const ground = H - PAD - 6
  const yBottom = ground - 30
  const yTop = PAD + (compact ? 40 : 50)
  const span = yBottom - yTop
  const step = span / Math.max(4, nc)
  const attachY = (k: number): number => yBottom - step * (k + 0.5)
    const maxLen = W / 2 - PAD - (compact ? 4 : 10) - trunkW0 / 2
  const minLen = Math.min(maxLen * 0.45, 90)
  const clear = (r: number): number => trunkW0 / 2 + TRUNK_BEND + r + 3
  const ls = clamp((2 * step) / 110, 0.5, 1) // 脈絡細枝橫向（離主枝）距離的縮放

  interface Br { p0: P; p1: P; p2: P; p3: P; side: 1 | -1; tc: number; len: number }
  const br: Br[] = []
  for (let k = 0; k < nc; k++) {
    const its = itemsOf.get(cids[k]!)!
    const n = its.length
    const spanDays = dayNumber(its[n - 1]!.date) - dayNumber(its[0]!.date)
    const frac = 0.6 * clamp(Math.log(1 + n) / Math.log(41), 0, 1) + 0.4 * clamp(spanDays / 1095, 0, 1)
    // 樹冠接近橢圓：中段的主枝長、上下兩端的短
    const u = nc <= 1 ? 0 : (k / (nc - 1)) * 2 - 1
    const ell = 0.62 + 0.38 * Math.sqrt(Math.max(0, 1 - u * u))
    const len = (minLen + (maxLen - minLen) * frac) * ell
    const s: 1 | -1 = k % 2 === 0 ? 1 : -1
    const y0 = attachY(k)
    // 主枝從樹幹往外上方彎：同側相鄰主枝的接點差 2 步，爬升不超過 1.15 步，彼此不穿過
    const rise = Math.min(step * 1.15, len * 0.55)
    const b: Br = {
      p0: [cx, y0], p1: [cx + s * len * 0.22, y0 - rise * 0.3], p2: [cx + s * len * 0.58, y0 - rise * 0.75], p3: [cx + s * len, y0 - rise], side: s, tc: 0.06, len,
    }
    const need = clear(LEAF_R.reinforce * rs)
    let t = 0.06
    while (t < 0.5 && Math.abs(cubicAt(b.p0, b.p1, b.p2, b.p3, t)[0] - cx) < need) t += 0.02
    b.tc = A1(t * 100) / 100
    br.push(b)
  }
  const pointOn = (k: number, t: number): P => { const b = br[k]!; return cubicAt(b.p0, b.p1, b.p2, b.p3, t) }
  const upNormal = (k: number, t: number): P => {
    const b = br[k]!
    const d = cubicDir(b.p0, b.p1, b.p2, b.p3, t)
    const l = Math.hypot(d[0], d[1]) || 1
    let n: P = [d[1] / l, -d[0] / l]
    if (n[1] > 0) n = [-n[0], -n[1]]
    return n
  }

  // ── 主枝上的位置：日期比例與名次各占一半（嚴格遞增、同日也分得開） ──
  const lo = cids.map((c) => dayNumber(itemsOf.get(c)![0]!.date))
  const hi = cids.map((c) => dayNumber(itemsOf.get(c)![itemsOf.get(c)!.length - 1]!.date))
  const tOfIndex = (k: number, i: number, dn: number): number => {
    const n = itemsOf.get(cids[k]!)!.length
    const df = hi[k]! > lo[k]! ? (dn - lo[k]!) / (hi[k]! - lo[k]!) : 1
    const rf = n <= 1 ? 1 : i / (n - 1)
    const tc = br[k]!.tc
    return tc + (1 - tc) * (0.5 * df + 0.5 * rf)
  }
  const tOfDay = (k: number, dn: number): number => {
    const its = itemsOf.get(cids[k]!)!
    let c = 0
    while (c < its.length && dayNumber(its[c]!.date) < dn) c++
    const n = its.length
    const df = hi[k]! > lo[k]! ? clamp((dn - lo[k]!) / (hi[k]! - lo[k]!), 0, 1) : 1
    const rf = n <= 1 ? 1 : Math.min(c, n - 1) / (n - 1)
    const tc = br[k]!.tc
    return tc + (1 - tc) * (0.5 * df + 0.5 * rf)
  }

  // ── 每片葉的位置（與輸出哪些無關） ──
  interface Rec { ins: Insight; k: number; bt: number; tw: number; x: number; y: number; r: number; shade: number; thread: string; lane: number }
  const recById = new Map<string, Rec>()
  const threadItems = new Map<string, Insight[]>() // thread → items（全部資料，依日期）
  for (const i of all) {
    if (!threadItems.has(i.thread)) threadItems.set(i.thread, [])
    threadItems.get(i.thread)!.push(i)
  }
  const ownerCluster = new Map<string, string>()
  for (const i of all) if (!ownerCluster.has(i.thread)) ownerCluster.set(i.thread, i.cluster)
  const clusterRank = new Map<string, number>() // 在群內的名次
  for (let k = 0; k < nc; k++) itemsOf.get(cids[k]!)!.forEach((it, i) => clusterRank.set(it.id, i))
  // 脈絡細枝：從主枝上「脈絡第一則日期的位置」以 26°～50° 斜斜分出，朝外上方（或外下方）長，長度依則數 log 縮放、短於主枝；葉子沿細枝由舊到新
  interface Geo { k: number; F: P; end: P; L: number; tf: number; angle: number }
  const geoOf = new Map<string, Geo>()
  const tiOf = new Map<string, number>()
  for (let k = 0; k < nc; k++) {
    const ths = [...threadItems.keys()].filter((t) => ownerCluster.get(t) === cids[k])
    ths.sort((a, b) => (threadItems.get(a)![0]!.date < threadItems.get(b)![0]!.date ? -1 : threadItems.get(a)![0]!.date > threadItems.get(b)![0]!.date ? 1 : a < b ? -1 : 1))
    ths.forEach((t, ti) => tiOf.set(t, ti))
  }
  const byCluster: Rec[][] = cids.map(() => [])
  for (const [th, items] of threadItems) {
    const kk = cidx.get(ownerCluster.get(th)!)!
    const ti = tiOf.get(th)!
    const b = br[kk]!
    const tf = tOfIndex(kk, clusterRank.get(items[0]!.id)!, dayNumber(items[0]!.date))
    const F = pointOn(kk, tf)
    const dd = cubicDir(b.p0, b.p1, b.p2, b.p3, tf)
    const dl = Math.hypot(dd[0], dd[1]) || 1
    const tau: P = [dd[0] / dl, dd[1] / dl]
    const un = upNormal(kk, tf)
    const upSide = ti % 2 === 0
    const phiDeg = upSide ? 50 - 4 * (ti % 3) : 28 + 3 * (ti % 3)
    const phi = (phiDeg * Math.PI) / 180
    const sg = upSide ? 1 : -1
    const dir: P = [tau[0] * Math.cos(phi) + un[0] * Math.sin(phi) * sg, tau[1] * Math.cos(phi) + un[1] * Math.sin(phi) * sg]
    const m = items.length
    const L = Math.min(b.len * 0.5, 1.3 * step, Math.max(22 * rs, (28 + 18 * Math.log2(1 + m)) * rs))
    const perp: P = [-dir[1], dir[0]]
    const end: P = [F[0] + dir[0] * L, F[1] + dir[1] * L]
    const ang = (Math.acos(clamp(tau[0] * dir[0] + tau[1] * dir[1], -1, 1)) * 180) / Math.PI
    geoOf.set(th, { k: kk, F, end, L, tf, angle: ang })
    items.forEach((it, j) => {
      const r = LEAF_R[it.relation] * rs
      const tw = m === 1 ? 1 : 0.3 + (0.7 * j) / (m - 1)
      const z = m > 1 ? (j % 2 === 0 ? 1 : -1) * r * 0.8 : 0
      let x = F[0] + dir[0] * L * tw + perp[0] * z
      let y = F[1] + dir[1] * L * tw + perp[1] * z
      const need = clear(r)
      if (Math.abs(x - cx) < need) x = cx + b.side * need
      x = clamp(x, PAD + r, W - PAD - r)
      y = clamp(y, PAD + r, ground - r)
      const rec: Rec = { ins: it, k: cidx.get(it.cluster) ?? kk, bt: tf, tw, x, y, r, shade: ti % 3, thread: th, lane: 0 }
      recById.set(it.id, rec)
      byCluster[rec.k]!.push(rec)
    })
  }
  // 葉子不重疊：同一群內把過近的葉子沿連線推開（高度與日期順序由細枝決定，這裡只做小幅修正），再夾回畫布與離開樹幹
  for (let k = 0; k < nc; k++) {
    const arr = byCluster[k]!
    if (arr.length < 2) continue
    const need = clear(LEAF_R.reinforce * rs)
    for (let pass = 0; pass < 80; pass++) {
      arr.sort((p, q) => p.x - q.x)
      let moved = false
      for (let i = 0; i < arr.length; i++) {
        const a = arr[i]!
        for (let j = i + 1; j < arr.length; j++) {
          const c = arr[j]!
          if (c.x - a.x > (a.r + c.r) * 1.2 + 2) break
          const dx = c.x - a.x
          const dy = c.y - a.y
          const m = (a.r + c.r) * 0.95 + 1.5
          if (Math.abs(dx) >= m || Math.abs(dy) >= m) continue
          // 方框重疊：沿重疊較淺的那個軸把兩片推開
          const ox = m - Math.abs(dx)
          const oy = m - Math.abs(dy)
          if (ox <= oy) {
            const sx = dx === 0 ? (hash01(`${a.ins.id}|${c.ins.id}`) < 0.5 ? -1 : 1) : Math.sign(dx)
            a.x -= (sx * ox) / 2 + sx * 0.1; c.x += (sx * ox) / 2 + sx * 0.1
          } else {
            const sy = dy === 0 ? (hash01(`${c.ins.id}|${a.ins.id}`) < 0.5 ? -1 : 1) : Math.sign(dy)
            a.y -= (sy * oy) / 2 + sy * 0.1; c.y += (sy * oy) / 2 + sy * 0.1
          }
          moved = true
        }
      }
      for (const r of arr) {
        r.x = clamp(r.x, PAD + r.r, W - PAD - r.r)
        if (Math.abs(r.x - cx) < need) r.x = cx + br[k]!.side * need
        r.y = clamp(r.y, PAD + r.r, ground - r.r)
      }
      if (!moved) break
    }
  }
  for (const r of recById.values()) { r.x = A1(r.x); r.y = A1(r.y) }

  // ── 可見的部分與取捨（總覽：每群約 24 片葉，其餘聚成葉叢） ──
  const vis = all.filter(isVisible)
  const visOfCluster = cids.map((c) => vis.filter((i) => i.cluster === c))
  const focusK = opts.focus != null && cidx.has(opts.focus) && visOfCluster[cidx.get(opts.focus)!]!.length > 0 ? cidx.get(opts.focus)! : null
  const activeN = visOfCluster.filter((v) => v.length > 0).length || 1
  const leafCap = clamp(Math.floor((OVERVIEW_ELEMENT_CAP - 6 - activeN * (3 + TWIG_CAP + CLUMP_CAP)) / activeN), 6, 24)
  const keep = new Set<string>()
  const clumpGroups: Array<{ k: number; items: Insight[] }> = []
  for (let k = 0; k < nc; k++) {
    const v = visOfCluster[k]!
    if (v.length === 0) continue
    if (k === focusK || v.length <= leafCap) { for (const i of v) keep.add(i.id); continue }
    const byThread = new Map<string, Insight[]>()
    for (const i of v) { if (!byThread.has(i.thread)) byThread.set(i.thread, []); byThread.get(i.thread)!.push(i) }
    const recent = (i: Insight): boolean => todayN - dayNumber(i.date) <= RECENT_DAYS
    const score = (its: Insight[]): number => (its.some(recent) ? 1e6 : 0) + its.filter((x) => x.relation === 'reinforce').length * 1000 + its.length
    const ths = [...byThread.entries()].sort((a, b) => score(b[1]) - score(a[1]) || (a[0] < b[0] ? -1 : 1)).slice(0, TWIG_CAP)
    const cand = ths.flatMap(([, its]) => its).sort((a, b) => (recent(a) === recent(b) ? (a.date < b.date ? 1 : a.date > b.date ? -1 : a.id < b.id ? -1 : 1) : recent(a) ? -1 : 1))
    for (const i of cand.slice(0, leafCap)) keep.add(i.id)
    const rest = v.filter((i) => !keep.has(i.id))
    if (rest.length > 0) clumpGroups.push({ k, items: rest })
  }
  const clumps: InsightClump[] = []
  for (const g of clumpGroups) {
    const sorted = [...g.items].sort((a, b) => recById.get(a.id)!.bt - recById.get(b.id)!.bt)
    const groups = sorted.length >= 6 ? [sorted.slice(0, Math.ceil(sorted.length / 2)), sorted.slice(Math.ceil(sorted.length / 2))] : [sorted]
    groups.slice(0, CLUMP_CAP).forEach((grp, gi) => {
      const bt = grp.reduce((s, i) => s + recById.get(i.id)!.bt, 0) / grp.length
      const pt = pointOn(g.k, bt)
      const r = (compact ? 10 : 12) + Math.min(5, Math.log2(grp.length))
      let x = pt[0]
      if (Math.abs(x - cx) < clear(r)) x = cx + br[g.k]!.side * clear(r)
      clumps.push({ id: `${cids[g.k]}~clump${gi}`, clusterIndex: g.k, x: A1(x), y: A1(pt[1]), r: A1(r), count: grp.length, bt: A1(bt * 1000) / 1000 })
    })
  }

  // ── 枝條 ──
  const limbs: InsightLimb[] = []
  const leafPath = new Map<string, string[]>()
  const leafAngle = new Map<string, number>()
  const witheredLeaf = new Set<string>()
  const deadSeg = new Set<string>()
  const chunkIds: string[][] = cids.map(() => [])
  const chunkT0: number[][] = cids.map(() => [])
  const CH = 3
  for (let k = 0; k < nc; k++) {
    const v = visOfCluster[k]!
    if (v.length === 0) continue
    const b = br[k]!
    const w0 = clamp(5 + 1.5 * Math.sqrt(itemsOf.get(cids[k]!)!.length), 6, 13)
    const w1 = 2.6
    const firstMonthAt = (t: number): string => {
      const own = v.find((i) => recById.get(i.id)!.bt >= t - 1e-9)
      return (own ?? v[v.length - 1]!).date.slice(0, 7)
    }
    for (let c = 0; c < CH; c++) {
      const t0 = c / CH
      const t1 = (c + 1) / CH
      const pts: P[] = []
      const ws: number[] = []
      for (let s = 0; s <= 8; s++) {
        const t = t0 + ((t1 - t0) * s) / 8
        pts.push(cubicAt(b.p0, b.p1, b.p2, b.p3, t))
        ws.push(w0 + (w1 - w0) * Math.pow(t, 0.85))
      }
      const id = `c:${cids[k]}#${c}`
      chunkIds[k]!.push(id)
      chunkT0[k]!.push(t0)
      const fm = c === 0 ? v[0]!.date.slice(0, 7) : firstMonthAt(t0)
      limbs.push({
        id, d: ribbon(pts, ws), level: 'cluster', width: A1(ws[0]!), widthStart: A1(ws[0]!), widthEnd: A1(ws[ws.length - 1]!), withered: false,
        firstMonth: fm, clusterIndex: k, from: [A1(pts[0]![0]), A1(pts[0]![1])], to: [A1(pts[pts.length - 1]![0]), A1(pts[pts.length - 1]![1])],
      })
    }
  }
  const basePathOf = (k: number, bt: number): string[] => ['trunk', ...chunkIds[k]!.filter((_, c) => chunkT0[k]![c]! <= bt + 1e-9)]

  // 脈絡細枝：從主枝上「脈絡第一則的日期位置」分出，沿主枝並行，葉子由舊到新
  const twigs: InsightTwig[] = []
  const threadsVis = new Map<string, Insight[]>()
  for (const i of vis) {
    if (!keep.has(i.id)) continue
    if (!threadsVis.has(i.thread)) threadsVis.set(i.thread, [])
    threadsVis.get(i.thread)!.push(i)
  }
  for (const [th, items] of threadsVis) {
    const k = cidx.get(ownerCluster.get(th)!)!
    const first = recById.get(items[0]!.id)!
    const fk = first.k
    const kk = fk
    const startPt = geoOf.get(th)!.F
    const detailed = kk === focusK
    { const g = geoOf.get(th)!; twigs.push({ id: th, clusterIndex: kk, fx: A1(g.F[0]), fy: A1(g.F[1]), ex: A1(g.end[0]), ey: A1(g.end[1]), angle: A1(g.angle), length: A1(g.L) }) }
    const shade = (tiOf.get(th) ?? 0) % 3
    const anchors = new Map<string, P>()
    const posOf = (i: Insight): P => { const r = recById.get(i.id)!; return [r.x, r.y] }
    const reinf = items.filter((x) => x.relation === 'reinforce').length
    const wTh = threadWidth(reinf)
    const n = items.length
    const wAt = (j: number): number => wTh * (1 - 0.5 * (j / n))
    const base = basePathOf(kk, geoOf.get(th)!.tf)
    // 每片葉的「出發點」：refine＝parent 葉（同脈絡且在圖上）；其餘＝前一片葉（第一片從主枝出發）
    const start: P[] = []
    const startOf: Array<string | null> = []
    items.forEach((it, j) => {
      const p = it.parent !== null ? byIdAll.get(it.parent) : undefined
      const pOk = p && p.thread === th && keep.has(p.id) && items.some((x) => x.id === p.id)
      if (it.relation === 'refine' && pOk) { start.push(posOf(p)); startOf.push(p.id) }
      else if (j === 0) { start.push(startPt); startOf.push(null) }
      else { start.push(posOf(items[j - 1]!)); startOf.push(items[j - 1]!.id) }
      anchors.set(it.id, posOf(it))
    })
    // 枯萎：overturn 的 parent 葉枯萎；parent 之後到 overturn 的那些葉與枝段也枯萎
    const idx = new Map(items.map((x, j) => [x.id, j]))
    for (let j = 0; j < n; j++) {
      const it = items[j]!
      if (it.relation !== 'overturn' || it.parent === null) continue
      witheredLeaf.add(it.parent)
      const pj = idx.get(it.parent)
      if (pj === undefined || pj >= j) continue
      for (let q = pj; q < j; q++) witheredLeaf.add(items[q]!.id)
      for (let q = pj + 1; q <= j; q++) deadSeg.add(`t:${th}#${q}`)
    }
    const segFor = (j: number): P[] => {
      const a = start[j]!
      const e = posOf(items[j]!)
      const prevA = j === 0 ? a : (startOf[j] !== null && idx.get(startOf[j]!) !== undefined && idx.get(startOf[j]!)! > 0 ? start[idx.get(startOf[j]!)!]! : a)
      const nextA = j + 1 < n ? posOf(items[j + 1]!) : e
      return segPts(prevA, a, e, nextA)
    }
    if (detailed) {
      for (let j = 0; j < n; j++) {
        const it = items[j]!
        const pts = segFor(j)
        const ws = pts.map((_, s) => wAt(j) + (wAt(j + 1) - wAt(j)) * (s / (pts.length - 1)))
        const id = `t:${th}#${j}`
        limbs.push({
          id, d: ribbon(pts, ws), level: 'thread', width: A1(ws[0]!), widthStart: A1(ws[0]!), widthEnd: A1(ws[ws.length - 1]!), withered: deadSeg.has(id),
          firstMonth: it.date.slice(0, 7), clusterIndex: k, shade, from: [A1(pts[0]![0]), A1(pts[0]![1])], to: [A1(pts[pts.length - 1]![0]), A1(pts[pts.length - 1]![1])],
        })
        const parentPath = startOf[j] === null ? base : leafPath.get(startOf[j]!) ?? base
        leafPath.set(it.id, [...parentPath, id])
        const dir: P = [anchors.get(it.id)![0] - start[j]![0], anchors.get(it.id)![1] - start[j]![1]]
        leafAngle.set(it.id, Math.round(angleOf(dir) + (it.relation === 'overturn' ? 38 * ((tiOf.get(th) ?? 0) % 2 === 0 ? 1 : -1) : 0)))
      }
    } else {
      // 總覽：整條細枝一個輪廓
      const pts: P[] = []
      const ws: number[] = []
      for (let j = 0; j < n; j++) {
        const sp = segFor(j)
        for (let s = j === 0 ? 0 : 1; s < sp.length; s++) { pts.push(sp[s]!); ws.push(wAt(j) + (wAt(j + 1) - wAt(j)) * (s / (sp.length - 1))) }
      }
      const id = `t:${th}`
      limbs.push({
        id, d: ribbon(pts, ws), level: 'thread', width: A1(ws[0]!), widthStart: A1(ws[0]!), widthEnd: A1(ws[ws.length - 1]!), withered: false,
        firstMonth: items[0]!.date.slice(0, 7), clusterIndex: k, shade, from: [A1(pts[0]![0]), A1(pts[0]![1])], to: [A1(pts[pts.length - 1]![0]), A1(pts[pts.length - 1]![1])],
      })
      items.forEach((it, j) => {
        leafPath.set(it.id, [...base, id])
        const dir: P = [anchors.get(it.id)![0] - start[j]![0], anchors.get(it.id)![1] - start[j]![1]]
        leafAngle.set(it.id, Math.round(angleOf(dir) + (it.relation === 'overturn' ? 38 * ((tiOf.get(th) ?? 0) % 2 === 0 ? 1 : -1) : 0)))
      })
    }
  }

  // ── 樹幹（高度固定，與主枝數無關） ──
  const trunkTop = yTop + 6 // 樹幹高度固定（與主枝數無關）
  const trunkPts: P[] = []
  const trunkWs: number[] = []
  const bend = (hash01('trunk') - 0.5) * 2 * TRUNK_BEND
  for (let s = 0; s <= 14; s++) {
    const t = s / 14
    trunkPts.push([cx + bend * Math.sin(Math.PI * t), ground + (trunkTop - ground) * t])
    trunkWs.push(trunkW0 * (1 - 0.55 * Math.pow(t, 0.8)))
  }
  const topW = trunkWs[trunkWs.length - 1]!
  for (let c = 1; c <= 3; c++) {
    const f = c / 3
    trunkPts.push([trunkPts[trunkPts.length - 1]![0], trunkTop - (topW / 2) * Math.sin((f * Math.PI) / 2)])
    trunkWs.push(topW * Math.cos((f * Math.PI) / 2) + 0.2)
  }
  const trunk: InsightLimb = {
    id: 'trunk', d: ribbon(trunkPts, trunkWs), level: 'trunk', width: A1(trunkWs[0]!), widthStart: A1(trunkWs[0]!), widthEnd: A1(trunkWs[trunkWs.length - 1]!),
    withered: false, firstMonth: all.length > 0 ? all[0]!.date.slice(0, 7) : null, from: [A1(trunkPts[0]![0]), A1(trunkPts[0]![1])], to: [A1(trunkPts[trunkPts.length - 1]![0]), A1(trunkPts[trunkPts.length - 1]![1])],
  }

  const leaves: InsightLeaf[] = vis.filter((i) => keep.has(i.id)).map((i) => {
    const r = recById.get(i.id)!
    const days = todayN - dayNumber(i.date)
    return {
      id: i.id, x: r.x, y: r.y, r: A1(r.r), clusterIndex: r.k, glow: days <= GLOW_DAYS, withered: witheredLeaf.has(i.id), relation: i.relation,
      angle: leafAngle.get(i.id) ?? 0, shade: r.shade, age: leafAge(days), bt: A1(r.bt * 1000) / 1000, tw: A1(r.tw * 1000) / 1000, path: leafPath.get(i.id) ?? ['trunk'],
    }
  })

  // ── 主題標籤：預設膠囊，放不下（互壓）就縮成色點 ──
  const fs = compact ? 11 : 12.5
  const nameMax = compact ? 6 : 8
  const textW = (t: string): number => [...t].reduce((w, ch) => w + (/[\u0000-ÿ]/.test(ch) ? fs * 0.58 : fs), 0)
  const clusters: InsightClusterOut[] = cids.map((id, k) => {
    const name = nameOf.get(id) ?? id
    const t = name.length > nameMax ? `${name.slice(0, nameMax - 1)}…` : name
    const sc = !compact
    const cnt = visOfCluster[k]!.length
    const lw = 10 + textW(t) + (sc ? textW(String(cnt)) + 8 : 0) + 12
    const lh = fs + 9
    const tip = br[k]!.p3
    return {
      id, name, count: cnt, x: A1(tip[0]), y: A1(tip[1]), ax: A1(br[k]!.p0[0]), ay: A1(br[k]!.p0[1]), side: br[k]!.side, len: A1(Math.hypot(br[k]!.p3[0] - br[k]!.p0[0], br[k]!.p3[1] - br[k]!.p0[1])), firstDate: firstOf.get(id)!.date,
      lx: A1(tip[0]), ly: A1(tip[1]), lw: A1(lw), lh: A1(lh), labelShown: false, text: t, showCount: sc, bbox: { x0: tip[0], y0: tip[1], x1: tip[0], y1: tip[1] }, ticks: [],
    }
  })
  type Rect = { x0: number; y0: number; x1: number; y1: number }
  const placed: Rect[] = []
  const order = clusters.map((_, i) => i).filter((i) => clusters[i]!.count > 0).sort((a, b) => clusters[b]!.count - clusters[a]!.count || a - b)
  for (const i of order) {
    const c = clusters[i]!
    const hw = c.lw / 2
    const hh = c.lh / 2
    const cands: P[] = [[0, -hh - 10], [0, hh + 10]]
    let ok = false
    cands.forEach(([ox, oy], ci) => {
      const x = clamp(c.x + ox, PAD + hw, W - PAD - hw)
      const y = clamp(c.y + oy, hh + 2, H - hh - 2)
      const r = { x0: x - hw, y0: y - hh, x1: x + hw, y1: y + hh }
      if (ci === 0) { c.lx = A1(x); c.ly = A1(y) }
      const onLeaf = leaves.some((l) => Math.hypot(l.x - clamp(l.x, r.x0, r.x1), l.y - clamp(l.y, r.y0, r.y1)) < l.r * 1.1 + 1)
      if (ok) return
      if (onLeaf || placed.some((o) => r.x0 < o.x1 + 3 && r.x1 > o.x0 - 3 && r.y0 < o.y1 + 3 && r.y1 > o.y0 - 3)) return
      placed.push(r)
      c.lx = A1(x); c.ly = A1(y); c.labelShown = true
      ok = true
    })
  }

  // ── 外框與（聚焦時）沿主枝的時間標籤 ──
  const labelOf = (dn: number, byYear: boolean): string => {
    const d = new Date(dn * 86_400_000)
    return byYear ? String(d.getUTCFullYear()) : `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`
  }
  clusters.forEach((c, k) => {
    if (c.count === 0) return
    const bb = { x0: c.x - 8, y0: c.y - 8, x1: c.x + 8, y1: c.y + 8 }
    const grow = (x: number, y: number, m: number): void => { bb.x0 = Math.min(bb.x0, x - m); bb.y0 = Math.min(bb.y0, y - m); bb.x1 = Math.max(bb.x1, x + m); bb.y1 = Math.max(bb.y1, y + m) }
    for (let s = 0; s <= 8; s++) { const p = pointOn(k, s / 8); grow(p[0], p[1], 8) }
    for (const i of itemsOf.get(c.id)!) { const r = recById.get(i.id)!; grow(r.x, r.y, r.r * 1.6) }
    bb.x0 = Math.min(bb.x0, c.lx - c.lw / 2); bb.x1 = Math.max(bb.x1, c.lx + c.lw / 2); bb.y0 = Math.min(bb.y0, c.ly - c.lh / 2); bb.y1 = Math.max(bb.y1, c.ly + c.lh / 2)
    if (k === focusK) {
      const its = itemsOf.get(c.id)!
      const d0 = dayNumber(its[0]!.date)
      const d1 = dayNumber(its[its.length - 1]!.date)
      const byYear = d1 - d0 >= 365
      const marks: Array<{ dn: number; label: string }> = [{ dn: d0, label: labelOf(d0, byYear) }]
      const e = new Date(d0 * 86_400_000)
      let y = e.getUTCFullYear()
      let m = byYear ? 0 : e.getUTCMonth() + 1
      for (let g = 0; g < 400; g++) {
        if (byYear) { y++; m = 0 } else { m++; if (m > 11) { m = 0; y++ } }
        const dn = Date.UTC(y, m, 1) / 86_400_000
        if (dn > d1) break
        marks.push({ dn, label: labelOf(dn, byYear) })
      }
      const dnTick = marks.length > 24 ? marks.filter((_, q) => q % Math.ceil(marks.length / 24) === 0) : marks
      c.ticks = dnTick.map((mk) => {
        const t = tOfDay(k, mk.dn)
        const p = pointOn(k, t)
        const un = upNormal(k, t)
        const off = 0 // 年份標在主枝上（白色描邊讓字清楚），不壓到兩側的細枝與葉
        const x = clamp(p[0] + un[0] * off, PAD + 16, W - PAD - 16)
        const yy = clamp(p[1] + un[1] * off, PAD + 8, ground - 4)
        grow(x, yy, 14)
        return { label: mk.label, t: A1(t * 1000) / 1000, x: A1(x), y: A1(yy) }
      })
    }
    c.bbox = { x0: A1(bb.x0), y0: A1(bb.y0), x1: A1(bb.x1), y1: A1(bb.y1) }
  })

  const elementCount = 1 + limbs.length + leaves.length + clumps.length
  return { width: W, height: H, compact, trunk, limbs, leaves, clumps, twigs, clusters, elementCount, axis: { x: cx, ground, top: yTop, bottom: yBottom, trunkTop: A1(trunkTop), cx } }
}

/** 群標籤顯示文字（太長截短） */
export function clusterLabelText(name: string, max = 8): string {
  return name.length > max ? `${name.slice(0, max - 1)}…` : name
}

/** 聚焦某一群時的 viewBox：包住那一群的主枝、葉子與標籤，維持畫布長寬比，不超出畫布；null＝全樹 */
export function focusViewBox(layout: Pick<InsightTreeLayout, 'width' | 'height' | 'clusters'>, clusterIndex: number | null): { x: number; y: number; w: number; h: number } {
  const W = layout.width
  const H = layout.height
  const c = clusterIndex === null ? undefined : layout.clusters[clusterIndex]
  if (!c || c.count === 0) return { x: 0, y: 0, w: W, h: H }
  const m = 16
  const bw = c.bbox.x1 - c.bbox.x0 + 2 * m
  const bh = c.bbox.y1 - c.bbox.y0 + 2 * m
  const aspect = W / H
  let w = Math.max(bw, bh * aspect, W * 0.5)
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
