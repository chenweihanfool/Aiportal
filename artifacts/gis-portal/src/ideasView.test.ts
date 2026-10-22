import { describe, expect, it } from 'vitest'
import type { IdeaItem } from './boardApi'
import { STATUS_ICON, STATUS_LABEL, absorbBadges, categoryColor, categoryCounts, filterIdeas, nextStatuses, pips, sortForList, statusCounts, statusMessage, topIdeas } from './ideasView'

const idea = (id: string, over: Partial<IdeaItem> = {}): IdeaItem => ({
  id, title: id, category: '系統', dimension: null, source: 'HERMES', why: null, value: 3, effort: 3, status: 'new',
  bornAt: '2026-10-01T10:00:00+08:00', lastMentioned: '2026-10-01T10:00:00+08:00', mentions: 1, backfill: false,
  days: ['2026-10-01'], history: [], score: 9, scoreWhy: [], weakBoost: false, ...over,
})

describe('ideasView', () => {
  it('keeps API top order and skips missing ids', () => {
    const list = [idea('IDEA-0001'), idea('IDEA-0002'), idea('IDEA-0003')]
    expect(topIdeas(list, ['IDEA-0003', 'IDEA-0009', 'IDEA-0001']).map((i) => i.id)).toEqual(['IDEA-0003', 'IDEA-0001'])
  })
  it('sorts open by score then closed by recency', () => {
    const list = [
      idea('IDEA-0001', { score: 5 }),
      idea('IDEA-0002', { status: 'done', score: null, lastMentioned: '2026-10-05T00:00:00+08:00' }),
      idea('IDEA-0003', { score: 12 }),
      idea('IDEA-0004', { status: 'dropped', score: null, lastMentioned: '2026-10-07T00:00:00+08:00' }),
    ]
    expect(sortForList(list).map((i) => i.id)).toEqual(['IDEA-0003', 'IDEA-0001', 'IDEA-0004', 'IDEA-0002'])
  })
  it('filters by category and status', () => {
    const list = [idea('A', { category: '旅遊' }), idea('B', { status: 'done' }), idea('C', { category: null, status: 'shelved' })]
    expect(filterIdeas(list, '旅遊', 'open').map((i) => i.id)).toEqual(['A'])
    expect(filterIdeas(list, null, 'done').map((i) => i.id)).toEqual(['B'])
    expect(filterIdeas(list, '未分類', 'closed').map((i) => i.id)).toEqual(['C'])
    expect(categoryCounts(list)).toEqual([['旅遊', 1], ['未分類', 1], ['系統', 1]])
    expect(statusCounts(list)).toEqual({ open: 1, doing: 0, done: 1, total: 3 })
  })
  it('gives stable colors and pips', () => {
    expect(categoryColor('系統')).toBe('#5f9bf0')
    expect(categoryColor('某個自訂類別')).toBe(categoryColor('某個自訂類別'))
    expect(categoryColor(null)).toBe('#5b6270')
    expect(pips(3)).toBe('●●●○○')
    expect(pips(null)).toBe('—')
  })
})

describe('copy-to-HERMES message', () => {
  it('uses the diary status mark, id and title', () => {
    expect(statusMessage({ id: 'IDEA-0012', title: '年度回顧影片' }, 'done')).toBe('💡✅ IDEA-0012「年度回顧影片」已實行\n（請照想法庫格式寫進今天的日記）')
    expect(statusMessage({ id: 'IDEA-0003', title: 'x' }, 'doing', ' 今晚開始 ')).toBe('💡🚀 IDEA-0003「x」開始做\n今晚開始')
  })
  it('offers every status except the current one and never back to new', () => {
    expect(nextStatuses('new')).toEqual(['done', 'doing', 'evaluating', 'shelved', 'dropped'])
    expect(nextStatuses('doing')).toEqual(['done', 'evaluating', 'shelved', 'dropped'])
  })
})

