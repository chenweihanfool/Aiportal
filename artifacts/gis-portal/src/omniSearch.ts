// 首頁「一個框搜全部」的純邏輯（2.86.0）：不碰 DOM、不打網路（網路在 omniSearchApi.ts，畫面在 OmniSearch.tsx）。
// 契約（S1～S3）見 docs/search-api.md 與規格；這裡的解析一律寬容：欄位不對的項目略過，整體不丟錯。
import type { RepoItem } from './repoApi'

export type SearchKind = 'topic' | 'case' | 'person' | 'object' | 'event' | 'concept' | 'method' | 'source' | 'idea' | 'place' | 'trip' | 'repo' | 'tool' | 'diary'

/** 結果分組的固定順序（與後端 groups 順序一致） */
export const KIND_ORDER: readonly SearchKind[] = ['case', 'topic', 'person', 'object', 'event', 'concept', 'method', 'source', 'diary', 'idea', 'place', 'trip', 'repo', 'tool']

const KIND_LABEL: Record<SearchKind, string> = {
  case: '案件', topic: '知識', person: '人', object: '物', event: '事件', concept: '概念',
  method: '方法', source: '原文', idea: '想法', place: '地點', trip: '遊記', repo: '倉庫', tool: '工具', diary: '日記',
}

export function isSearchKind(v: unknown): v is SearchKind {
  return typeof v === 'string' && (KIND_ORDER as readonly string[]).includes(v)
}

export function kindLabel(kind: SearchKind): string { return KIND_LABEL[kind] }

/** 倉庫專屬的補充資訊（只有 kind 為 repo 的命中才有） */
export interface RepoMeta { language: string | null; private: boolean; archived: boolean; url: string }

export interface SearchHit { kind: SearchKind; id: string; title: string; snippet: string; date: string | null; meta?: RepoMeta }
export interface SearchGroup { kind: SearchKind; count: number; items: SearchHit[] }
export interface SearchFacets { months: Array<{ ym: string; n: number }> }
export interface SearchResponse { q: string; total: number; tookMs: number; groups: SearchGroup[]; best: SearchHit | null; facets: SearchFacets }
export interface PreviewRelated { kind: SearchKind; id: string; title: string }
export interface SearchPreview {
  kind: SearchKind; id: string; title: string; one: string; points: string[]
  related: PreviewRelated[]; source: string; bodyMd: string | null
  /** 倉庫的 GitHub 網址（只有 repo 預覽可能帶） */
  url?: string
}

/** API 的 q 上限（S1：去頭尾空白後 1～50 字） */
export const MAX_QUERY_LEN = 50

// ─────────────────────────────────────────────
// 前綴與指令
// ─────────────────────────────────────────────

export type ParsedQuery =
  | { mode: 'empty'; prefix: null; kind: null; q: '' }
  | { mode: 'search'; prefix: '@' | '#' | '?' | 'gh:' | null; kind: SearchKind | null; q: string }
  | { mode: 'command'; prefix: '>'; kind: null; q: string }

const PREFIX_KIND: Record<string, SearchKind> = { '@': 'person', '#': 'case', '?': 'topic' }
const GH_PREFIX_RE = /^gh:/i

/** 前綴提示鈕（未輸入時顯示） */
export const PREFIX_HINTS: ReadonlyArray<{ prefix: '@' | '#' | '?' | 'gh:' | '>'; label: string }> = [
  { prefix: '@', label: '只找人' }, { prefix: '#', label: '只找案件' }, { prefix: '?', label: '只找知識' }, { prefix: 'gh:', label: '只找倉庫' }, { prefix: '>', label: '下指令' },
]

/** 解析輸入框內容：`@ # ? gh:` 限定類型、`>` 指令模式；沒有前綴就是全部。q 去頭尾空白並截到 50 字。 */
export function parseQuery(raw: string): ParsedQuery {
  const s = raw.trim()
  if (!s) return { mode: 'empty', prefix: null, kind: null, q: '' }
  const first = s[0]
  if (first === '>') return { mode: 'command', prefix: '>', kind: null, q: s.slice(1).trim() }
  if (GH_PREFIX_RE.test(s)) return { mode: 'search', prefix: 'gh:', kind: 'repo', q: s.slice(3).trim().slice(0, MAX_QUERY_LEN) }
  if (first === '@' || first === '#' || first === '?') {
    return { mode: 'search', prefix: first, kind: PREFIX_KIND[first], q: s.slice(1).trim().slice(0, MAX_QUERY_LEN) }
  }
  return { mode: 'search', prefix: null, kind: null, q: s.slice(0, MAX_QUERY_LEN) }
}

