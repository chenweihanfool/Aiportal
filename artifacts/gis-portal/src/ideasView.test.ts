import { describe, expect, it } from 'vitest'
import type { IdeaItem } from './boardApi'
import { categoryColor, categoryCounts, filterIdeas, pips, sortForList, statusCounts, topIdeas } from './ideasView'

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
