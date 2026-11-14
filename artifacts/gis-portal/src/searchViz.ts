// 搜尋結果視覺化的純邏輯（2.92.0）：總覽條的分段與月份直方圖、各類視覺卡的資料。不碰 React／DOM／網路。
import { caseInsight, entityEvents, objectInsight, personInsight, type GraphIndex } from './graphInsights'
import type { Topic } from './knowledgeView'
import { KIND_ORDER, type SearchGroup, type SearchHit, type SearchKind } from './omniSearch'
import type { Trip } from './tripsApi'

// ─────────────────────────────────────────────
// 總覽條：類別分段
// ─────────────────────────────────────────────

export const MAX_SEGMENTS = 6

export interface KindSegment { kind: SearchKind | 'other'; n: number; pct: number }

/** 依 KIND_ORDER 排；最多 6 段，第 7 類起合併成「其他」（kind='other'，UI 不拿它篩選） */
export function kindSegments(groups: readonly SearchGroup[]): KindSegment[] {
  const ordered = KIND_ORDER.flatMap((k) => {
    const g = groups.find((x) => x.kind === k)
    return g && g.count > 0 ? [{ kind: k, n: g.count }] : []
  })
  const total = ordered.reduce((s, x) => s + x.n, 0)
  if (total === 0) return []
  const head = ordered.slice(0, MAX_SEGMENTS)
  const rest = ordered.slice(MAX_SEGMENTS)
  const segs: Array<{ kind: SearchKind | 'other'; n: number }> = [...head]
  if (rest.length > 0) segs.push({ kind: 'other', n: rest.reduce((s, x) => s + x.n, 0) })
  return segs.map((s) => ({ ...s, pct: (s.n / total) * 100 }))
}

// ─────────────────────────────────────────────
// 總覽條：月份直方圖
// ─────────────────────────────────────────────

export interface MonthFacet { ym: string; n: number }
export type MonthBucket = { older?: false; ym: string; n: number } | { older: true; before: string; n: number }

export const MONTH_SPAN = 24
const YM_RE = /^(\d{4})-(\d{2})$/

/** ym 加減 delta 個月（YYYY-MM）；格式不對原樣回傳 */
export function shiftMonth(ym: string, delta: number): string {
  const m = YM_RE.exec(ym)
  if (!m) return ym
  const idx = Number(m[1]) * 12 + (Number(m[2]) - 1) + delta
  const y = Math.floor(idx / 12)
  return `${String(y).padStart(4, '0')}-${String(idx - y * 12 + 1).padStart(2, '0')}`
}

/** 近 span 個月（含 todayYm、由舊到新）每月一格，沒資料補 0；最前面多一格「更早」＝窗口之前的總和（n 為 0 也回傳） */
export function monthBuckets(months: readonly MonthFacet[], todayYm: string, span = MONTH_SPAN): MonthBucket[] {
  const first = shiftMonth(todayYm, -(span - 1))
  const byYm = new Map<string, number>()
  let older = 0
  for (const m of months) {
    if (!YM_RE.test(m.ym)) continue
    if (m.ym < first) older += m.n
    else byYm.set(m.ym, (byYm.get(m.ym) ?? 0) + m.n)
  }
  const out: MonthBucket[] = [{ older: true, before: first, n: older }]
  for (let i = 0; i < span; i++) {
    const ym = shiftMonth(first, i)
    out.push({ ym, n: byYm.get(ym) ?? 0 })
  }
  return out
}

/** 台北時區的當月（YYYY-MM） */
export function taipeiYm(now: Date = new Date()): string {
  const s = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Taipei', year: 'numeric', month: '2-digit' }).format(now)
  const m = /(\d{4})\D+(\d{2})/.exec(s)
  return m ? `${m[1]}-${m[2]}` : now.toISOString().slice(0, 7)
}

// ─────────────────────────────────────────────
// 視覺卡資料
// ─────────────────────────────────────────────

export interface CardCtx {
  index: GraphIndex | null
  topics: readonly Topic[] | null
  trips: readonly Trip[] | null
}

export const MAX_TICKS = 24
export const MAX_RELATED = 3

export type CardModel =
  | { fallback: true }
  | { type: 'entity'; events: number; first: string | null; last: string | null; ticks: string[]; related: string[] }
  | { type: 'topic'; points: string[]; sources: number }
  | { type: 'dated'; day: string | null; ym: string | null; summary: string }
  | { type: 'trip'; start: string; end: string }
  | { type: 'repo'; language: string | null; private: boolean; archived: boolean; pushed: string | null; summary: string }

const FALLBACK: CardModel = { fallback: true }

// ─────────────────────────────────────────────
// 語言色點
// ─────────────────────────────────────────────

const LANG_COLORS: Readonly<Record<string, string>> = {
  typescript: '#3178c6', javascript: '#f1e05a', python: '#3572a5', html: '#e34c26', css: '#563d7c',
  powershell: '#012456', shell: '#89e051', go: '#00add8', rust: '#dea584', java: '#b07219',
  'c#': '#178600', vue: '#41b883',
}

const LANG_FALLBACK = ['var(--c-accent)', 'var(--c-sky)', 'var(--c-warn)', 'var(--c-ok)', 'var(--c-concern)', 'var(--c-mint)'] as const