/** 「開啟」的去處：hash 不含 `#`（沿用既有 `window.location.hash = 'food'` 寫法） */
export type OpenAction =
  | { type: 'hash'; hash: string }
  | { type: 'ideas' }
  | { type: 'chat' }
  | { type: 'tool'; id: string }
  | { type: 'expand' }
  | { type: 'report'; date: string }
  | { type: 'dossier'; kind: 'case' | 'person' | 'object'; name: string }
  | { type: 'repo'; id: string }
  | { type: 'repoList' }

export interface OmniCommand { id: string; label: string; hint: string; keywords: string[]; action: OpenAction }

export const COMMANDS: readonly OmniCommand[] = [
  { id: 'timeline', label: '時間軸', hint: '日／週／月／季／年報', keywords: ['時間軸', '日報', '週報', '月報', '報告', 'timeline'], action: { type: 'hash', hash: 'graph/timeline' } },
  { id: 'ideas', label: '想法庫', hint: '全部想法與狀態', keywords: ['想法', '想法庫', 'ideas'], action: { type: 'ideas' } },
  { id: 'relations', label: '卷宗', hint: '案件／人物卷宗', keywords: ['關係', '人', '案件', '卷宗'], action: { type: 'hash', hash: 'dossier' } },
  { id: 'knowledge', label: '知識', hint: '知識頁與全樹', keywords: ['知識', '知識頁', 'knowledge'], action: { type: 'hash', hash: 'knowledge' } },
  { id: 'repos', label: '倉庫', hint: '最近更新的 10 個 GitHub 倉庫', keywords: ['倉庫', 'github', 'gh', 'repo', 'repos'], action: { type: 'repoList' } },
  { id: 'food', label: '美食地圖', hint: '口袋名單與地圖', keywords: ['美食', '吃', '餐廳', '地圖', '附近', 'food'], action: { type: 'hash', hash: 'food' } },
  { id: 'trips', label: '遊記', hint: '每趟旅行的紀錄', keywords: ['遊記', '旅遊', '行程', 'trip', 'trips'], action: { type: 'hash', hash: 'trips' } },
  { id: 'architecture', label: '知識庫架構', hint: '分層架構與各節點狀態', keywords: ['架構', '知識庫架構', 'architecture'], action: { type: 'hash', hash: 'architecture' } },
  { id: 'legacy', label: '舊版首頁', hint: '退路', keywords: ['舊版首頁', '舊首頁', '舊版', 'legacy'], action: { type: 'hash', hash: 'legacy' } },
  { id: 'hermes', label: '問 HERMES', hint: '打開 HERMES 對話', keywords: ['hermes', '問', '對話', '聊天', 'chat'], action: { type: 'chat' } },
]

/** `>` 後面的字過濾指令（名稱、說明、關鍵字，不分大小寫）；沒有字就全部。 */
export function filterCommands(q: string): OmniCommand[] {
  const s = q.trim().toLowerCase()
  if (!s) return [...COMMANDS]
  const hits = COMMANDS.filter(c => c.label.toLowerCase().includes(s) || c.hint.toLowerCase().includes(s) || c.keywords.some(k => k.toLowerCase().includes(s) || s.includes(k.toLowerCase())))
  // 名稱完全相同 → 名稱以輸入開頭 → 其他；同級維持原順序
  const rank = (c: OmniCommand) => { const l = c.label.toLowerCase(); return l === s ? 0 : l.startsWith(s) ? 1 : 2 }
  return hits.map((c, i) => ({ c, i })).sort((a, b) => rank(a.c) - rank(b.c) || a.i - b.i).map(x => x.c)
}

/** 摘要去掉 markdown 標記（標題 #、條列 -、粗體、[[連結]]、⟦n⟧、句尾 ^c001），只留文字 */
export function cleanSnippet(text: string): string {
  return text
    .replace(/\[\[[^\]|]*\|([^\]]*)\]\]/g, '$1').replace(/\[\[([^\]]*)\]\]/g, '$1')
    .replace(/⟦\d+⟧/g, '').replace(/\s\^c\d+/g, '').replace(/\*\*/g, '')
    .replace(/(^|\s)#{1,6}\s+/g, '$1').replace(/(^|\s)[-*]\s+/g, '$1')
    .replace(/\s+/g, ' ').trim()
}

