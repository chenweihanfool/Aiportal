// 關係頁（#relations）的純邏輯：卷宗、最近的人與案、明日報告對到的人與案。
// 使用者 2026-11-01：「我發現很少會去看關係宇宙 有甚麼辦法增加實用性?」。宇宙要自己逛，這頁改成回答問題：
// 這個人／案現在怎樣、明天的事上次談到哪。資料全部來自 /api/hermes-graph，不新增接口。
import { caseTaskStateLabel, normalizeLabel, type GraphIndex } from './graphInsights'
import type { BriefTask } from './briefView'

/** 使用者本人：幾乎每個事件都有，不列進相關的人（與 api-server 的 SELF_PERSON_NAME 相同） */
export const SELF_NAME = '陳韋翰'
const DOSSIER_EVENTS = 8
const DOSSIER_LINKS = 8
const OVERVIEW_ROWS = 8
const PHRASE_LEN = 4
const PREP_EVENTS = 3

export type RelationKind = 'person' | 'case'
export interface RelationEvent { id: string; date: string; title: string }
export interface RelationRow { kind: RelationKind; name: string; count: number; lastDate: string }
export interface Linked { name: string; count: number }
export interface Dossier {
  kind: RelationKind
  name: string
  total: number
  lastDate: string
  /** 距今幾天；日期不明為 null */
  daysSince: number | null
  /** 案件才有：進行中／已結案 */
  stateLabel: string | null
  /** L5 最新評價 */
  assessment: string | null
  events: RelationEvent[]
  people: Linked[]
  cases: Linked[]
  methods: string[]
  concepts: string[]
}
export interface TaskPrep {
  task: BriefTask
  people: string[]
  cases: string[]
  methods: string[]
  concepts: string[]
  events: RelationEvent[]
}

const dayMs = 86_400_000

function daysBetween(from: string, toIso: string): number | null {
  const a = Date.parse(`${from}T00:00:00Z`)
  const b = Date.parse(`${toIso}T00:00:00Z`)
  return Number.isNaN(a) || Number.isNaN(b) ? null : Math.round((b - a) / dayMs)
}

function eventIds(index: GraphIndex, kind: RelationKind, name: string): string[] {
  return [...(kind === 'person' ? index.personEvents.get(name) ?? [] : index.caseEvents.get(name) ?? [])]
}

/** 新到舊；日期不明的排最後 */
function eventsOf(index: GraphIndex, ids: Iterable<string>): RelationEvent[] {
  const out: RelationEvent[] = []
  for (const id of ids) {
    const ev = index.eventById.get(id)
    if (ev) out.push({ id, date: ev.date, title: ev.title })
  }
  return out.sort((a, b) => b.date.localeCompare(a.date) || a.title.localeCompare(b.title))
}

function bump(counts: Map<string, number>, name: string) {
  counts.set(name, (counts.get(name) ?? 0) + 1)
}

function ranked(counts: Map<string, number>): Linked[] {
  return [...counts].map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name)).slice(0, DOSSIER_LINKS)
}

export function dossier(index: GraphIndex, kind: RelationKind, name: string, todayIso: string): Dossier {
  const events = eventsOf(index, eventIds(index, kind, name))
  const people = new Map<string, number>()
  const cases = new Map<string, number>()
  const methods = new Map<string, number>()
  const concepts = new Map<string, number>()
  for (const { id } of events) {
    for (const p of index.eventParticipants.get(id) ?? []) if (p.person !== SELF_NAME && p.person !== name) bump(people, p.person)
    const c = index.eventById.get(id)?.case
    if (c && c !== name) bump(cases, c)
    for (const m of index.eventMethods.get(id) ?? []) if (index.promotedById.get(`m:${m.name}`)) bump(methods, m.name)
    for (const k of index.eventConcepts.get(id) ?? []) if (index.promotedById.get(`k:${k.name}`)) bump(concepts, k.name)
  }
  const lastDate = events.find((e) => e.date)?.date ?? ''
  const hub = `${kind === 'person' ? 'p' : 'c'}:${name}`
  return {
    kind, name, total: events.length, lastDate, daysSince: lastDate ? daysBetween(lastDate, todayIso) : null,
    stateLabel: kind === 'case' ? caseTaskStateLabel(index.caseTaskState.get(name)) : null,
    assessment: index.currentAssessmentByHub.get(hub)?.text ?? null,
    events: events.slice(0, DOSSIER_EVENTS), people: ranked(people), cases: ranked(cases),
    methods: ranked(methods).map((m) => m.name), concepts: ranked(concepts).map((k) => k.name),
  }
}

