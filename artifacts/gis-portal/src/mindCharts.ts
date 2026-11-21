import type { IdeaItem } from './boardApi'
import { addDays } from './homeView'
import type { ReportScore } from './timelineApi'

// 心智面向頁（#dim/mind）的兩張主圖的純函式：想法漏斗、五力（日報五項分數）。元件在 MindCharts.tsx。

const DAY_MS = 86_400_000
const dateOf = (iso: string): string => iso.slice(0, 10)
const msOf = (iso: string): number => Date.parse(iso)
const round1 = (n: number): number => Math.round(n * 10) / 10

export function median(xs: number[]): number | null {
  if (xs.length === 0) return null
  const s = [...xs].sort((a, b) => a - b)
  const m = Math.floor(s.length / 2)
  return round1(s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2)
}

/** 漏斗母體：bornAt 在近 N 天內、不是回填、不是被併入的 */
export function funnelPopulation(ideas: IdeaItem[], today: string, days = 90): IdeaItem[] {
  const from = addDays(today, -days)
  return ideas.filter((i) => !i.backfill && i.status !== 'absorbed' && dateOf(i.bornAt) >= from && dateOf(i.bornAt) <= today)
}

const firstAt = (i: IdeaItem, status: string): string | null => {
  const hits = (i.history ?? []).filter((h) => h.status === status && Number.isFinite(msOf(h.at))).map((h) => h.at)
  if (hits.length === 0) return null
  return hits.reduce((a, b) => (msOf(a) <= msOf(b) ? a : b))
}

export const wasFocused = (i: IdeaItem): boolean => i.status === 'doing' || i.status === 'done' || (i.history ?? []).some((h) => h.status === 'doing')

export interface FunnelStage { key: 'born' | 'focused' | 'done'; label: string; count: number; ideas: IdeaItem[] }
export interface FunnelStep { rate: number | null; medianDays: number | null }
export interface FunnelView { stages: FunnelStage[]; steps: FunnelStep[]; archived: number }

export function buildFunnel(ideas: IdeaItem[], today: string, days = 90): FunnelView {
  const pop = funnelPopulation(ideas, today, days)
  const focused = pop.filter(wasFocused)
  const done = pop.filter((i) => i.status === 'done')
  const archived = pop.filter((i) => i.status === 'shelved' || i.status === 'dropped').length
  const rate = (a: number, b: number): number | null => (b === 0 ? null : Math.round((a / b) * 100))
  const gap = (from: string | null, to: string | null): number | null => {
    if (!from || !to) return null
    const d = (msOf(to) - msOf(from)) / DAY_MS
    return Number.isFinite(d) && d >= 0 ? d : null
  }
  const toFocus = focused.flatMap((i) => { const g = gap(i.bornAt, firstAt(i, 'doing')); return g === null ? [] : [g] })
  const toDone = done.flatMap((i) => { const g = gap(firstAt(i, 'doing'), firstAt(i, 'done')); return g === null ? [] : [g] })
  return {
    stages: [
      { key: 'born', label: '產生', count: pop.length, ideas: pop },
      { key: 'focused', label: '曾聚焦', count: focused.length, ideas: focused },
      { key: 'done', label: '完成', count: done.length, ideas: done },
    ],
    steps: [
      { rate: rate(focused.length, pop.length), medianDays: median(toFocus) },
      { rate: rate(done.length, focused.length), medianDays: median(toDone) },
    ],
    archived,
  }
}

// ── 五力 ──

export const FORCE_LABELS = ['推進', '決策', '卡點', '覺察', '能量'] as const
export const FORCE_MIN_DAYS = 3
export const FORCE_TREND_DAYS = 30

export interface ScoreRow { date: string; score: ReportScore | null }
export interface ForceSpark { label: string; points: Array<{ date: string; value: number | null }>; latest: number | null; weekAvg: number | null }
export interface ForceView {
  /** 有分數的日子（近 30 天） */
  days: number
  enough: boolean
  thisWeek: Array<number | null>
  prevWeek: Array<number | null>
  sparks: ForceSpark[]
  /** 本週平均最低的一項（label）；沒有資料＝null */
  weakest: string | null
}

const partValue = (s: ReportScore, label: string, idx: number): number | null => {
  const p = s.parts.find((x) => x.label === label) ?? (s.parts.length === FORCE_LABELS.length ? s.parts[idx] : undefined)
  return p && Number.isFinite(p.value) ? p.value : null
}

const avg = (xs: number[]): number | null => (xs.length === 0 ? null : round1(xs.reduce((a, b) => a + b, 0) / xs.length))

export function buildForces(rows: ScoreRow[], today: string): ForceView {
  const byDate = new Map<string, ReportScore>()
  for (const r of rows) if (r.score) byDate.set(r.date, r.score)
  const dates = (from: number, to: number): string[] => Array.from({ length: to - from + 1 }, (_, k) => addDays(today, from + k))
  const week = (ds: string[]): Array<number | null> =>
    FORCE_LABELS.map((lab, idx) => avg(ds.flatMap((d) => { const s = byDate.get(d); const v = s ? partValue(s, lab, idx) : null; return v === null ? [] : [v] })))
  const thisWeek = week(dates(-6, 0))
  const prevWeek = week(dates(-13, -7))
  const trendDates = dates(-(FORCE_TREND_DAYS - 1), 0)
  const sparks: ForceSpark[] = FORCE_LABELS.map((label, idx) => {
    const points = trendDates.map((date) => { const s = byDate.get(date); return { date, value: s ? partValue(s, label, idx) : null } })
    const latest = [...points].reverse().find((p) => p.value !== null)?.value ?? null
    return { label, points, latest, weekAvg: thisWeek[idx] ?? null }
  })
  const days = trendDates.filter((d) => byDate.has(d)).length
  let weakest: string | null = null
  let low = Infinity
  thisWeek.forEach((v, i) => { if (v !== null && v < low) { low = v; weakest = FORCE_LABELS[i]! } })
  return { days, enough: days >= FORCE_MIN_DAYS, thisWeek, prevWeek, sparks, weakest }
}