/** GitHub 語言色點：已知語言照固定對照；其他語言用名稱字元碼對一組主題色；null＝中性灰 */
export function languageColor(lang: string | null): string {
  if (lang === null) return 'var(--c-ink-3)'
  const known = LANG_COLORS[lang.toLowerCase()]
  if (known) return known
  let sum = 0
  for (const ch of lang) sum += ch.codePointAt(0) ?? 0
  return LANG_FALLBACK[sum % LANG_FALLBACK.length]
}
const DATE_RE = /^(\d{4}-\d{2})-(\d{2})/

/** 日期字串（YYYY-MM-DD 開頭）拆成日與年月；沒有或格式不對＝null */
export function splitDate(date: string | null): { day: string; ym: string } | null {
  const m = date ? DATE_RE.exec(date) : null
  return m ? { day: m[2], ym: m[1] } : null
}

/** 超過 max 個就均勻取樣（保留首尾），不改順序 */
export function sampleTicks(dates: readonly string[], max = MAX_TICKS): string[] {
  if (dates.length <= max) return [...dates]
  const out: string[] = []
  for (let i = 0; i < max; i++) out.push(dates[Math.round((i * (dates.length - 1)) / (max - 1))])
  return out
}

const uniq = (xs: readonly string[]): string[] => [...new Set(xs.filter(Boolean))]

function entityModel(kind: 'case' | 'person' | 'object', name: string, index: GraphIndex): CardModel {
  const rows = entityEvents(index, kind, name)
  const dates = rows.map((r) => r.date).filter((d) => DATE_RE.test(d)).sort()
  let events: number
  let first: string | null
  let last: string | null
  let related: string[]
  if (kind === 'case') {
    const ci = caseInsight(index, name)
    events = ci.totalEvents; first = ci.firstDate; last = ci.lastDate
    related = [...ci.coreTeam.map((p) => p.name), ...ci.oneOffPeople]
  } else if (kind === 'person') {
    const pi = personInsight(index, name)
    events = index.personEvents.get(name)?.size ?? rows.length; first = pi.firstDate; last = pi.lastDate
    related = [...pi.cases.map((c) => c.name), ...pi.collaborators.map((c) => c.name)]
  } else {
    const oi = objectInsight(index, name)
    events = index.objectEvents.get(name)?.length ?? rows.length; first = oi.firstDate; last = oi.lastDate
    related = [...oi.cases, ...oi.handlers.map((h) => h.name)]
  }
  if (events === 0) return FALLBACK
  return { type: 'entity', events, first, last, ticks: sampleTicks(dates), related: uniq(related).filter((n) => n !== name).slice(0, MAX_RELATED) }
}

const clean = (s: string): string => s.replace(/⟦\d+⟧/g, '').replace(/\s+/g, ' ').trim()

function topicModel(item: Pick<SearchHit, 'id' | 'title'>, topics: readonly Topic[]): CardModel {
  const t = topics.find((x) => x.id === item.id) ?? topics.find((x) => x.name === item.title)
  if (!t) return FALLBACK
  const points = [t.why, ...[...t.growth].reverse().map((g) => g.text)].map(clean).filter(Boolean).slice(0, 2)
  if (points.length === 0 && t.sources.length === 0) return FALLBACK
  return { type: 'topic', points, sources: t.sources.length }
}

/** 一筆搜尋命中＋可用資料 → 卡片資料。資料不足一律 { fallback: true }，UI 退回原本的文字列 */
export function cardModel(item: SearchHit, ctx: CardCtx): CardModel {
  switch (item.kind) {
    case 'case': case 'person': case 'object':
      return ctx.index ? entityModel(item.kind, item.title, ctx.index) : FALLBACK
    case 'topic':
      return ctx.topics ? topicModel(item, ctx.topics) : FALLBACK
    case 'trip': {
      const t = ctx.trips?.find((x) => x.id === item.id)
      return t ? { type: 'trip', start: t.start, end: t.end } : FALLBACK
    }
    case 'diary': {
      const d = splitDate(item.date ?? item.id)
      return { type: 'dated', day: d?.day ?? null, ym: d?.ym ?? null, summary: item.snippet }
    }
    case 'event': case 'concept': case 'method': case 'source': case 'idea': case 'place': {
      const d = splitDate(item.date)
      return { type: 'dated', day: d?.day ?? null, ym: d?.ym ?? null, summary: item.snippet }
    }
    case 'repo':
      return item.meta
        ? { type: 'repo', language: item.meta.language, private: item.meta.private, archived: item.meta.archived, pushed: item.date, summary: item.snippet }
        : FALLBACK
    case 'tool':
      return FALLBACK
  }
}

/** 日期 → 0..1 在 [first, last] 上的位置；只有一個日期（first===last）放中間 */
export function tickPosition(date: string, first: string, last: string): number {
  const a = Date.parse(first)
  const b = Date.parse(last)
  const t = Date.parse(date)
  if (![a, b, t].every(Number.isFinite)) return 0.5
  if (b <= a) return 0.5
  return Math.min(1, Math.max(0, (t - a) / (b - a)))
}