/** 工具連結只留前端真的開得了的（sites 清單裡有的）；組空了就拿掉，總數跟著扣 */
export function keepKnownTools(resp: SearchResponse, siteIds: ReadonlySet<string>): SearchResponse {
  let dropped = 0
  const groups: SearchGroup[] = []
  for (const g of resp.groups) {
    if (g.kind !== 'tool') { groups.push(g); continue }
    const items = g.items.filter(h => siteIds.has(h.id))
    dropped += g.count - items.length
    if (items.length > 0) groups.push({ ...g, count: items.length, items })
  }
  if (dropped === 0) return resp
  const best = resp.best && resp.best.kind === 'tool' && !siteIds.has(resp.best.id) ? (groups[0]?.items[0] ?? null) : resp.best
  return { ...resp, groups, total: Math.max(0, resp.total - dropped), best }
}

/** 各 kind 的「開啟」去處（F8） */
export function openAction(kind: SearchKind, id: string): OpenAction {
  switch (kind) {
    case 'topic': return { type: 'hash', hash: `knowledge/${encodeURIComponent(id)}` }
    case 'idea': return { type: 'ideas' }
    case 'place': return { type: 'hash', hash: 'food' }
    case 'trip': return { type: 'hash', hash: `trips/${encodeURIComponent(id)}` }
    case 'tool': return { type: 'tool', id }
    case 'case': return { type: 'dossier', kind: 'case', name: id }
    case 'person': return { type: 'dossier', kind: 'person', name: id }
    case 'object': return { type: 'dossier', kind: 'object', name: id }
    case 'repo': return { type: 'repo', id }
    case 'event': return { type: 'hash', hash: `dossier/event/${encodeURIComponent(id)}` }
    case 'diary': return { type: 'report', date: id }
    case 'concept': case 'method': case 'source': return { type: 'expand' }
  }
}

/** 指令模式的倉庫列表最多顯示幾筆 */
export const REPO_LIST_MAX = 10

const REPO_LIST_QUERIES = ['倉庫', 'github', 'gh', 'repo', 'repos']

/** 指令 `>倉庫`（及 github／gh／repo／repos）＝列出最近更新的倉庫 */
export function isRepoListQuery(q: string): boolean {
  return REPO_LIST_QUERIES.includes(q.trim().toLowerCase())
}

const HTTP_RE = /^https?:/i

/** 倉庫清單 → 可放進搜尋列表的命中：最近推送在前、null 最後、同時間依名稱；壞網址略過 */
export function recentRepoHits(repos: readonly RepoItem[], max = REPO_LIST_MAX): SearchHit[] {
  const t = (r: RepoItem): number => {
    if (!r.pushedAt) return -Infinity
    const ms = Date.parse(r.pushedAt)
    return Number.isFinite(ms) ? ms : -Infinity
  }
  return [...repos]
    .filter((r) => typeof r.url === 'string' && HTTP_RE.test(r.url))
    .sort((a, b) => t(b) - t(a) || a.name.localeCompare(b.name))
    .slice(0, max)
    .flatMap((r): SearchHit[] => {
      const date = r.pushedAt ? r.pushedAt.slice(0, 10) : null
      return [{
        kind: 'repo', id: r.name, title: r.name, snippet: r.description ?? '', date,
        meta: { language: r.language, private: r.private === true, archived: r.archived === true, url: r.url },
      }]
    })
}

// ─────────────────────────────────────────────
// 回應的寬容解析
// ─────────────────────────────────────────────

const isRec = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)
const str = (v: unknown): string | null => (typeof v === 'string' ? v : null)
const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null)

/** 倉庫命中的補充欄位：meta 是物件、url 是 http(s) 字串才帶；其他情況（含 javascript:）不帶 */
function parseRepoMeta(raw: unknown): RepoMeta | undefined {
  if (!isRec(raw)) return undefined
  const url = str(raw.url)
  if (url === null || !HTTP_RE.test(url)) return undefined
  return { language: str(raw.language), private: raw.private === true, archived: raw.archived === true, url }
}

function parseHit(raw: unknown): SearchHit | null {
  if (!isRec(raw)) return null
  const id = str(raw.id)
  const title = str(raw.title)
  if (!isSearchKind(raw.kind) || id === null || id === '' || title === null || title === '') return null
  const base: SearchHit = { kind: raw.kind, id, title, snippet: cleanSnippet(str(raw.snippet) ?? ''), date: str(raw.date) }
  if (raw.kind === 'repo') {
    const meta = parseRepoMeta(raw.meta)
    if (meta) base.meta = meta
  }
  return base
}