function row(index: GraphIndex, kind: RelationKind, name: string): RelationRow {
  const events = eventsOf(index, eventIds(index, kind, name))
  return { kind, name, count: events.length, lastDate: events.find((e) => e.date)?.date ?? '' }
}

/** 案件頁的結案字眼，與 api-server 的 isActiveCase 同一組判斷 */
const CLOSED_STATUS = /^(closed|done|resolved|completed|archived|cancelled|已?結案|已?完成|已?封存|已?取消)$/i
const isOpenCase = (index: GraphIndex, name: string) =>
  index.caseTaskState.get(name) !== '已結案' && !CLOSED_STATUS.test((index.caseStatus.get(name) ?? '').trim())

const byRecent = (a: RelationRow, b: RelationRow) => b.lastDate.localeCompare(a.lastDate) || b.count - a.count || a.name.localeCompare(b.name)

/** 搜尋前的預設畫面：最近有動靜的人、還沒結案的案件 */
export function overview(index: GraphIndex): { people: RelationRow[]; cases: RelationRow[] } {
  const people = [...index.personEvents.keys()].filter((n) => n !== SELF_NAME).map((n) => row(index, 'person', n))
  const cases = [...index.caseEvents.keys()].filter((n) => isOpenCase(index, n)).map((n) => row(index, 'case', n))
  return { people: people.sort(byRecent).slice(0, OVERVIEW_ROWS), cases: cases.sort(byRecent).slice(0, OVERVIEW_ROWS) }
}

export function search(index: GraphIndex, query: string): RelationRow[] {
  const q = normalizeLabel(query)
  if (!q) return []
  const hit = (name: string) => normalizeLabel(name).includes(q)
  const rows = [
    ...[...index.personEvents.keys()].filter((n) => n !== SELF_NAME && hit(n)).map((n) => row(index, 'person', n)),
    ...[...index.caseEvents.keys()].filter(hit).map((n) => row(index, 'case', n)),
  ]
  return rows.sort(byRecent).slice(0, 20)
}

function phrases(text: string): Set<string> {
  const clean = normalizeLabel(text).replace(/[^\p{L}\p{N}]/gu, '')
  const out = new Set<string>()
  for (let i = 0; i + PHRASE_LEN <= clean.length; i++) out.add(clean.slice(i, i + PHRASE_LEN))
  return out
}

function sharesPhrase(grams: Set<string>, text: string): boolean {
  for (const g of phrases(text)) if (grams.has(g)) return true
  return false
}

/** 明日報告一件事 → 文字提到的人、用詞相近的案件與方法、最近的相關事件。比對不到就是空，不猜。 */
export function prepForTask(index: GraphIndex, task: BriefTask): TaskPrep {
  const text = [task.title, task.project, task.why, task.next].filter(Boolean).join(' ')
  const grams = phrases([task.title, task.project].filter(Boolean).join(' '))
  const people = [...index.personEvents.keys()].filter((n) => n !== SELF_NAME && n.length >= 2 && text.includes(n))
  const cases = [...index.caseEvents.keys()].filter((n) => sharesPhrase(grams, n))
  const promoted = (prefix: string, names: Iterable<string>) => [...names].filter((n) => index.promotedById.get(`${prefix}:${n}`) && sharesPhrase(grams, n))
  // 對到案件時，該案的事件也算相關：標題常常不會重複案名
  const caseEventIds = new Set(cases.flatMap((c) => index.caseEvents.get(c) ?? []))
  const events = [...index.eventById.values()].filter((e) => e.date && (caseEventIds.has(e.id) || sharesPhrase(grams, e.title)))
    .sort((a, b) => b.date.localeCompare(a.date)).slice(0, PREP_EVENTS).map((e) => ({ id: e.id, date: e.date, title: e.title }))
  return { task, people, cases, methods: promoted('m', index.methodEvents.keys()), concepts: promoted('k', index.conceptEvents.keys()), events }
}

export const prepIsEmpty = (p: TaskPrep) => !p.people.length && !p.cases.length && !p.methods.length && !p.concepts.length && !p.events.length

/** 「3 天前」「今天」；日期不明回空字串 */
export function agoText(days: number | null): string {
  if (days === null) return ''
  if (days <= 0) return '今天'
  return days === 1 ? '昨天' : `${days} 天前`
}