describe('🔀 absorbed ideas', () => {
  it('have a label and icon, count as closed, and are never a copy-to-HERMES target', () => {
    expect([STATUS_ICON.absorbed, STATUS_LABEL.absorbed]).toEqual(['🔀', '併入'])
    const list = [idea('IDEA-0039', { status: 'absorbed', score: null, mergedInto: 'IDEA-0022' }), idea('IDEA-0022'), idea('IDEA-0005', { status: 'dropped', score: null })]
    expect(filterIdeas(list, null, 'closed').map((i) => i.id)).toEqual(['IDEA-0039', 'IDEA-0005'])
    expect(filterIdeas(list, null, 'open').map((i) => i.id)).toEqual(['IDEA-0022'])
    expect(statusCounts(list)).toMatchObject({ open: 1, total: 3 })
    expect(nextStatuses('absorbed')).not.toContain('absorbed')
    expect(nextStatuses('new')).not.toContain('absorbed')
  })
  it('badges: merged-into arrow, and absorbed list capped at two plus a count', () => {
    expect(absorbBadges({ mergedInto: 'IDEA-0022', absorbed: [] })).toEqual({ mergedInto: '🔀 併入 → IDEA-0022', absorbed: null })
    expect(absorbBadges({ absorbed: ['IDEA-0039'] })).toEqual({ mergedInto: null, absorbed: '吸收：IDEA-0039' })
    expect(absorbBadges({ absorbed: ['A', 'B', 'C'] }).absorbed).toBe('吸收：A、B 等 3 個')
    expect(absorbBadges({})).toEqual({ mergedInto: null, absorbed: null })   // 舊 API 沒有新欄位
  })
})

import { buildLifeline, buildLineage, buildScatter, lifeStats, quadrantOf, scaleTime } from './ideasView'

describe('idea provenance (來龍去脈)', () => {
  const NOW = Date.parse('2026-10-22T12:00:00+08:00')
  it('builds a lifeline for a finished idea', () => {
    const lf = buildLifeline(idea('A', {
      status: 'done', bornAt: '2026-10-01T10:00:00+08:00', mentions: 3, days: ['2026-10-01', '2026-10-05', '2026-10-05', '2026-10-09'],
      history: [{ status: 'doing', at: '2026-10-12T09:00:00+08:00' }, { status: 'done', at: '2026-10-20T09:00:00+08:00' }],
    }), NOW)!
    expect(lf.ongoing).toBe(false)
    expect(lf.recalls.map((r) => r.date)).toEqual(['2026-10-01', '2026-10-05', '2026-10-09'])
    expect(lf.steps.map((s) => s.status)).toEqual(['new', 'doing', 'done'])
    expect(lf.daysAlive).toBe(19)
    expect(lf.summary).toBe('10/1 誕生 → 想起 3 次 → 10/12 進行中 → 10/20 已實行（歷時 19 天）')
  })
  it('runs an open idea up to now, and survives bad data', () => {
    const lf = buildLifeline(idea('B', { history: [{ status: 'nonsense', at: 'x' }] }), NOW)!
    expect(lf.ongoing).toBe(true)
    expect(lf.endMs).toBe(NOW)
    expect(lf.steps).toHaveLength(1)
    expect(buildLifeline(idea('C', { bornAt: 'bad' }), NOW)).toBeNull()
  })
  it('scales time and tolerates a zero-length span', () => {
    expect(scaleTime(5, 0, 10, 0, 100)).toBe(50)
    expect(scaleTime(99, 0, 10, 0, 100)).toBe(100)
    expect(scaleTime(5, 5, 5, 0, 100)).toBe(50)
  })
  it('builds lineage from either side and ignores cycles', () => {
    const list = [
      idea('A', { absorbed: ['B', 'C'] }),
      idea('B', { status: 'absorbed', mergedInto: 'A' }),
      idea('C', { status: 'absorbed' }), // 只有承接者那邊記了
      idea('D'),
    ]
    const t = buildLineage(list, 'B')!
    expect(t.root.id).toBe('A')
    expect(t.root.children.map((c) => c.id)).toEqual(['B', 'C'])
    expect(t.size).toBe(3)
    expect(buildLineage(list, 'D')).toBeNull()
    const loop = [idea('X', { mergedInto: 'Y' }), idea('Y', { mergedInto: 'X', absorbed: ['X'] })]
    expect(buildLineage(loop, 'X')!.size).toBe(2)
  })
  it('scatters value × effort and counts the unrated', () => {
    const { points, skipped } = buildScatter([idea('A', { value: 5, effort: 1, mentions: 4 }), idea('B', { value: null })])
    expect(skipped).toBe(1)
    expect(points[0]).toMatchObject({ x: 1, y: 5, r: 7, open: true })
    expect(quadrantOf(5, 1)).toBe('quickWin')
    expect(quadrantOf(5, 4)).toBe('bigBet')
    expect(quadrantOf(2, 1)).toBe('chore')
    expect(quadrantOf(2, 5)).toBe('avoid')
  })
  it('summarises life stats', () => {
    const s = lifeStats([
      idea('A', { status: 'done', mentions: 3, history: [{ status: 'done', at: '2026-10-11T10:00:00+08:00' }] }),
      idea('B', { status: 'shelved', history: [{ status: 'shelved', at: '2026-10-21T10:00:00+08:00' }] }),
      idea('C'),
    ], NOW)
    expect(s).toEqual({ total: 3, closed: 2, medianDaysToClose: 15, recurring: 1 })
  })
})