const EMPTY_RESPONSE: SearchResponse = { q: '', total: 0, tookMs: 0, groups: [], best: null, facets: { months: [] } }

/** facets 缺欄位（舊後端）或壞掉＝空陣列；月份格式不對或 n<=0 的略過 */
function parseFacets(raw: unknown): SearchFacets {
  const months: SearchFacets['months'] = []
  if (isRec(raw) && Array.isArray(raw.months)) {
    for (const m of raw.months) {
      if (!isRec(m)) continue
      const ym = str(m.ym)
      const n = num(m.n)
      if (ym !== null && /^\d{4}-\d{2}$/.test(ym) && n !== null && n > 0) months.push({ ym, n })
    }
  }
  return { months }
}

/** 壞掉的整體回傳空結果；壞掉的項目或組略過 */
export function parseSearchResponse(raw: unknown): SearchResponse {
  if (!isRec(raw)) return { ...EMPTY_RESPONSE }
  const groups: SearchGroup[] = []
  if (Array.isArray(raw.groups)) {
    for (const g of raw.groups) {
      if (!isRec(g) || !isSearchKind(g.kind) || !Array.isArray(g.items)) continue
      const items = g.items.map(parseHit).filter((h): h is SearchHit => h !== null)
      if (items.length === 0) continue
      const count = num(g.count)
      groups.push({ kind: g.kind, count: count !== null && count >= items.length ? count : items.length, items })
    }
  }
  const sum = groups.reduce((n, g) => n + g.count, 0)
  const total = num(raw.total)
  return { q: str(raw.q) ?? '', total: total !== null && total >= 0 ? total : sum, tookMs: num(raw.tookMs) ?? 0, groups, best: parseHit(raw.best), facets: parseFacets(raw.facets) }
}

export function parsePreview(raw: unknown): SearchPreview | null {
  if (!isRec(raw)) return null
  const id = str(raw.id)
  const title = str(raw.title)
  if (!isSearchKind(raw.kind) || id === null || title === null) return null
  const related: PreviewRelated[] = []
  if (Array.isArray(raw.related)) {
    for (const r of raw.related) {
      if (!isRec(r)) continue
      const rid = str(r.id)
      const rt = str(r.title)
      if (isSearchKind(r.kind) && rid !== null && rid !== '' && rt !== null && rt !== '') related.push({ kind: r.kind, id: rid, title: rt })
    }
  }
  const url = str(raw.url)
  const preview: SearchPreview = {
    kind: raw.kind, id, title, one: str(raw.one) ?? '',
    points: Array.isArray(raw.points) ? raw.points.filter((p): p is string => typeof p === 'string' && p !== '') : [],
    related, source: str(raw.source) ?? '', bodyMd: str(raw.bodyMd),
  }
  if (url !== null && HTTP_RE.test(url)) preview.url = url
  return preview
}

// ─────────────────────────────────────────────
// 鍵盤移動、即答
// ─────────────────────────────────────────────

/** 把分組結果攤平成上下鍵的移動順序（照畫面順序 KIND_ORDER、組內照原順序） */
export function flattenHits(groups: readonly SearchGroup[]): SearchHit[] {
  return KIND_ORDER.flatMap(k => groups.filter(g => g.kind === k).flatMap(g => g.items))
}

/** 循環移動：len 為 0 回 -1；current 為 -1（還沒選）時往下到 0、往上到最後一個 */
export function moveIndex(current: number, delta: 1 | -1, len: number): number {
  if (len <= 0) return -1
  if (current < 0) return delta === 1 ? 0 : len - 1
  return (current + delta + len) % len
}

const ANSWER_SNIPPET_LEN = 60

/** 即答列文字（F5）：有結果打字機顯示的那一句；沒有結果是固定的「找不到」 */
export function quickAnswer(best: SearchHit | null): string {
  if (!best) return '找不到。要不要交給 HERMES？'
  const snip = best.snippet.trim().slice(0, ANSWER_SNIPPET_LEN)
  return `最可能是${kindLabel(best.kind)}「${best.title}」${snip ? `— ${snip}` : ''}　按 Enter 開啟`
}

export function commandAnswer(matches: readonly OmniCommand[]): string {
  return matches.length === 0 ? '沒有符合的指令' : `指令「${matches[0].label}」　按 Enter 執行`
}

