// 知識頁（#knowledge，2026-11-05；2.75.0 改成知識樹）的純函式：解析 feed `topics`（schemaVersion 1）、分組、篩選、建樹、頁面解析、樹狀圖座標。
// 資料由 kb-pipeline 每週推送（契約見 docs/feed-api.md 與 api-server 的 feeds/registry.ts）；這裡不碰網路。
// 元件在 KnowledgeView.tsx，樣式在 portal.css 的 kn-*。

export type TopicKind = 'concept' | 'method'

export interface TopicGrowth { date: string; text: string }
export type SourceType = 'pdf' | 'word' | 'excel' | 'image' | 'text' | 'diary' | 'note' | 'event' | 'other'
const SOURCE_TYPES: readonly string[] = ['pdf', 'word', 'excel', 'image', 'text', 'diary', 'note', 'event', 'other']
/** type／case／date 是 2.77.0 起 feed 才有的選填欄位；舊 payload 或不合法的值＝undefined */
export interface TopicSource { id: string; title: string; month: string | null; type?: SourceType; case?: string; date?: string }
export interface MonthCount { month: string; count: number }
export interface FeedTree { domains: Array<{ id: string; name: string; branches: Array<{ id: string; name: string; topics: string[] }> }> }
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
  /** 所屬枝 id；沒有為 null */
  branch: string | null
  /** [領域名, 枝名]；沒有為 [] */
  path: string[]
  monthCounts: MonthCount[]
}

export interface TopicsData {
  computedAt: string
  total: number
  published: number
  topics: Topic[]
  /** 知識樹；推送端還沒更新時為 null */
  tree: FeedTree | null
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
    ? t.sources
        .filter((s): s is { id: string; title: string; month?: unknown; type?: unknown; case?: unknown; date?: unknown } => !!s && isStr((s as TopicSource).id) && isStr((s as TopicSource).title))
        .map((s): TopicSource => {
          const out: TopicSource = { id: s.id, title: s.title, month: strOrNull(s.month, MONTH_RE) }
          if (isStr(s.type) && SOURCE_TYPES.includes(s.type)) out.type = s.type as SourceType
          if (isStr(s.case) && s.case.trim() && s.case.length <= 60) out.case = s.case
          const d = strOrNull(s.date, DATE_RE)
          if (d) out.date = d
          return out
        })
    : []
  const path: string[] = Array.isArray(t.path) ? t.path.filter(isStr).slice(0, 2) : []
  const monthCounts: MonthCount[] = Array.isArray(t.monthCounts)
    ? t.monthCounts
        .filter((m): m is MonthCount => !!m && isStr((m as MonthCount).month) && MONTH_RE.test((m as MonthCount).month) && isNum((m as MonthCount).count) && (m as MonthCount).count >= 0)
        .map((m) => ({ month: m.month, count: m.count }))
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
    branch: isStr(t.branch) && t.branch ? t.branch : null,
    path,
    monthCounts,
  }
}

function parseTree(raw: unknown): FeedTree | null {
  const r = raw as { domains?: unknown } | null
  if (!r || typeof r !== 'object' || !Array.isArray(r.domains)) return null
  const domains: FeedTree['domains'] = []
  for (const d of r.domains) {
    const dd = d as { id?: unknown; name?: unknown; branches?: unknown } | null
    if (!dd || !isStr(dd.id) || !isStr(dd.name) || !Array.isArray(dd.branches)) continue
    const branches: FeedTree['domains'][number]['branches'] = []
    for (const b of dd.branches) {
      const bb = b as { id?: unknown; name?: unknown; topics?: unknown } | null
      if (!bb || !isStr(bb.id) || !isStr(bb.name) || !Array.isArray(bb.topics)) continue
      branches.push({ id: bb.id, name: bb.name, topics: bb.topics.filter(isStr) })
    }
    domains.push({ id: dd.id, name: dd.name, branches })
  }
  return { domains }
}