import { hasMerge, matchesQuery, sortMergedGroups } from './ideasView'
describe('idea search & merged filter', () => {
  const list = [
    idea('IDEA-0001', { title: '日記自動摘要', absorbed: ['IDEA-0002'] }),
    idea('IDEA-0002', { title: '每日回顧', status: 'absorbed', mergedInto: 'IDEA-0001', why: '跟摘要重複' }),
    idea('IDEA-0003', { title: '旅遊清單', category: '旅遊', absorbed: [] }),
    idea('IDEA-0004', { title: 'Docker 備份', status: 'absorbed', mergedInto: 'IDEA-0009' }), // 承接者不在清單內
  ]
  it('detects merges in both directions', () => {
    expect(list.map(hasMerge)).toEqual([true, true, false, true])
    expect(filterIdeas(list, null, 'merged').map((i) => i.id)).toEqual(['IDEA-0001', 'IDEA-0002', 'IDEA-0004'])
  })
  it('searches id, title, why, category, partner id; all tokens must hit; case & width insensitive', () => {
    const ids = (q: string) => filterIdeas(list, null, 'all', q).map((i) => i.id)
    expect(ids('摘要')).toEqual(['IDEA-0001', 'IDEA-0002'])
    expect(ids('摘要 回顧')).toEqual(['IDEA-0002'])
    expect(ids('docker')).toEqual(['IDEA-0004'])
    expect(ids('ＤＯＣＫＥＲ')).toEqual(['IDEA-0004'])
    expect(ids('idea-0003')).toEqual(['IDEA-0003'])
    expect(ids('旅遊')).toEqual(['IDEA-0003'])
    expect(ids('IDEA-0009')).toEqual(['IDEA-0004'])
    expect(ids('  ')).toHaveLength(4)
    expect(matchesQuery(list[0]!, '不存在')).toBe(false)
  })
  it('combines search with the merged filter', () => {
    expect(filterIdeas(list, null, 'merged', '備份').map((i) => i.id)).toEqual(['IDEA-0004'])
  })
  it('groups merged ideas under their absorber', () => {
    const shuffled = [list[1]!, list[3]!, list[0]!]
    expect(sortMergedGroups(shuffled).map((i) => i.id)).toEqual(['IDEA-0001', 'IDEA-0002', 'IDEA-0004'])
  })
})