/** 標題與摘要的高亮切段：依空白（含全形）切詞、不分大小寫；回傳依序排好的片段 */
export function searchTerms(q: string): string[] {
  return q.split(/[\s　]+/).filter(Boolean).slice(0, 5)
}

export function highlightSegments(text: string, q: string): Array<{ text: string; hit: boolean }> {
  const terms = searchTerms(q).map(t => t.toLowerCase())
  if (!text) return []
  if (terms.length === 0) return [{ text, hit: false }]
  const low = text.toLowerCase()
  const marks = new Array<boolean>(text.length).fill(false)
  for (const t of terms) {
    let from = 0
    for (;;) {
      const i = low.indexOf(t, from)
      if (i < 0) break
      for (let k = i; k < i + t.length && k < marks.length; k++) marks[k] = true
      from = i + t.length
    }
  }
  const out: Array<{ text: string; hit: boolean }> = []
  let start = 0
  for (let i = 1; i <= text.length; i++) {
    if (i === text.length || marks[i] !== marks[start]) {
      out.push({ text: text.slice(start, i), hit: marks[start] })
      start = i
    }
  }
  return out
}

// ─────────────────────────────────────────────
// 脈絡圖座標
// ─────────────────────────────────────────────

export const CTX_W = 420
export const CTX_H = 170
const CTX_RX = 120
const CTX_RY = 58

export interface CtxNode { x: number; y: number; labelY: number }

/** 本項在畫布中心，n 個相關項照橢圓均分（從正上方起、順時針；2 個時放左右）。座標都在 CTX_W×CTX_H 內。 */
export function contextLayout(n: number): { cx: number; cy: number; nodes: CtxNode[] } {
  const cx = CTX_W / 2
  const cy = CTX_H / 2
  const nodes: CtxNode[] = []
  for (let i = 0; i < n; i++) {
    const a = -Math.PI / 2 + (i * 2 * Math.PI) / n + (n === 2 ? Math.PI / 2 : 0)
    const x = cx + Math.cos(a) * CTX_RX
    const y = cy + Math.sin(a) * CTX_RY
    nodes.push({ x, y, labelY: y < cy ? y - 10 : y + 19 })
  }
  return { cx, cy, nodes }
}

/** 節點標籤截短：節點多時更短，免得互相壓到 */
export function ctxLabel(title: string, n: number): string {
  const max = n >= 6 ? 6 : 10
  return title.length > max ? `${title.slice(0, max - 1)}…` : title
}

// ─────────────────────────────────────────────
// 紀錄（F10）與最近找過（F11）
// ─────────────────────────────────────────────

/** 查詢停留多久沒點開，就記一筆「沒點」 */
export const ABANDON_MS = 2000

export function logKey(q: string, clickedKind: string | null, clickedId: string | null): string {
  return `${q}\u0000${clickedKind ?? ''}\u0000${clickedId ?? ''}`
}

/** 同一個查詢（連同點開的項目）連續重複不重送 */
export function shouldLog(lastKey: string | null, key: string): boolean {
  return lastKey !== key
}

/** 沒點開、且停留夠久，才算要記「沒點」 */
export function isAbandoned(shownAtMs: number, nowMs: number, clicked: boolean): boolean {
  return !clicked && nowMs - shownAtMs >= ABANDON_MS
}

export const RECENT_KEY = 'omni-recent-v1'
export const RECENT_MAX = 5

/** 新的查詢放最前面，去重（不分大小寫、去頭尾空白）、最多 5 個 */
export function addRecent(list: readonly string[], q: string): string[] {
  const s = q.trim()
  if (!s) return [...list].slice(0, RECENT_MAX)
  const low = s.toLowerCase()
  return [s, ...list.filter(x => x.trim().toLowerCase() !== low)].slice(0, RECENT_MAX)
}

type StorageLike = Pick<Storage, 'getItem' | 'setItem'>

function defaultStorage(): StorageLike | null {
  try { return typeof window !== 'undefined' ? window.localStorage : null } catch { return null }
}

export function loadRecent(storage: StorageLike | null = defaultStorage()): string[] {
  try {
    const raw = storage?.getItem(RECENT_KEY)
    if (!raw) return []
    const v: unknown = JSON.parse(raw)
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string' && x.trim() !== '').slice(0, RECENT_MAX) : []
  } catch { return [] }
}

export function saveRecent(list: readonly string[], storage: StorageLike | null = defaultStorage()): void {
  try { storage?.setItem(RECENT_KEY, JSON.stringify(list.slice(0, RECENT_MAX))) } catch { /* 寫不進去就只在這次有效 */ }
}
