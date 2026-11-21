import { describe, expect, it } from 'vitest'
import type { IdeaItem } from './boardApi'
import { FORCE_LABELS, buildForces, buildFunnel, funnelPopulation, median, type ScoreRow } from './mindCharts'

const TODAY = '2026-11-22'
const idea = (o: Partial<IdeaItem> & { id: string }): IdeaItem => ({
  title: o.id, category: null, dimension: null, source: null, why: null, value: null, effort: null, status: 'new',
  bornAt: '2026-11-01T00:00:00Z', lastMentioned: '2026-11-01', mentions: 1, backfill: false, days: [], history: [],
  score: null, scoreWhy: [], weakBoost: false, ...o,
})

describe('想法漏斗', () => {
  const ideas: IdeaItem[] = [
    idea({ id: 'a', bornAt: '2026-11-01T00:00:00Z', status: 'done', history: [{ status: 'doing', at: '2026-11-03T00:00:00Z' }, { status: 'done', at: '2026-11-07T00:00:00Z' }] }),
    idea({ id: 'b', bornAt: '2026-11-02T00:00:00Z', status: 'doing', history: [{ status: 'doing', at: '2026-11-06T00:00:00Z' }] }),
    idea({ id: 'c', bornAt: '2026-11-05T00:00:00Z', status: 'shelved', history: [{ status: 'doing', at: '2026-11-06T00:00:00Z' }, { status: 'shelved', at: '2026-11-09T00:00:00Z' }] }),
    idea({ id: 'd', status: 'new' }),
    idea({ id: 'e', status: 'dropped' }),
    idea({ id: 'old', bornAt: '2026-05-01T00:00:00Z', status: 'done' }),
    idea({ id: 'bf', backfill: true }),
    idea({ id: 'ab', status: 'absorbed' }),
  ]
  it('母體：近 90 天、非回填、非 absorbed', () => {
    expect(funnelPopulation(ideas, TODAY).map((i) => i.id)).toEqual(['a', 'b', 'c', 'd', 'e'])
  })
  it('三段計數與封存', () => {
    const f = buildFunnel(ideas, TODAY)
    expect(f.stages.map((s) => s.count)).toEqual([5, 3, 1])
    expect(f.archived).toBe(2)
  })
  it('轉換率與停留天數中位數', () => {
    const f = buildFunnel(ideas, TODAY)
    expect(f.steps[0]).toEqual({ rate: 60, medianDays: 2 })
    expect(f.steps[1]).toEqual({ rate: 33, medianDays: 4 })
  })
  it('資料不足顯示 null', () => {
    const f = buildFunnel([idea({ id: 'x', status: 'doing' })], TODAY)
    expect(f.steps[0]).toEqual({ rate: 100, medianDays: null })
    expect(f.steps[1]).toEqual({ rate: 0, medianDays: null })
    const empty = buildFunnel([], TODAY)
    expect(empty.steps).toEqual([{ rate: null, medianDays: null }, { rate: null, medianDays: null }])
  })
  it('median', () => {
    expect(median([])).toBeNull()
    expect(median([1, 3])).toBe(2)
  })
})

describe('五力', () => {
  const score = (vals: number[]) => ({ total: 0, parts: FORCE_LABELS.map((label, i) => ({ key: `k${i}`, label, value: vals[i]!, note: '' })) })
  const row = (date: string, vals: number[] | null): ScoreRow => ({ date, score: vals ? score(vals) : null })
  const rows: ScoreRow[] = [
    row('2026-11-22', [4, 2, 1, 3, 2]), row('2026-11-21', [2, 2, 3, 3, 2]), row('2026-11-20', null),
    row('2026-11-14', [1, 1, 1, 1, 1]), row('2026-11-13', [3, 1, 1, 1, 3]),
  ]
  it('本週與前週平均', () => {
    const v = buildForces(rows, TODAY)
    expect(v.thisWeek).toEqual([3, 2, 2, 3, 2])
    expect(v.prevWeek).toEqual([2, 1, 1, 1, 2])
  })
  it('最弱判定與走勢', () => {
    const v = buildForces(rows, TODAY)
    expect(v.weakest).toBe('決策')
    expect(v.sparks).toHaveLength(5)
    const s = v.sparks[0]!
    expect(s.points).toHaveLength(30)
    expect(s.points.find((p) => p.date === '2026-11-20')!.value).toBeNull()
    expect(s.latest).toBe(4)
    expect(s.weekAvg).toBe(3)
  })
  it('資料不足', () => {
    expect(buildForces(rows.slice(0, 2), TODAY).enough).toBe(false)
    expect(buildForces(rows, TODAY).days).toBe(4)
    expect(buildForces(rows, TODAY).enough).toBe(true)
    const none = buildForces([], TODAY)
    expect(none.weakest).toBeNull()
    expect(none.enough).toBe(false)
  })
})
