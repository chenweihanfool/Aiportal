// 卷宗頁（#dossier）的純邏輯：路由解析、摘要、按月分組、相關人案物排名、一層關係圖座標、索引排名。
// 不碰 React／DOM／網路；資料一律來自 graphInsights.buildIndex 的 GraphIndex。
import { entityEvents, type GraphIndex } from './graphInsights'
import type { TimelineRow } from './nodeTimeline'
import type { TopicNudges } from './topicNudges'

export type DossierKind = 'case' | 'person' | 'object'
export type DossierRoute = { kind: DossierKind; name: string } | { kind: 'event'; id: string } | 'index' | null

export const DOSSIER_KIND_LABEL: Record<DossierKind, string> = { case: '案件', person: '人物', object: '物件' }

const isKind = (v: string): v is DossierKind => v === 'case' || v === 'person' || v === 'object'

/** 卷宗網址：名稱用 encodeURIComponent（空白、斜線、#、% 都能來回） */
export function dossierHref(kind: DossierKind, name: string): string {
  return `#dossier/${kind}/${encodeURIComponent(name)}`
}

/** 網址 → 路由。非卷宗網址回 null；#dossier、kind 不合法、名稱空白或解碼失敗一律回 'index'。與 dossierHref 互為反函數。 */
export function dossierFromHash(hash: string): DossierRoute {
  if (hash !== '#dossier' && !hash.startsWith('#dossier/')) return null
  if (hash === '#dossier') return 'index'
  const rest = hash.slice('#dossier/'.length)
  const slash = rest.indexOf('/')
  if (slash < 0) return 'index'
  const kind = rest.slice(0, slash)
  const rawName = rest.slice(slash + 1)
  if (rawName === '') return 'index'
  try {
    const name = decodeURIComponent(rawName)
    if (name === '') return 'index'
    if (kind === 'event') return { kind: 'event', id: name }
    if (!isKind(kind)) return 'index'
    return { kind, name }
  } catch {
    return 'index'
  }
}

/** 事件 → 所屬卷宗：案件（名稱排序第一個）優先，其次參與者第一人，都沒有回 null。eventId 不含 e: 前綴。 */
export function dossierForEvent(index: GraphIndex, eventId: string): { kind: DossierKind; name: string } | null {
  const cases = [...index.caseEvents].filter(([, ids]) => ids.includes(eventId)).map(([c]) => c).sort((a, b) => a.localeCompare(b))
  if (cases.length > 0) return { kind: 'case', name: cases[0] }
  const people = (index.eventParticipants.get(eventId) ?? []).map(p => p.person).sort((a, b) => a.localeCompare(b))
  if (people.length > 0) return { kind: 'person', name: people[0] }
  return null
}

// ── 事件集合（人／案／物各自的事件 id） ──
function eventIdsOf(index: GraphIndex, kind: DossierKind, name: string): string[] {
  const raw = kind === 'person' ? [...(index.personEvents.get(name) ?? [])]
    : kind === 'case' ? (index.caseEvents.get(name) ?? [])
    : (index.objectEvents.get(name) ?? [])
  return Array.from(new Set(raw)).filter(id => index.eventById.has(id))
}

const eventCaseCache = new WeakMap<GraphIndex, Map<string, string[]>>()
function casesOfEvent(index: GraphIndex): Map<string, string[]> {
  let m = eventCaseCache.get(index)
  if (!m) {
    m = new Map()
    for (const [c, ids] of index.caseEvents) {
      for (const id of ids) {
        const a = m.get(id) ?? []
        if (!a.includes(c)) a.push(c)
        m.set(id, a)
      }
    }
    eventCaseCache.set(index, m)
  }
  return m
}

export function entityExists(index: GraphIndex, kind: DossierKind, name: string): boolean {
  if (kind === 'person') return index.personEvents.has(name) || index.labelOf.has(`p:${name}`)
  if (kind === 'case') return index.caseEvents.has(name) || index.caseStatus.has(name)
  return index.objectEvents.has(name) || index.objectType.has(name)
}

export interface DossierRelated { kind: DossierKind; name: string; shared: number }

/** 相關的人／案／物，依共同事件數由多到少（同數依名稱），不含自己。共同事件＝兩者事件集合的交集。 */
export function relatedRanked(index: GraphIndex, kind: DossierKind, name: string, max = 7): DossierRelated[] {
  const counts = new Map<string, DossierRelated>()
  const bump = (k: DossierKind, n: string) => {
    if (k === kind && n === name) return
    const key = `${k}:${n}`
    const cur = counts.get(key)
    if (cur) cur.shared += 1
    else counts.set(key, { kind: k, name: n, shared: 1 })
  }
  const caseOf = casesOfEvent(index)
  for (const id of eventIdsOf(index, kind, name)) {
    for (const p of new Set((index.eventParticipants.get(id) ?? []).map(x => x.person))) bump('person', p)
    for (const c of caseOf.get(id) ?? []) bump('case', c)
    for (const o of new Set(index.eventObjects.get(id) ?? [])) bump('object', o)
  }
  return [...counts.values()]
    .sort((a, b) => b.shared - a.shared || a.name.localeCompare(b.name))
    .slice(0, max)
}

