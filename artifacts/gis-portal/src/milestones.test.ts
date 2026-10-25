import { describe, expect, it } from 'vitest'
import type { IdeaItem } from './boardApi'
import {
  averageOthers, badges, bucketLabel, buckets, buildMilestones, dailyIndex, longestStreak, parseTasksDone, roads, streakEndingAt, sumRange,
  type TasksDone,
} from './milestones'

const idea = (id: string, bornAt: string, history: Array<{ status: string; at: string }> = []): IdeaItem => ({
  id, title: id, category: null, dimension: null, source: null, why: null, value: null, effort: null, status: 'new', bornAt,
  lastMentioned: bornAt, mentions: 1, backfill: false, days: [], history, score: null, scoreWhy: [], weakBoost: false,
})
const tasks = (byDate: Record<string, number>, since: string | null = Object.keys(byDate).sort()[0] ?? null): TasksDone =>
  ({ since, byDate, computedAt: '2026-10-25T10:00:00+08:00' })

const TODAY = '2026-10-25'

describe('parseTasksDone', () => {
  it('取 payload 的 days；壞列與 0 筆丟掉；沒資料回 null', () => {
    const raw = { available: true, payload: { computedAt: 'x', since: '2026-10-01', days: [{ date: '2026-10-01', count: 2 }, { date: '10/2', count: 1 }, { date: '2026-10-03', count: 0 }] } }
    expect(parseTasksDone(raw)).toEqual({ since: '2026-10-01', byDate: { '2026-10-01': 2 }, computedAt: 'x' })
    expect(parseTasksDone({ available: false, payload: null })).toBeNull()
    expect(parseTasksDone(null)).toBeNull()
  })
})

describe('dailyIndex', () => {
  it('新想法看 bornAt、實行看第一次 done（重開再完成不重算）、任務看 feed', () => {
    const ix = dailyIndex([
      idea('a', '2026-10-20'),
      idea('b', '2026-10-01', [{ status: 'done', at: '2026-10-20T09:00:00+08:00' }, { status: 'doing', at: '2026-10-21' }, { status: 'done', at: '2026-10-22' }]),
    ], tasks({ '2026-10-20': 3 }))
    expect(ix.at('2026-10-20')).toEqual({ tasks: 3, ideasNew: 1, ideasDone: 1 })
    expect(ix.at('2026-10-22')).toEqual({ tasks: 0, ideasNew: 0, ideasDone: 0 })
  })
})

describe('sumRange／buckets', () => {
  const ix = dailyIndex([idea('a', '2026-10-24'), idea('b', '2026-10-26')], tasks({ '2026-10-20': 2, '2026-10-25': 1 }))
  it('未來的日子不算', () => {
    expect(sumRange(ix, ['2026-10-19', '2026-10-31'], TODAY)).toEqual({ tasks: 3, ideasNew: 1, ideasDone: 0 })
    expect(sumRange(ix, ['2026-11-01', '2026-11-30'], TODAY)).toEqual({ tasks: 0, ideasNew: 0, ideasDone: 0 })
  })
  it('日報 14 根、由舊到新、最後一根是本期', () => {
    const bs = buckets(ix, 'day', ['2026-10-25', '2026-10-25'], TODAY)
    expect(bs).toHaveLength(14)
    expect(bs[0].range).toEqual(['2026-10-12', '2026-10-12'])
    expect(bs[13]).toMatchObject({ current: true, partial: false, total: 1, label: '25' })
    expect(bs.find((b) => b.range[0] === '2026-10-24')?.total).toBe(1)
  })
  it('月報往前是日曆月；季報往前是日曆季；還沒結束標 partial', () => {
    const m = buckets(ix, 'month', ['2026-10-01', '2026-10-31'], TODAY)
    expect(m).toHaveLength(12)
    expect(m[10].range).toEqual(['2026-09-01', '2026-09-30'])
    expect(m[11]).toMatchObject({ partial: true, tasks: 3 })
    const q = buckets(ix, 'quarter', ['2026-10-01', '2026-12-31'], TODAY)
    expect(q[6].range).toEqual(['2026-07-01', '2026-09-30'])
  })
  it('任務資料開始之前的期標 noTasks', () => {
    const w = buckets(ix, 'week', ['2026-10-19', '2026-10-25'], TODAY, 3)
    expect(w.map((b) => b.noTasks)).toEqual([true, true, false])
  })
  it('標籤', () => {
    expect(bucketLabel('week', ['2026-10-05', '2026-10-11'])).toBe('10/5')
    expect(bucketLabel('month', ['2026-01-01', '2026-01-31'])).toBe('26/1')
    expect(bucketLabel('month', ['2026-09-01', '2026-09-30'])).toBe('9月')
    expect(bucketLabel('quarter', ['2026-07-01', '2026-09-30'])).toBe('26Q3')
    expect(bucketLabel('year', ['2025-01-01', '2025-12-31'])).toBe('2025')
  })
})