/** 同 archStats 的寫法：available 不是 true、或 payload 形狀不對回 null */
export function parseTopics(raw: unknown): TopicsData | null {
  const root = (raw as { available?: boolean; payload?: unknown } | null) ?? null
  if (!root || root.available !== true) return null
  const p = root.payload as { computedAt?: unknown; total?: unknown; published?: unknown; topics?: unknown; tree?: unknown } | null
  if (!p || !isStr(p.computedAt) || !Array.isArray(p.topics)) return null
  const topics = p.topics.map(parseTopic).filter((t): t is Topic => t !== null)
  return {
    computedAt: p.computedAt,
    total: isNum(p.total) ? p.total : topics.length,
    published: isNum(p.published) ? p.published : topics.filter((t) => t.revision > 0).length,
    topics,
    tree: parseTree((p as { tree?: unknown }).tree),
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

export interface BuiltBranch { id: string; name: string; count: number; topics: Topic[] }
export interface BuiltDomain { id: string; name: string; count: number; branches: BuiltBranch[] }
export interface BuiltTree { domains: BuiltDomain[]; unassigned: Topic[] }

/**
 * 把 feed 的 tree（只有 id）接上題目本體。count＝底下題數；指到不存在的題目略過；
 * 沒在 tree 裡的題目進 unassigned（維持 data.topics 的順序）；tree 為 null 時全部進 unassigned。
 * 同一題在樹裡出現多次時只算第一次。
 */
export function buildTree(data: Pick<TopicsData, 'topics' | 'tree'>): BuiltTree {
  const byId = new Map(data.topics.map((t) => [t.id, t]))
  const placed = new Set<string>()
  const domains: BuiltDomain[] = []
  for (const d of data.tree?.domains ?? []) {
    const branches: BuiltBranch[] = []
    for (const b of d.branches) {
      const topics: Topic[] = []
      for (const id of b.topics) {
        const t = byId.get(id)
        if (!t || placed.has(id)) continue
        placed.add(id)
        topics.push(t)
      }
      branches.push({ id: b.id, name: b.name, count: topics.length, topics })
    }
    domains.push({ id: d.id, name: d.name, count: branches.reduce((n, b) => n + b.count, 0), branches })
  }
  return { domains, unassigned: data.topics.filter((t) => !placed.has(t.id)) }
}

/** k0（只有 parseBodyWithMarkers 會填）＝這條第一個 ⟦n⟧ 在整份 body 裡的序號（0 起），第 i 個 ref 的序號＝k0+i */
export interface Bullet {
  text: string; refs: number[]; single: boolean; k0?: number
  /** 常見誤解：以為／其實（拆不開為 undefined） */
  myth?: string; truth?: string
  /** 判斷點：如果／就 */
  when?: string; then?: string
  /** 踩過的坑：坑／怎麼避開 */
  trap?: string; avoid?: string
}
export type BodyFormat = 'concept' | 'method' | 'legacy'
export interface ParsedBody {
  /** 從標題判斷：有「常見誤解」「為什麼存在」→ concept；有「步驟」「判斷點」「踩過的坑」→ method；其餘 legacy */
  format: BodyFormat
  summary: Bullet | null
  what: Bullet[]
  how: Bullet[]
  caution: Bullet[]
  unknown: Bullet[]
  why: Bullet[]
  myths: Bullet[]
  examples: Bullet[]
  prep: Bullet[]
  steps: Bullet[]
  decisions: Bullet[]
  pitfalls: Bullet[]
  other: string
}

const REF_RE = /⟦(\d+)⟧/g
const SINGLE_MARK = '（僅一例）'

function makeBullet(raw: string): Bullet {
  const refs: number[] = []
  let text = raw.replace(REF_RE, (_m, n: string) => {
    refs.push(Number(n))
    return ''
  })
  const single = text.includes(SINGLE_MARK)
  if (single) text = text.split(SINGLE_MARK).join('')
  // 腳註拿掉後，多來源之間的頓號、逗號會落單（「提香 、」）：清掉空白後的孤立標點與句尾殘留
  text = text.replace(/\s+([、，,；;。．.])/g, '$1').replace(/([、，,；;])+(?=\s*([、，,；;。．]|$))/g, '')
  return { text: text.replace(/\s+/g, ' ').trim(), refs, single }
}

type SectionKey = 'one' | 'what' | 'how' | 'caution' | 'unknown' | 'why' | 'myths' | 'examples' | 'prep' | 'steps' | 'decisions' | 'pitfalls'

function sectionOf(title: string): SectionKey | null {
  if (title.includes('一句話')) return 'one'
  if (title.includes('為什麼存在')) return 'why'
  if (title.includes('常見誤解')) return 'myths'
  if (title.includes('實例')) return 'examples'
  if (title.includes('開工前準備')) return 'prep'
  if (title.includes('步驟')) return 'steps'
  if (title.includes('判斷點')) return 'decisions'
  if (title.includes('踩過的坑')) return 'pitfalls'
  if (title.includes('幹嘛')) return 'what'
  if (title.includes('怎麼做')) return 'how'
  if (title.includes('注意')) return 'caution'
  if (title.includes('不知道')) return 'unknown'
  return null
}

/**
 * 把頁面 markdown 拆開：舊格式「這件事到底在幹嘛」第一條＝summary、其餘進 what；「怎麼做」「要注意」「還不知道」各一組；
 * 新格式（概念／方法）「一句話」第一條＝summary，另有 why／myths／examples／prep／steps／decisions／pitfalls，format 由標題判斷。
 * 條目＝以 - * + 或「1.」開頭的行（後面的縮排續行併進上一條）；含「來源沒有提到」的條目略過；
 * 認不出的標題連同其內容、以及標題前的文字，原文放 other。
 */
export function parseBody(body: string): ParsedBody {
  return parseBodyImpl(body, false)
}

/** 同 parseBody，但每條 bullet 多帶 k0（腳註小卡要對照 topic doc 的 quotes[k]） */
export function parseBodyWithMarkers(body: string): ParsedBody {
  return parseBodyImpl(body, true)
}

const MYTH_RE = /^\s*以為\s*[:：]\s*(.*?)\s*(?:→|->|⇒)\s*其實\s*[:：]\s*(.*)$/s
const DECISION_RE = /^\s*如果\s*[:：]\s*(.*?)\s*(?:→|->|⇒)\s*就\s*[:：]\s*(.*)$/s
const PITFALL_RE = /^\s*([^:：]+?)\s*[:：]\s*(.+)$/s

function splitMyth(b: Bullet): Bullet {
  const m = MYTH_RE.exec(b.text)
  return m && m[1] && m[2] ? { ...b, myth: m[1], truth: m[2] } : b
}
function splitDecision(b: Bullet): Bullet {
  const m = DECISION_RE.exec(b.text)
  return m && m[1] && m[2] ? { ...b, when: m[1], then: m[2] } : b
}
function splitPitfall(b: Bullet): Bullet {
  const m = PITFALL_RE.exec(b.text)
  return m && m[1] && m[2] ? { ...b, trap: m[1], avoid: m[2] } : b
}

function parseBodyImpl(body: string, withK: boolean): ParsedBody {
  const out: ParsedBody = {
    format: 'legacy', summary: null, what: [], how: [], caution: [], unknown: [],
    why: [], myths: [], examples: [], prep: [], steps: [], decisions: [], pitfalls: [], other: '',
  }
  const other: string[] = []
  const lists: Record<SectionKey, string[][]> = {
    one: [], what: [], how: [], caution: [], unknown: [], why: [], myths: [], examples: [], prep: [], steps: [], decisions: [], pitfalls: [],
  }
  const seenKeys = new Set<SectionKey>()
  const starts = new Map<string[], number>()
  let seen = 0
  let current: SectionKey | null = null
  let last: string[] | null = null
  for (const line of body.split(/\r?\n/)) {
    const before = seen
    seen += (line.match(/⟦\d+⟧/g) ?? []).length
    const h = /^\s{0,3}#{1,6}\s+(.*?)\s*#*\s*$/.exec(line)
    if (h) {
      current = sectionOf(h[1]!)
      if (current) seenKeys.add(current)
      last = null
      if (current === null) other.push(line)
      continue
    }
    if (current === null) {
      other.push(line)
      continue
    }
    const b = /^\s*(?:[-*+]|\d+[.)])\s+(.*)$/.exec(line)
    if (b) {
      last = [b[1]!]
      starts.set(last, before)
      lists[current].push(last)
    } else if (last && line.trim() && /^\s+/.test(line)) {
      last.push(line.trim())
    } else if (!line.trim()) {
      last = null
    }
  }
  const toBullets = (rows: string[][]) =>
    rows.map((r) => { const bl = makeBullet(r.join(' ')); if (withK) bl.k0 = starts.get(r) ?? 0; return bl }).filter((x) => x.text && !x.text.includes('來源沒有提到'))
  const one = toBullets(lists.one)
  const what = toBullets(lists.what)
  if (one.length > 0) {
    out.summary = one[0]!
    out.what = what
  } else {
    out.summary = what[0] ?? null
    out.what = what.slice(1)
  }
  out.how = toBullets(lists.how)
  out.caution = toBullets(lists.caution)
  out.unknown = toBullets(lists.unknown)
  out.why = toBullets(lists.why)
  out.myths = toBullets(lists.myths).map(splitMyth)
  out.examples = toBullets(lists.examples)
  out.prep = toBullets(lists.prep)
  out.steps = toBullets(lists.steps)
  out.decisions = toBullets(lists.decisions).map(splitDecision)
  out.pitfalls = toBullets(lists.pitfalls).map(splitPitfall)
  if (seenKeys.has('why') || seenKeys.has('myths')) out.format = 'concept'
  else if (seenKeys.has('steps') || seenKeys.has('decisions') || seenKeys.has('pitfalls')) out.format = 'method'
  out.other = other.join('\n').trim()
  return out
}

export type TreeNodeKind = 'root' | 'domain' | 'branch' | 'topic'
export interface TreeInput { id: string; label: string; kind: TreeNodeKind; docs?: number; children?: TreeInput[] }
export interface TreeLayoutOptions {
  /** 這些 id 的子孫不畫（節點本身仍畫成葉） */
  collapsed?: ReadonlySet<string>
  /** 每層橫向間距（預設 180） */
  dx?: number
  /** 葉節點縱向間距（預設 28） */
  dy?: number
  /** 四周留白（預設 24） */
  pad?: number
}
export interface TreeNodePos { id: string; label: string; depth: number; x: number; y: number; kind: TreeNodeKind; r: number }
export interface TreeEdge { from: string; to: string }
export interface TreeLayout { nodes: TreeNodePos[]; edges: TreeEdge[]; width: number; height: number }

function nodeRadius(n: TreeInput): number {
  if (n.kind === 'topic') return Math.min(14, Math.max(5, 5 + (n.docs ?? 0) * 0.5))
  return n.kind === 'root' ? 9 : n.kind === 'domain' ? 8 : 6
}

/**
 * 橫向（左→右）樹狀圖：根在左、葉在右，葉節點依序等距，父節點 y＝子節點 y 的平均。
 * 確定性（不用亂數）。collapsed 內的 id 其子孫不出現。
 */
export function layoutTidyTree(root: TreeInput, opts: TreeLayoutOptions = {}): TreeLayout {
  const dx = opts.dx ?? 180
  const dy = opts.dy ?? 28
  const pad = opts.pad ?? 24
  const collapsed = opts.collapsed
  const nodes: TreeNodePos[] = []
  const edges: TreeEdge[] = []
  let leaf = 0
  let maxDepth = 0
  const walk = (n: TreeInput, depth: number): number => {
    maxDepth = Math.max(maxDepth, depth)
    const kids = collapsed?.has(n.id) ? [] : n.children ?? []
    const idx = nodes.length
    nodes.push({ id: n.id, label: n.label, depth, x: pad + depth * dx, y: 0, kind: n.kind, r: nodeRadius(n) })
    let y: number
    if (kids.length === 0) {
      y = pad + leaf * dy
      leaf += 1
    } else {
      const ys = kids.map((k) => {
        const cy = walk(k, depth + 1)
        edges.push({ from: n.id, to: k.id })
        return cy
      })
      y = ys.reduce((a, b) => a + b, 0) / ys.length
    }
    nodes[idx]!.y = y
    return y
  }
  walk(root, 0)
  return { nodes, edges, width: pad * 2 + maxDepth * dx, height: pad * 2 + Math.max(0, leaf - 1) * dy }
}

/** 把 buildTree 的結果轉成 layoutTidyTree 的輸入；未歸類的題目掛成一個「未歸類」領域 */
export function treeToLayoutInput(built: BuiltTree, rootLabel = '知識庫'): TreeInput {
  const topicNode = (t: Topic): TreeInput => ({ id: t.id, label: t.name, kind: 'topic', docs: t.docs })
  const children: TreeInput[] = built.domains.map((d) => ({
    id: d.id,
    label: d.name,
    kind: 'domain',
    children: d.branches.map((b) => ({ id: b.id, label: b.name, kind: 'branch', children: b.topics.map(topicNode) })),
  }))
  if (built.unassigned.length > 0) {
    children.push({ id: '__unassigned', label: '未歸類', kind: 'domain', children: built.unassigned.map(topicNode) })
  }
  return { id: '__root', label: rootLabel, kind: 'root', children }
}

/** 補齊首尾之間缺的月份（count 0），舊→新；輸入可亂序、同月份加總 */
export function monthSeries(monthCounts: readonly MonthCount[]): MonthCount[] {
  const valid = monthCounts.filter((m) => MONTH_RE.test(m.month))
  if (valid.length === 0) return []
  const sums = new Map<string, number>()
  for (const m of valid) sums.set(m.month, (sums.get(m.month) ?? 0) + m.count)
  const keys = [...sums.keys()].sort()
  const idx = (k: string) => Number(k.slice(0, 4)) * 12 + Number(k.slice(5, 7)) - 1
  const first = idx(keys[0]!)
  const last = idx(keys[keys.length - 1]!)
  const out: MonthCount[] = []
  for (let i = first; i <= last; i++) {
    const month = `${Math.floor(i / 12)}-${String((i % 12) + 1).padStart(2, '0')}`
    out.push({ month, count: sums.get(month) ?? 0 })
  }
  return out
}

/* ───────── 來源可追溯（2.77.0） ───────── */

/**
 * 所有標題的最長共同前綴（以字元計）。< 4 字回 ''；
 * 前綴把任何一條標題吃光（含整條相同、只有一條）時也回 ''，免得條目顯示空白。
 */
export function commonTitlePrefix(titles: readonly string[]): string {
  if (titles.length === 0) return ''
  const arrs = titles.map((t) => Array.from(t))
  const first = arrs[0]!
  let len = first.length
  for (const a of arrs) {
    let i = 0
    while (i < len && i < a.length && a[i] === first[i]) i++
    len = i
    if (len === 0) break
  }
  if (len < 4) return ''
  if (arrs.some((a) => a.length <= len)) return ''
  return first.slice(0, len).join('')
}

export const OTHER_CASE = '其他'
export interface NumberedSource { source: TopicSource; /** 1 起算的來源序號（＝⟦n⟧ 的 n） */ n: number }
export interface CaseGroup { case: string | null; label: string; items: NumberedSource[] }

function numbered(sources: readonly TopicSource[]): NumberedSource[] {
  return sources.map((source, i) => ({ source, n: i + 1 }))
}

function groupNumbered(items: NumberedSource[]): CaseGroup[] {
  const map = new Map<string, NumberedSource[]>()
  const other: NumberedSource[] = []
  for (const it of items) {
    const c = it.source.case
    if (!c) {
      other.push(it)
      continue
    }
    const arr = map.get(c)
    if (arr) arr.push(it)
    else map.set(c, [it])
  }
  const groups: CaseGroup[] = [...map.entries()].map(([c, list]) => ({ case: c, label: c, items: list }))
  if (other.length > 0) groups.push({ case: null, label: OTHER_CASE, items: other })
  return groups
}

/** 依 case 分組（組序＝case 第一次出現的順序）；沒有 case 的歸「其他」放最後；組內保留原序號 n */
export function groupSourcesByCase(sources: readonly TopicSource[]): CaseGroup[] {
  return groupNumbered(numbered(sources))
}

// 比對順序＝越後段、越具體的先比（PM 修正）：「決標公告」要算決標不是招標、「終止契約」要算爭議不是簽約。
const STAGE_RULES: ReadonlyArray<readonly [string, readonly string[]]> = [
  ['爭議', ['爭議', '罰則', '終止']],
  ['付款', ['付款', '請款']],
  ['驗收', ['驗收']],
  ['履約', ['履約', '進度']],
  ['決標', ['決標', '議價']],
  ['評選', ['評選', '評審']],
  ['開標', ['開標']],
  ['簽約', ['契約', '簽約']],
  ['招標', ['招標', '公告']],
]

/** 標題關鍵字→階段標籤；依 STAGE_RULES 的順序比對，第一個命中的為準；都沒有回 null */
export function stageOf(title: string): string | null {
  for (const [stage, keys] of STAGE_RULES) {
    if (keys.some((k) => title.includes(k))) return stage
  }
  return null
}

/** 本文裡第 k 個 ⟦n⟧ 標記（依文字順序，k 從 0）→ { k, ref: n } */
export function markerOrdinals(body: string): Array<{ k: number; ref: number }> {
  const out: Array<{ k: number; ref: number }> = []
  for (const m of body.matchAll(/⟦(\d+)⟧/g)) out.push({ k: out.length, ref: Number(m[1]) })
  return out
}

export type BulletSection = 'summary' | 'what' | 'how' | 'caution' | 'unknown' | 'why' | 'myths' | 'examples' | 'prep' | 'steps' | 'decisions' | 'pitfalls'
export const bulletId = (section: BulletSection, index = 0): string => (section === 'summary' ? 'summary' : `${section}:${index}`)

/** 引用來源 n 的 bullet 識別（bulletId 格式），依頁面順序；UI 用它標亮 */
export function bulletsCiting(parsed: ParsedBody, n: number): string[] {
  const ids: string[] = []
  if (parsed.summary?.refs.includes(n)) ids.push(bulletId('summary'))
  for (const section of ['what', 'how', 'caution', 'unknown', 'why', 'myths', 'examples', 'prep', 'steps', 'decisions', 'pitfalls'] as const) {
    parsed[section].forEach((b, i) => {
      if (b.refs.includes(n)) ids.push(bulletId(section, i))
    })
  }
  return ids
}

export interface TimelineItem extends NumberedSource { stage: string | null }
export interface TimelineGroup { case: string | null; label: string; items: TimelineItem[] }

/** 卷宗時間線：依 case 分組，組內 date 舊→新，沒有 date 的排組尾（維持原序） */
export function caseTimeline(sources: readonly TopicSource[]): TimelineGroup[] {
  return groupNumbered(numbered(sources)).map((g) => {
    const dated = g.items.filter((it) => it.source.date).sort((a, b) => (a.source.date! < b.source.date! ? -1 : a.source.date! > b.source.date! ? 1 : a.n - b.n))
    const undated = g.items.filter((it) => !it.source.date)
    return { case: g.case, label: g.label, items: [...dated, ...undated].map((it) => ({ ...it, stage: stageOf(it.source.title) })) }
  })
}

/** 不分大小寫找出 q 在 text 的所有命中區間 [start, end)；q 去頭尾空白後為空回 [] */
export function highlightRanges(text: string, q: string): Array<[number, number]> {
  const needle = q.trim()
  if (!needle) return []
  const re = new RegExp(needle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi')
  const out: Array<[number, number]> = []
  for (const m of text.matchAll(re)) {
    if (m[0].length === 0) continue
    out.push([m.index!, m.index! + m[0].length])
  }
  return out
}

/** 關係區：把 t.related 依對方題目的 kind 分組；對方不在題目清單、或是自己就略過（保留 related 原本的順序） */
export function relatedByKind(t: Pick<Topic, 'id' | 'related'>, topics: readonly Topic[]): { concepts: Topic[]; methods: Topic[] } {
  const byId = new Map(topics.map((x) => [x.id, x]))
  const out = { concepts: [] as Topic[], methods: [] as Topic[] }
  const seen = new Set<string>()
  for (const r of t.related) {
    const o = byId.get(r.id)
    if (!o || o.id === t.id || seen.has(o.id)) continue
    seen.add(o.id)
    if (o.kind === 'concept') out.concepts.push(o)
    else out.methods.push(o)
  }
  return out
}

/** 方法頁勾選狀態（localStorage）：鍵 kn-check:<topicId>:<revision>，值＝勾選條目 id 的 JSON 陣列 */
export interface CheckStore { getItem(key: string): string | null; setItem(key: string, value: string): void }
export const checkKey = (topicId: string, revision: number): string => `kn-check:${topicId}:${revision}`

/** 讀不到、壞 JSON、不是字串陣列、store 丟例外都回空集合 */
export function loadChecks(store: CheckStore | null | undefined, key: string): Set<string> {
  try {
    const raw = store?.getItem(key)
    if (!raw) return new Set()
    const v: unknown = JSON.parse(raw)
    if (!Array.isArray(v)) return new Set()
    return new Set(v.filter((x): x is string => typeof x === 'string'))
  } catch {
    return new Set()
  }
}

/** 寫入失敗（例外）時靜默略過，回傳是否成功 */
export function saveChecks(store: CheckStore | null | undefined, key: string, checks: ReadonlySet<string>): boolean {
  try {
    if (!store) return false
    store.setItem(key, JSON.stringify([...checks]))
    return true
  } catch {
    return false
  }
}