export interface DossierSummary {
  title: string
  kindLabel: string
  sentence: string
  events: number
  first: string | null
  last: string | null
  people: number
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/

/** 敘事裡的 Obsidian wikilink 轉成純文字：[[名稱]]→名稱、[[名稱|顯示]]→顯示；檔名前的「YYYY-MM-DD_」日期前綴拿掉 */
export function plainWikilinks(s: string): string {
  return s.replace(/\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g, (_, target: string, label?: string) =>
    (label ?? target).replace(/^\d{4}-\d{2}-\d{2}_/, '').trim())
}

/** 摘要列。實體不存在回 null。sentence＝最近一則 hub 敘事；沒有就「共 N 件事件，最近 YYYY-MM-DD」。 */
export function dossierSummary(
  index: GraphIndex, kind: DossierKind, name: string,
  narratives: GraphIndex['narrativesByHub'] = index.narrativesByHub,
): DossierSummary | null {
  if (!entityExists(index, kind, name)) return null
  const ids = eventIdsOf(index, kind, name)
  const dates = ids.map(id => index.eventById.get(id)!.date).filter(d => DATE_RE.test(d)).sort()
  const first = dates[0] ?? null
  const last = dates.length ? dates[dates.length - 1] : null
  const hubKey = `${kind === 'person' ? 'p' : kind === 'case' ? 'c' : 'o'}:${name}`
  const latest = [...(narratives.get(hubKey) ?? [])].sort((a, b) => b.date.localeCompare(a.date))[0]
  const text = latest ? plainWikilinks(latest.text).trim() : ''
  const sentence = text || `共 ${ids.length} 件事件${last ? `，最近 ${last}` : ''}`
  const people = relatedRanked(index, kind, name, Number.MAX_SAFE_INTEGER).filter(r => r.kind === 'person').length
  return { title: name, kindLabel: DOSSIER_KIND_LABEL[kind], sentence, events: ids.length, first, last, people }
}

export interface MonthGroup { ym: string; n: number; rows: TimelineRow[]; open: boolean }

/** 按月分組（新到舊）；最近 openRecent 個「有事件的月份」展開。日期不明的事件歸 ym=''，排最後、不展開。 */
export function monthGroups(rows: readonly TimelineRow[], openRecent = 3): MonthGroup[] {
  const byMonth = new Map<string, TimelineRow[]>()
  for (const r of rows) {
    const ym = DATE_RE.test(r.date) ? r.date.slice(0, 7) : ''
    const a = byMonth.get(ym) ?? []
    a.push(r)
    byMonth.set(ym, a)
  }
  const yms = [...byMonth.keys()].filter(k => k !== '').sort((a, b) => b.localeCompare(a))
  if (byMonth.has('')) yms.push('')
  return yms.map((ym, i) => {
    const list = [...byMonth.get(ym)!].sort((a, b) =>
      b.date.localeCompare(a.date) || (b.time ?? '').localeCompare(a.time ?? '') || a.title.localeCompare(b.title))
    return { ym, n: list.length, rows: list, open: ym !== '' && i < openRecent }
  })
}

/** 卷宗的時間軸列（共用 graphInsights.entityEvents） */
export function dossierRows(index: GraphIndex, kind: DossierKind, name: string): TimelineRow[] {
  return entityEvents(index, kind, name)
}

export interface EgoNode { kind: DossierKind; name: string; shared: number; x: number; y: number }
export interface EgoGraph {
  center: { kind: DossierKind; name: string; x: number; y: number }
  nodes: EgoNode[]
  edges: Array<{ to: number; weight: number }>
}

export const EGO_VIEW = { w: 600, h: 420, cx: 300, cy: 210, r: 150 } as const
const r2 = (n: number) => Math.round(n * 100) / 100

/** 一層關係圖：中心本體＋外圈最多 max 個鄰居（均分在圓上，決定性座標）。edges[i].to 是 nodes 的索引。 */
export function egoGraph(index: GraphIndex, kind: DossierKind, name: string, max = 12): EgoGraph {
  const rel = relatedRanked(index, kind, name, max)
  const { cx, cy, r } = EGO_VIEW
  const nodes: EgoNode[] = rel.map((x, i) => {
    const a = -Math.PI / 2 + (2 * Math.PI * i) / rel.length
    return { kind: x.kind, name: x.name, shared: x.shared, x: r2(cx + r * Math.cos(a)), y: r2(cy + r * Math.sin(a)) }
  })
  return { center: { kind, name, x: cx, y: cy }, nodes, edges: nodes.map((n, i) => ({ to: i, weight: n.shared })) }
}

export interface DossierIndexRow { kind: DossierKind; name: string; events: number; last: string | null }

/** 索引：事件最多的前 max 個案件／人物混合排名（同數依名稱）。 */
export function dossierIndex(index: GraphIndex, max = 20): DossierIndexRow[] {
  const rows: DossierIndexRow[] = []
  const add = (kind: DossierKind, name: string) => {
    const ids = eventIdsOf(index, kind, name)
    if (ids.length === 0) return
    const dates = ids.map(id => index.eventById.get(id)!.date).filter(d => DATE_RE.test(d)).sort()
    rows.push({ kind, name, events: ids.length, last: dates.length ? dates[dates.length - 1] : null })
  }
  for (const c of index.caseEvents.keys()) add('case', c)
  for (const p of index.personEvents.keys()) add('person', p)
  return rows.sort((a, b) => b.events - a.events || a.name.localeCompare(b.name)).slice(0, max)
}

/** 相關知識：案件卷宗取 nudges 中 caseName 相同的主題；人／物取觸發項標題含名稱者。依 topicId 去重，比不到回空陣列。 */
export function relatedTopics(nudges: TopicNudges | null, kind: DossierKind, name: string): Array<{ topicId: string; name: string; point: string }> {
  if (!nudges) return []
  const out = new Map<string, { topicId: string; name: string; point: string }>()
  for (const m of nudges.matches) {
    const hit = kind === 'case' ? m.caseName === name : m.triggers.some(t => t.title.includes(name))
    if (hit && !out.has(m.topicId)) out.set(m.topicId, { topicId: m.topicId, name: m.name, point: m.point })
  }
  return [...out.values()]
}
