import { describe, expect, it } from 'vitest'
import type { TimelineItem } from './timelineApi'
import { groupHeader, groupItems, hhiBadge, itemKey, mergePages, neighbors, oneLine, rowDateLabel, scoreBadge } from './timelineLogic'

const item = (level: TimelineItem['level'], key: string, start: string, end = start, over: Partial<TimelineItem> = {}): TimelineItem => ({
  level, periodKey: key, startDate: start, endDate: end, title: key, summary: `摘要${key}`, hasReport: true,
  rangeInferred: false, periodNote: null, generation: 3, eventCount: 0, events: [], mindScore: null, hhiScore: null, ...over,
})

describe('rowDateLabel', () => {
  it('day shows MM-DD and weekday', () => {
    expect(rowDateLabel(item('day', '2026-09-28', '2026-09-28'))).toBe('09-28 週一')
    expect(rowDateLabel(item('day', '2026-09-27', '2026-09-27'))).toBe('09-27 週日')
  })
  it('week shows the covered range', () => {
    expect(rowDateLabel(item('week', '2026-第40週', '2026-09-22', '2026-09-28'))).toBe('09/22–09/28')
  })
  it('month/quarter/year show the period key', () => {
    expect(rowDateLabel(item('month', '2026-08', '2026-08-01', '2026-08-31'))).toBe('2026-08')
    expect(rowDateLabel(item('quarter', '2026-Q2', '2026-04-01', '2026-06-30'))).toBe('2026-Q2')
  })
})

describe('grouping', () => {
  it('groups days by month and weeks by the month of their end date', () => {
    expect(groupHeader('day', item('day', 'k', '2026-09-01'))).toBe('2026 年 9 月')
    expect(groupHeader('week', item('week', 'k', '2026-08-25', '2026-08-31'))).toBe('2026 年 8 月')
    expect(groupHeader('week', item('week', 'k', '2026-08-29', '2026-09-04'))).toBe('2026 年 9 月')
  })
  it('groups months and quarters by year; years are ungrouped', () => {
    expect(groupHeader('month', item('month', 'k', '2026-08-01', '2026-08-31'))).toBe('2026 年')
    expect(groupHeader('quarter', item('quarter', 'k', '2026-04-01', '2026-06-30'))).toBe('2026 年')
    expect(groupHeader('year', item('year', '2026', '2026-01-01', '2026-12-31'))).toBe('')
  })
  it('groupItems keeps order and merges adjacent equal headers', () => {
    const g = groupItems('day', [item('day', 'a', '2026-09-02'), item('day', 'b', '2026-09-01'), item('day', 'c', '2026-08-31')])
    expect(g.map(x => [x.header, x.items.length])).toEqual([['2026 年 9 月', 2], ['2026 年 8 月', 1]])
  })
})

describe('oneLine（列表只顯示一句話）', () => {
  it('uses the summary when present', () => expect(oneLine(item('day', 'k', '2026-09-28'))).toBe('摘要k'))
  it('says so when a report exists but has no summary', () => {
    expect(oneLine(item('day', 'k', '2026-09-28', '2026-09-28', { summary: '' }))).toContain('無摘要')
  })
  it('placeholder rows state the degradation explicitly', () => {
    const p = (over: Partial<TimelineItem>) => oneLine(item('day', 'k', '2026-09-28', '2026-09-28', { summary: '', hasReport: false, ...over }))
    expect(p({ eventCount: 3 })).toBe('無日報 · 當日 3 件事件')
    expect(p({ eventCount: 0 })).toBe('無日報')
    expect(oneLine(item('week', 'k', '2026-06-29', '2026-07-05', { summary: '', hasReport: false }))).toBe('本期無報告')
  })
})

describe('paging and navigation', () => {
  it('mergePages dedupes by level/period and keeps order', () => {
    const a = [item('day', '2026-09-28', '2026-09-28'), item('day', '2026-09-27', '2026-09-27')]
    const b = [item('day', '2026-09-27', '2026-09-27', '2026-09-27', { summary: '重複' }), item('day', '2026-09-26', '2026-09-26')]
    const m = mergePages(a, b)
    expect(m.map(itemKey)).toEqual(['day/2026-09-28', 'day/2026-09-27', 'day/2026-09-26'])
    expect(m[1].summary).toBe('摘要2026-09-27')
  })
  it('neighbors: list is newest-first so older is the next element', () => {
    const l = [item('day', 'd3', '2026-09-28'), item('day', 'd2', '2026-09-27'), item('day', 'd1', '2026-09-26')]
    expect(neighbors(l, 'day/d2').older?.periodKey).toBe('d1')
    expect(neighbors(l, 'day/d2').newer?.periodKey).toBe('d3')
    expect(neighbors(l, 'day/d3').newer).toBeNull()
    expect(neighbors(l, 'day/d1').older).toBeNull()
    expect(neighbors(l, 'day/nope')).toEqual({ older: null, newer: null })
  })
})

describe('scoreBadge', () => {
  it.each([[98.8, 'ok'], [90, 'ok'], [89.9, 'warn'], [75, 'warn'], [74.9, 'concern'], [0, 'concern']])('%s → %s', (s, tone) => {
    expect(scoreBadge(s)?.tone).toBe(tone)
  })
  it('formats to one decimal and hides null/NaN', () => {
    expect(scoreBadge(98.84)?.text).toBe('98.8')
    expect(scoreBadge(null)).toBeNull()
    expect(scoreBadge(Number.NaN)).toBeNull()
  })
})

describe('hhiBadge', () => {
  it.each([[95, 'great'], [80, 'great'], [79, 'ok'], [65, 'ok'], [64, 'warn'], [50, 'warn'], [49, 'concern'], [35, 'concern'], [34, 'crit'], [0, 'crit']])('%s → %s', (s, tone) => {
    expect(hhiBadge(s)?.tone).toBe(tone)
  })
  it('shows an integer and hides null/NaN', () => {
    expect(hhiBadge(62)?.text).toBe('62')
    expect(hhiBadge(61.6)?.text).toBe('62')
    expect(hhiBadge(null)).toBeNull()
    expect(hhiBadge(Number.NaN)).toBeNull()
  })
})
