// 心得資料模型與純函式：寬容解析 /api/insights、日期與統計。
// 不碰 DOM、不用 Math.random，同一輸入永遠得到同一輸出。網路在 insightApi.ts，畫面的島嶼在 InsightIslands.tsx。
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
  links: InsightLinks
}
export interface InsightPersonLink { id: string; name: string; dossier: string | null; sameSegment: boolean }
export interface InsightIdeaLink { id: string; title: string; mentioned: boolean }
export interface InsightTopicLink { id: string; name: string }
/** 心得相關的人、想法、知識主題（3.1.1 起後端提供；舊回應沒有就是三個空陣列） */
export interface InsightLinks { people: InsightPersonLink[]; ideas: InsightIdeaLink[]; topics: InsightTopicLink[] }
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
  links: InsightLinks
  day: { headings: string[] }
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
const RELATIONS: readonly string[] = ['new', 'reinforce', 'refine', 'overturn']
const PROVENANCES: readonly string[] = ['quote', 'relay', 'tag']

const isRelation = (v: unknown): v is InsightRelation => typeof v === 'string' && RELATIONS.includes(v)
const isProvenance = (v: unknown): v is InsightProvenance => typeof v === 'string' && PROVENANCES.includes(v)

/** 寬容解析 links：不是物件或缺鍵 → 空陣列，壞的單筆略過 */
export function parseInsightLinks(raw: unknown): InsightLinks {
  const out: InsightLinks = { people: [], ideas: [], topics: [] }
  if (!isRec(raw)) return out
  if (Array.isArray(raw.people)) {
    for (const p of raw.people) {
      if (!isRec(p)) continue
      const id = nonEmpty(p.id)
      const name = nonEmpty(p.name)
      if (id === null || name === null || out.people.some((x) => x.id === id)) continue
      out.people.push({ id, name, dossier: nonEmpty(p.dossier), sameSegment: p.sameSegment === true })
    }
  }
  if (Array.isArray(raw.ideas)) {
    for (const it of raw.ideas) {
      if (!isRec(it)) continue
      const id = nonEmpty(it.id)
      const title = nonEmpty(it.title)
      if (id === null || title === null || out.ideas.some((x) => x.id === id)) continue
      out.ideas.push({ id, title, mentioned: it.mentioned === true })
    }
  }
  if (Array.isArray(raw.topics)) {
    for (const t of raw.topics) {
      if (!isRec(t)) continue
      const id = nonEmpty(t.id)
      const name = nonEmpty(t.name)
      if (id === null || name === null || out.topics.some((x) => x.id === id)) continue
      out.topics.push({ id, name })
    }
  }
  return out
}

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
    links: parseInsightLinks(raw.links),
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

function parseDayHeadings(raw: unknown): string[] {
  if (!isRec(raw) || !Array.isArray(raw.headings)) return []
  return raw.headings.filter((h): h is string => typeof h === 'string' && h.trim() !== '').slice(0, 8)
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
    cluster: { id: cid, name: str(raw.cluster.name) ?? cid }, thread: base.thread, relation: base.relation, parent: base.parent, links: base.links,
    source: str(raw.source) ?? '', day: { headings: parseDayHeadings(raw.day) }, threadItems: items,
  }
}

// ─────────────────────────────────────────────
// 日期
// ─────────────────────────────────────────────

/** 台北今天 YYYY-MM-DD */
export function taipeiDay(now: Date): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Taipei', year: 'numeric', month: '2-digit', day: '2-digit' }).format(now)
}

/** 近 30 天（含今天、含第 30 天前；未來日期當作剛長出來）內的心得會發光 */
export const GLOW_DAYS = 30

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