describe('連續天數', () => {
  const ix = dailyIndex([], tasks({ '2026-10-21': 1, '2026-10-22': 1, '2026-10-23': 2, '2026-10-24': 1 }))
  it('今天還沒做不算斷，從昨天往回算', () => {
    expect(streakEndingAt(ix, TODAY, TODAY)).toBe(4)
  })
  it('過去某天：那天本身要有成果', () => {
    expect(streakEndingAt(ix, '2026-10-23', TODAY)).toBe(3)
    expect(streakEndingAt(ix, '2026-10-20', TODAY)).toBe(0)
  })
  it('區間內最長連續', () => {
    expect(longestStreak(ix, ['2026-10-19', '2026-10-25'], TODAY)).toBe(4)
  })
})

describe('年度關卡', () => {
  it('從 1/1 累計；本期跨過的關卡列在 crossed', () => {
    const byDate: Record<string, number> = { '2026-03-01': 95, '2026-10-20': 7 }
    const ix = dailyIndex([], tasks(byDate))
    const r = roads(ix, ['2026-10-19', '2026-10-25'], TODAY)
    const t = r.rows.find((x) => x.key === 'tasks')!
    expect(r.year).toBe('2026')
    expect(t).toMatchObject({ ytd: 102, prevTier: 100, next: 150, crossed: [100] })
    expect(t.pct).toBe(4)
  })
  it('去年的資料不算進今年', () => {
    const ix = dailyIndex([], tasks({ '2025-12-31': 50, '2026-01-02': 1 }))
    expect(roads(ix, ['2026-01-01', '2026-01-31'], TODAY).rows[0]).toMatchObject({ ytd: 1, crossed: [1] })
  })
})

describe('徽章與平均', () => {
  const ix = dailyIndex([idea('a', '2026-10-25')], tasks({ '2026-10-23': 1, '2026-10-24': 1, '2026-10-25': 5 }))
  it('連續、新高、關卡', () => {
    const bs = buckets(ix, 'day', ['2026-10-25', '2026-10-25'], TODAY)
    const b = badges('day', bs, streakEndingAt(ix, TODAY, TODAY), 0, roads(ix, ['2026-10-25', '2026-10-25'], TODAY))
    expect(b.map((x) => x.text)).toEqual(['連續 3 天有成果', '近 14 天最多', '2026 年完成任務達 5', '2026 年新想法達 1'])
  })
  it('沒有跨關卡時提示最近的下一關', () => {
    const ix2 = dailyIndex([], tasks({ '2026-10-01': 8, '2026-10-24': 1 }))
    const bs = buckets(ix2, 'day', ['2026-10-24', '2026-10-24'], TODAY)
    const b = badges('day', bs, 0, 0, roads(ix2, ['2026-10-24', '2026-10-24'], TODAY))
    expect(b.at(-1)).toEqual({ icon: '⛳', text: '完成任務再 1 到 10', kind: 'next' })
  })
  it('平均不含本期與空白期', () => {
    const bs = buckets(ix, 'day', ['2026-10-25', '2026-10-25'], TODAY)
    expect(averageOthers(bs)).toBe(1)
  })
})

describe('buildMilestones', () => {
  it('壞區間回 null；沒有任務資料照樣算想法', () => {
    expect(buildMilestones([], null, 'day', ['2026-10-25', '2026-10-24'], TODAY)).toBeNull()
    const m = buildMilestones([idea('a', '2026-10-25')], null, 'week', ['2026-10-19', '2026-10-25'], TODAY)!
    expect(m.current).toMatchObject({ total: 1, ideasNew: 1, noTasks: true })
    expect(m.trend).toHaveLength(12)
    expect(m.tasksSince).toBeNull()
  })
})
