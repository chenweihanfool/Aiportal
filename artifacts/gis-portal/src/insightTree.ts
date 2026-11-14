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

export interface InsightStats { total: number; thisMonth: number; topCluster: { name: string; count: number } | null }

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
  return { total: Math.max(data.total, data.insights.length), thisMonth, topCluster }
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
// 排版
// ─────────────────────────────────────────────

export type InsightLimbLevel = 'trunk' | 'cluster' | 'thread'

export interface InsightLimb {
  id: string
  /** SVG path（座標已落在 [0,width]×[0,height] 內） */
  d: string
  level: InsightLimbLevel
  width: number
  withered: boolean
  /** 這段底下最早的心得月份 YYYY-MM；樹幹是整棵樹最早的月份，沒有心得時為 null */
  firstMonth: string | null
  /** 所屬群在 layout.clusters 的序號（樹幹沒有） */
  clusterIndex?: number
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
}
export interface InsightClusterOut {
  id: string
  name: string
  /** upto 之內的心得數 */
  count: number
  /** 主枝末端 */
  x: number
  y: number
  /** 標籤錨點（水平置中、文字底線）；已夾在畫布內 */
  lx: number
  ly: number
  labelShown: boolean
}
export interface InsightTreeLayout {
  width: number
  height: number
  trunk: InsightLimb
  limbs: InsightLimb[]
  leaves: InsightLeaf[]
  /** 與資料的群同序（全部都在；upto 內沒有心得的群 count＝0、不畫枝、不顯示標籤） */
  clusters: InsightClusterOut[]
}
export interface InsightTreeOptions {
  width: number
  height: number
  now: Date
  /** YYYY-MM：重播用，只輸出 date 在該月底以前的枝葉 */
  upto?: string
  /** 群標籤字級（viewBox 單位），預設 13 */
  labelFontSize?: number
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

const rad = (deg: number): number => (deg * Math.PI) / 180
/** 從 p 出發，與垂直線夾 deg 度（正＝向右）、長 len 的點；y 往上為負 */
const pol = (p: P, deg: number, len: number): P => [p[0] + Math.sin(rad(deg)) * len, p[1] - Math.cos(rad(deg)) * len]
const num = (n: number): string => String(Math.round(n * 10) / 10)
const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v))

/** 印證次數 → 枝寬：1.5 + 1.2 × 次數，上限 8 */
export function threadWidth(reinforceCount: number): number {
  return Math.min(8, 1.5 + 1.2 * Math.max(0, reinforceCount))
}

const LEAF_R: Record<InsightRelation, number> = { new: 5, reinforce: 5.5, refine: 6, overturn: 6.5 }

interface Seg { id: string; a: P; c: P; b: P; width: number; withered: boolean; firstMonth: string | null; clusterIndex: number; level: InsightLimbLevel }

/** 二次貝茲曲線的點 */
const bez = (p0: P, p1: P, p2: P, t: number): P => [
  (1 - t) * (1 - t) * p0[0] + 2 * (1 - t) * t * p1[0] + t * t * p2[0],
  (1 - t) * (1 - t) * p0[1] + 2 * (1 - t) * t * p1[1] + t * t * p2[1],
]
/** 二次貝茲在 [a,b] 區間的子曲線 */
function sub(p0: P, p1: P, p2: P, a: number, b: number): { a: P; c: P; b: P } {
  const k0 = (1 - a) * (1 - b)
  const k1 = a + b - 2 * a * b
  const k2 = a * b
  return { a: bez(p0, p1, p2, a), c: [k0 * p0[0] + k1 * p1[0] + k2 * p2[0], k0 * p0[1] + k1 * p1[1] + k2 * p2[1]], b: bez(p0, p1, p2, b) }
}
/** 兩點之間一段微彎的曲線控制點 */
function ctrlOf(a: P, b: P, bend: number): P {
  const dx = b[0] - a[0]
  const dy = b[1] - a[1]
  const len = Math.hypot(dx, dy) || 1
  return [(a[0] + b[0]) / 2 - (dy / len) * bend, (a[1] + b[1]) / 2 + (dx / len) * bend]
}

interface Branch { id: string; thread: string; items: Insight[]; forkFrom: string | null; width: number }

/**
 * 排版。座標系：樹幹頂端為原點、y 往上為負；最後依畫布大小平移與縮小（只縮不放），保證所有座標落在 [0,width]×[0,height]。
 * 群＝主枝（扇形角度依心得數分配，多的居中）；脈絡＝從主枝上依第一則日期（越晚越靠枝梢）長出的枝；
 * refine 從 parent 葉的位置分岔出新枝；overturn 讓 parent 到被推翻點的那段枝與 parent 葉枯萎（withered）。
 */
