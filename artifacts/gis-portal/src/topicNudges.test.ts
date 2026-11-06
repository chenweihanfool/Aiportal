import { describe, expect, it } from 'vitest'
import { knowledgeHref, nudgeLabel, nudgesFor, parseTopicNudges, triggerTitles, type NudgeMatch, type TopicNudges } from './topicNudges'

const match = (forDate: string, topicId: string, titles: string[] = ['寫報告']): NudgeMatch => ({
  forDate,
  topicId,
  name: topicId,
  path: [],
  published: true,
  point: '',
  triggers: titles.map((title) => ({ kind: 'task' as const, title, due: forDate })),
  score: 50,
})

const payload: TopicNudges = {
  computedAt: '2026-11-06T10:00:00+08:00',
  date: '2026-11-06',
  matches: [match('2026-11-06', 'A'), match('2026-11-07', 'B'), match('2026-11-06', 'C')],
  recall: [],
}

describe('parseTopicNudges', () => {
  it('available 為 true 且四個欄位齊全時通過', () => {
    expect(parseTopicNudges({ available: true, payload })).toEqual(payload)
  })
  it('available 不是 true 回 null', () => {
    expect(parseTopicNudges({ available: false, payload })).toBeNull()
    expect(parseTopicNudges({ payload })).toBeNull()
    expect(parseTopicNudges(null)).toBeNull()
  })
  it('缺 computedAt、matches、recall 任一回 null', () => {
    expect(parseTopicNudges({ available: true, payload: { matches: [], recall: [] } })).toBeNull()
    expect(parseTopicNudges({ available: true, payload: { computedAt: 'x', recall: [] } })).toBeNull()
    expect(parseTopicNudges({ available: true, payload: { computedAt: 'x', matches: [] } })).toBeNull()
  })
})

describe('nudgesFor', () => {
  it('只回指定日期的 matches，保持原順序', () => {
    expect(nudgesFor(payload, '2026-11-06').map((m) => m.topicId)).toEqual(['A', 'C'])
    expect(nudgesFor(payload, '2026-11-07').map((m) => m.topicId)).toEqual(['B'])
    expect(nudgesFor(payload, '2026-11-08')).toEqual([])
  })
  it('data 為 null 回空陣列', () => {
    expect(nudgesFor(null, '2026-11-06')).toEqual([])
  })
})

describe('knowledgeHref', () => {
  it('encodeURIComponent 處理中文與斜線', () => {
    expect(knowledgeHref('機率/統計')).toBe(`#knowledge/${encodeURIComponent('機率/統計')}`)
    expect(knowledgeHref('機率/統計')).toBe('#knowledge/%E6%A9%9F%E7%8E%87%2F%E7%B5%B1%E8%A8%88')
    expect(knowledgeHref('rtk')).toBe('#knowledge/rtk')
  })
})

describe('nudgeLabel', () => {
  it('同一天是「今天用得上」，否則是「明天用得上」', () => {
    expect(nudgeLabel('2026-11-06', '2026-11-06')).toBe('今天用得上')
    expect(nudgeLabel('2026-11-07', '2026-11-06')).toBe('明天用得上')
  })
})

describe('triggerTitles', () => {
  it('觸發來源以「、」連接', () => {
    expect(triggerTitles(match('2026-11-06', 'A', ['寫報告', '買菜']))).toBe('寫報告、買菜')
  })
})
