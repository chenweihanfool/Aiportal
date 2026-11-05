// 知識頁（#knowledge，2026-11-05）的純函式：解析 feed `topics`（schemaVersion 1）、分組、篩選、關係圖座標。
// 資料由 kb-pipeline 每週推送（契約見 docs/feed-api.md 與 api-server 的 feeds/registry.ts）；這裡不碰網路。
// 元件在 KnowledgeView.tsx，樣式在 portal.css 的 kn-*。

export type TopicKind = 'concept' | 'method'

export interface TopicGrowth { date: string; text: string }
export interface TopicSource { id: string; title: string }
export interface TopicRelated { id: string; name: string; sharedDocs: number; sharedCases: number }

export interface Topic {
  id: string
  name: string
  kind: TopicKind
  why: string
  firstSeen: string
  lastSeen: string | null
  /** 最近一次 publish 的日期；沒發布過為 null */
  updated: string | null
  /** 0＝還沒有頁面 */
  revision: number
  docs: number
  newDocs: number
  monthsSpan: number
  firstMonth: string | null
  lastMonth: string | null
  /** 頁面四節的 markdown；沒發布過為 null */
  body: string | null
  growth: TopicGrowth[]
  sources: TopicSource[]
  related: TopicRelated[]
}

export interface TopicsData {
  computedAt: string
  total: number
  published: number
  topics: Topic[]
}

/** 超過這麼久沒更新就標「資料已過期」（推送是每週，但 HERMES 可能晚推；超過一小時就提醒） */
export const STALE_MIN = 60

const DAY_MS = 86_400_000
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/
const MONTH_RE = /^\d{4}-\d{2}$/

const isStr = (v: unknown): v is string => typeof v === 'string'
const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v)
const strOrNull = (v: unknown, re?: RegExp): string | null => (isStr(v) && (!re || re.test(v)) ? v : null)

/** 單題解析；欄位壞掉回 null，呼叫端略過這一題（不讓整頁掛掉） */
function parseTopic(raw: unknown): Topic | null {
  if (!raw || typeof raw !== 'object') return null
  const t = raw as Record<string, unknown>
  if (!isStr(t.id) || !t.id || !isStr(t.name) || !t.name) return null
  if (t.kind !== 'concept' && t.kind !== 'method') return null
  if (!isStr(t.firstSeen) || !DATE_RE.test(t.firstSeen)) return null
  if (!isNum(t.revision) || !isNum(t.docs) || !isNum(t.newDocs) || !isNum(t.monthsSpan)) return null
  const growth: TopicGrowth[] = Array.isArray(t.growth)
    ? t.growth.filter((g): g is TopicGrowth => !!g && isStr((g as TopicGrowth).date) && isStr((g as TopicGrowth).text))
    : []
  const sources: TopicSource[] = Array.isArray(t.sources)
    ? t.sources.filter((s): s is TopicSource => !!s && isStr((s as TopicSource).id) && isStr((s as TopicSource).title))
    : []
  const related: TopicRelated[] = Array.isArray(t.related)
    ? t.related
        .filter((r): r is { id: string; name: string; sharedDocs?: number; sharedCases?: number } => !!r && isStr((r as { id?: unknown }).id) && isStr((r as { name?: unknown }).name))
        .map((r) => ({ id: r.id, name: r.name, sharedDocs: isNum(r.sharedDocs) ? r.sharedDocs : 0, sharedCases: isNum(r.sharedCases) ? r.sharedCases : 0 }))
    : []
  return {
    id: t.id,
    name: t.name,
    kind: t.kind,
    why: isStr(t.why) ? t.why : '',
    firstSeen: t.firstSeen,
    lastSeen: strOrNull(t.lastSeen, DATE_RE),
    updated: strOrNull(t.updated, DATE_RE),
    revision: t.revision,
    docs: t.docs,
    newDocs: t.newDocs,
    monthsSpan: t.monthsSpan,
    firstMonth: strOrNull(t.firstMonth, MONTH_RE),
    lastMonth: strOrNull(t.lastMonth, MONTH_RE),
    body: isStr(t.body) ? t.body : null,
    growth,
    sources,
    related,
  }
}

/** 同 archStats 的寫法：available 不是 true、或 payload 形狀不對回 null */
export function parseTopics(raw: unknown): TopicsData | null {
  const root = (raw as { available?: boolean; payload?: unknown } | null) ?? null
  if (!root || root.available !== true) return null
  const p = root.payload as { computedAt?: unknown; total?: unknown; published?: unknown; topics?: unknown } | null
  if (!p || !isStr(p.computedAt) || !Array.isArray(p.topics)) return null
  const topics = p.topics.map(parseTopic).filter((t): t is Topic => t !== null)
  return {
    computedAt: p.computedAt,
    total: isNum(p.total) ? p.total : topics.length,
    published: isNum(p.published) ? p.published : topics.filter((t) => t.revision > 0).length,
    topics,
  }
}