export function layoutInsightTree(data: InsightData, opts: InsightTreeOptions): InsightTreeLayout {
  const W = Math.max(120, opts.width)
  const H = Math.max(120, opts.height)
  const fs = opts.labelFontSize ?? 13
  const PAD = 14
  const LABEL_ROOM = fs + 12
  const today = taipeiDay(opts.now)
  const todayN = dayNumber(today)
  const upto = opts.upto !== undefined && MONTH_RE.test(opts.upto) ? opts.upto : null

  const all = [...data.insights].sort(cmpInsight)
  const visible = upto === null ? all : all.filter((i) => i.date.slice(0, 7) <= upto)
  const byId = new Map(visible.map((i) => [i.id, i]))

  // 群清單：資料給的（照原順序）＋心得裡出現但資料沒列的；整份資料裡沒有任何心得的群不畫
  const fullCount = new Map<string, number>()
  for (const i of all) fullCount.set(i.cluster, (fullCount.get(i.cluster) ?? 0) + 1)
  const clusterDefs: Array<{ id: string; name: string }> = []
  for (const c of data.clusters) if ((fullCount.get(c.id) ?? 0) > 0 && !clusterDefs.some((x) => x.id === c.id)) clusterDefs.push({ id: c.id, name: c.name })
  for (const id of fullCount.keys()) if (!clusterDefs.some((x) => x.id === id)) clusterDefs.push({ id, name: id })
  const nc = clusterDefs.length
  const cidx = new Map(clusterDefs.map((c, i) => [c.id, i]))
  const visCount = clusterDefs.map((c) => visible.filter((i) => i.cluster === c.id).length)
  const maxFull = Math.max(1, ...clusterDefs.map((c) => fullCount.get(c.id) ?? 0))

  // ── 主枝角度：全部資料的心得數決定份額（不隨 upto 變，重播時枝不會亂跳）；多的居中 ──
  const spread = nc === 0 ? 0 : Math.min(150, 46 + 24 * (nc - 1))
  const avg = nc === 0 ? 0 : all.length / nc
  const weight = (i: number): number => (fullCount.get(clusterDefs[i]!.id) ?? 0) + avg * 0.3
  const sortedIdx = clusterDefs.map((_, i) => i).sort((a, b) => weight(b) - weight(a) || a - b)
  const ordered: number[] = []
  sortedIdx.forEach((ci, k) => { if (k % 2 === 0) ordered.push(ci); else ordered.unshift(ci) })
  // ordered 現在是「左→右」，最大的在中間偏右；再把中心對齊
  const wsum = ordered.reduce((s, ci) => s + weight(ci), 0) || 1
  const centerDeg: number[] = new Array<number>(nc).fill(0)
  let cur = -spread / 2
  for (const ci of ordered) {
    const w = (spread * weight(ci)) / wsum
    centerDeg[ci] = cur + w / 2
    cur += w
  }

  const TRUNK_LEN = H * 0.2
  const origin: P = [0, 0]
  const segs: Seg[] = []
  const pos = new Map<string, P>()
  const witheredLeaf = new Set<string>()
  const clusterTip: Array<P | null> = new Array<P | null>(nc).fill(null)
  const clusterFirst: Array<string | null> = new Array<string | null>(nc).fill(null)

  for (let ci = 0; ci < nc; ci++) {
    const cdef = clusterDefs[ci]!
    const mine = visible.filter((i) => i.cluster === cdef.id)
    if (mine.length === 0) continue
    clusterFirst[ci] = mine[0]!.date.slice(0, 7)
    const theta = centerDeg[ci]!
    const lc = H * (0.2 + 0.2 * Math.sqrt(mine.length / maxFull))
    const tip = pol(origin, theta, lc)
    clusterTip[ci] = tip
    const cbend = (hash01(`cb:${cdef.id}`) - 0.5) * 0.18 * lc
    const cc = ctrlOf(origin, tip, cbend)
    segs.push({
      id: `c:${cdef.id}`, a: origin, c: cc, b: tip, width: clamp(4 + 1.6 * Math.sqrt(mine.length), 4, 10), withered: false,
      firstMonth: clusterFirst[ci]!, clusterIndex: ci, level: 'cluster',
    })

    // 脈絡：群裡依第一則日期排序；第一則所在群＝這條脈絡的群
    const threadsOrder: string[] = []
    const threadItems = new Map<string, Insight[]>()
    const owner = new Map<string, string>()
    for (const i of visible) if (!owner.has(i.thread)) owner.set(i.thread, i.cluster)
    for (const i of visible) {
      if (owner.get(i.thread) !== cdef.id) continue
      if (!threadItems.has(i.thread)) { threadItems.set(i.thread, []); threadsOrder.push(i.thread) }
      threadItems.get(i.thread)!.push(i)
    }
    // 群內的日期範圍（用全部資料，重播時脈絡長出的位置才穩定）
    const allMine = all.filter((i) => i.cluster === cdef.id)
    const dMin = dayNumber(allMine[0]!.date)
    const dMax = dayNumber(allMine[allMine.length - 1]!.date)

    threadsOrder.forEach((th, ti) => {
      const items = threadItems.get(th)!
      const first = items[0]!
      const u = dMax > dMin ? (dayNumber(first.date) - dMin) / (dMax - dMin) : 0.5
      const s = 0.28 + 0.72 * u
      const attach = bez(origin, cc, tip, s)
      // 脈絡分成主枝與分岔：refine 從 parent 長出新枝，其餘跟著 parent 所在的枝
      const branches: Branch[] = []
      const branchOf = new Map<string, Branch>()
      const reinforceAll = items.filter((x) => x.relation === 'reinforce').length
      const main: Branch = { id: th, thread: th, items: [], forkFrom: null, width: threadWidth(reinforceAll) }
      branches.push(main)
      for (const it of items) {
        const p = it.parent !== null ? byId.get(it.parent) : undefined
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

      const dirOf = new Map<string, number>()
      const side0 = hash01(`side:${th}`) < 0.5 ? -1 : 1
      const mainSide = ti % 2 === 0 ? side0 : -side0
      let forkN = 0
      for (const b of branches) {
        if (b.items.length === 0) continue
        const n = b.items.length
        let start: P
        let dir: number
        let len: number
        if (b.forkFrom === null) {
          start = attach
          dir = theta + mainSide * (30 + 24 * hash01(`dir:${th}`))
          len = clamp(Math.max(15 * n + 8, H * 0.1), 0, H * 0.3)
        } else {
          start = pos.get(b.forkFrom) ?? attach
          const parentBranch = branchOf.get(b.forkFrom)
          const pdir = parentBranch ? (dirOf.get(parentBranch.id) ?? theta) : theta
          forkN++
          const fs2 = (forkN % 2 === 0 ? 1 : -1) * mainSide
          dir = pdir + fs2 * (34 + 16 * hash01(`fk:${b.id}`))
          len = clamp(Math.max(15 * n + 8, H * 0.08), 0, H * 0.24)
        }
        dirOf.set(b.id, dir)
        const end = pol(start, dir, len)
        const bc = ctrlOf(start, end, (hash01(`bb:${b.id}`) - 0.5) * 0.3 * len)
        // 枯萎：overturn 的 parent 與它同一枝時，parent 之後到 overturn 的那段枝與中間的葉都枯萎
        const idxOf = new Map(b.items.map((x, k) => [x.id, k]))
        const dead = new Set<number>()
        const deadSeg = new Set<number>()
        for (let k = 0; k < n; k++) {
          const it = b.items[k]!
          if (it.relation !== 'overturn' || it.parent === null) continue
          witheredLeaf.add(it.parent)
          const pk = idxOf.get(it.parent)
          if (pk === undefined || pk >= k) continue
          for (let j = pk; j < k; j++) dead.add(j)
          for (let j = pk + 1; j <= k; j++) deadSeg.add(j)
        }
        for (const j of dead) witheredLeaf.add(b.items[j]!.id)
        // 逐段輸出：段 j 從上一個葉（或枝的起點）到第 j 個葉
        let t0 = 0
        for (let j = 0; j < n; j++) {
          const t1 = (j + 1) / n
          const sg = sub(start, bc, end, t0, t1)
          const it = b.items[j]!
          segs.push({
            id: `t:${b.id}#${j}`, a: sg.a, c: sg.c, b: sg.b, width: b.width, withered: deadSeg.has(j), firstMonth: it.date.slice(0, 7),
            clusterIndex: ci, level: 'thread',
          })
          pos.set(it.id, sg.b)
          t0 = t1
        }
      }
    })
  }

  // ── 邊界 → 平移與縮小（樹幹置中、底部貼齊；只縮不放）──
  const trunkBase: P = [0, TRUNK_LEN]
  let minY = 0
  let maxY = TRUNK_LEN
  let halfX = 0
  const grow = (p: P, r = 0): void => {
    if (p[1] - r < minY) minY = p[1] - r
    if (p[1] + r > maxY) maxY = p[1] + r
    halfX = Math.max(halfX, Math.abs(p[0]) + r)
  }
  for (const sg of segs) { grow(sg.a); grow(sg.c); grow(sg.b) }
  for (const i of visible) { const p = pos.get(i.id); if (p) grow(p, LEAF_R[i.relation]) }
  const availW = W / 2 - PAD
  const availH = H - 2 * PAD - LABEL_ROOM
  const sx = halfX > availW ? availW / halfX : 1
  const sy = maxY - minY > availH ? availH / (maxY - minY) : 1
  const baseY = H - PAD
  const T = (p: P): P => [W / 2 + p[0] * sx, baseY - (maxY - p[1]) * sy]
  // 樹幹底到樹幹頂（原點）依 sy 縮放；原點的 y＝baseY-(maxY-0)*sy
  const path = (a: P, c: P, b: P): string => {
    const A = T(a), C = T(c), B = T(b)
    return `M${num(A[0])},${num(A[1])} Q${num(C[0])},${num(C[1])} ${num(B[0])},${num(B[1])}`
  }
  const firstMonthAll = visible.length > 0 ? visible[0]!.date.slice(0, 7) : null
  const trunk: InsightLimb = {
    id: 'trunk', d: path(trunkBase, ctrlOf(trunkBase, origin, 6), origin), level: 'trunk', width: 12, withered: false, firstMonth: firstMonthAll,
  }
  const limbs: InsightLimb[] = segs.map((sg) => ({
    id: sg.id, d: path(sg.a, sg.c, sg.b), level: sg.level, width: sg.width, withered: sg.withered, firstMonth: sg.firstMonth, clusterIndex: sg.clusterIndex,
  }))
  const leaves: InsightLeaf[] = []
  for (const i of visible) {
    const p = pos.get(i.id)
    if (!p) continue
    const q = T(p)
    const diff = todayN - dayNumber(i.date)
    leaves.push({
      id: i.id, x: Math.round(q[0] * 10) / 10, y: Math.round(q[1] * 10) / 10, r: LEAF_R[i.relation], clusterIndex: cidx.get(i.cluster) ?? 0,
      glow: diff <= GLOW_DAYS, withered: witheredLeaf.has(i.id), relation: i.relation,
    })
  }

  // ── 群標籤：心得多的先放，與已放的重疊就不放；位置夾在畫布內 ──
  const labelText = (name: string): string => (name.length > 8 ? `${name.slice(0, 7)}…` : name)
  const labelW = (name: string): number => [...labelText(name)].reduce((w, ch) => w + (/[\u0000-ÿ]/.test(ch) ? fs * 0.6 : fs), 0) + 8
  interface Rect { x0: number; y0: number; x1: number; y1: number }
  const clusters: InsightClusterOut[] = clusterDefs.map((c, ci) => {
    const tip = clusterTip[ci]
    const q = tip ? T(tip) : T(origin)
    const w = labelW(c.name)
    const lx = clamp(q[0], w / 2 + 2, W - w / 2 - 2)
    const ly = Math.max(2 + fs, q[1] - 10)
    return { id: c.id, name: c.name, count: visCount[ci]!, x: Math.round(q[0] * 10) / 10, y: Math.round(q[1] * 10) / 10, lx: Math.round(lx * 10) / 10, ly: Math.round(ly * 10) / 10, labelShown: false }
  })
  const placed: Rect[] = []
  const byCount = clusters.map((_, i) => i).filter((i) => clusters[i]!.count > 0).sort((a, b) => clusters[b]!.count - clusters[a]!.count || a - b)
  for (const i of byCount) {
    const c = clusters[i]!
    const w = labelW(c.name)
    const r: Rect = { x0: c.lx - w / 2, x1: c.lx + w / 2, y0: c.ly - fs, y1: c.ly + 3 }
    if (!placed.some((o) => r.x0 < o.x1 + 4 && r.x1 > o.x0 - 4 && r.y0 < o.y1 + 2 && r.y1 > o.y0 - 2)) {
      placed.push(r)
      c.labelShown = true
    }
  }
  return { width: W, height: H, trunk, limbs, leaves, clusters }
}

/** 群標籤顯示文字（太長截短），元件與排版用同一套 */
export function clusterLabelText(name: string): string {
  return name.length > 8 ? `${name.slice(0, 7)}…` : name
}