export function isStale(computedAt: string, now: Date): boolean {
  const t = Date.parse(computedAt)
  if (!Number.isFinite(t)) return true
  return (now.getTime() - t) / 60_000 > STALE_MIN
}

/** 台北日曆日 YYYY-MM-DD */
function taipeiDay(now: Date): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Taipei' }).format(now)
}

/** 兩個 YYYY-MM-DD 的日數差（a − b），純日曆計算，不受時區影響 */
function dayDiff(a: string, b: string): number {
  return Math.round((Date.parse(`${a}T00:00:00Z`) - Date.parse(`${b}T00:00:00Z`)) / DAY_MS)
}

export interface TopicGroups {
  /** 本週長大：updated 在 7 天內（含第 7 天） */
  recent: Topic[]
  /** 已有頁面：其餘 revision > 0 */
  page: Topic[]
  /** 還在累積：revision 0 */
  growing: Topic[]
}

/** 分組；組內維持輸入（契約）的順序 */
export function groupTopics(topics: readonly Topic[], now: Date): TopicGroups {
  const today = taipeiDay(now)
  const groups: TopicGroups = { recent: [], page: [], growing: [] }
  for (const t of topics) {
    if (t.updated && dayDiff(t.updated, today) >= -7) groups.recent.push(t)
    else if (t.revision > 0) groups.page.push(t)
    else groups.growing.push(t)
  }
  return groups
}

export interface TopicFilter {
  kind?: TopicKind | 'all'
  q?: string
}

export function filterTopics(topics: readonly Topic[], f: TopicFilter): Topic[] {
  const q = (f.q ?? '').trim().toLowerCase()
  return topics.filter((t) => {
    if (f.kind && f.kind !== 'all' && t.kind !== f.kind) return false
    if (!q) return true
    return t.name.toLowerCase().includes(q) || t.why.toLowerCase().includes(q)
  })
}

export function kindLabel(kind: TopicKind): string {
  return kind === 'concept' ? '概念' : '方法'
}

export interface GraphNode { id: string; name: string; x: number; y: number; r: number }
export interface GraphEdge { a: string; b: string; w: number }
export interface TopicGraph { nodes: GraphNode[]; edges: GraphEdge[] }

/**
 * 題目關係圖的座標。節點＝有關係或被指到的題目；邊＝related（無向、去重，權重＝sharedDocs＋0.5×sharedCases，
 * 兩邊都有寫時取較大者）。確定性的圓形排列：依 id 排序後等角度，從正上方開始順時針。
 * 指到不在清單裡的題目就略過那條邊。沒有任何邊時回空。
 */
export function layoutGraph(topics: readonly Topic[], width: number, height: number): TopicGraph {
  const byId = new Map(topics.map((t) => [t.id, t]))
  const weights = new Map<string, GraphEdge>()
  for (const t of topics) {
    for (const r of t.related) {
      if (r.id === t.id || !byId.has(r.id)) continue
      const [a, b] = t.id < r.id ? [t.id, r.id] : [r.id, t.id]
      const w = r.sharedDocs + 0.5 * r.sharedCases
      const key = `${a}\u0000${b}`
      const prev = weights.get(key)
      if (!prev || w > prev.w) weights.set(key, { a, b, w })
    }
  }
  if (weights.size === 0) return { nodes: [], edges: [] }

  const edges = [...weights.values()].sort((x, y) => (x.a === y.a ? (x.b < y.b ? -1 : x.b > y.b ? 1 : 0) : x.a < y.a ? -1 : 1))
  const ids = [...new Set(edges.flatMap((e) => [e.a, e.b]))].sort()
  const cx = width / 2
  const cy = height / 2
  const ring = Math.max(0, Math.min(width, height) / 2 - 22)
  const nodes: GraphNode[] = ids.map((id, i) => {
    const t = byId.get(id)!
    const angle = -Math.PI / 2 + (2 * Math.PI * i) / ids.length
    const r = Math.min(18, Math.max(6, 6 + t.docs * 0.5))
    return {
      id,
      name: t.name,
      x: ids.length === 1 ? cx : cx + ring * Math.cos(angle),
      y: ids.length === 1 ? cy : cy + ring * Math.sin(angle),
      r,
    }
  })
  return { nodes, edges }
}
