import { describe, expect, it } from 'vitest'
import { knowledgeHref, parseTopicNudges, type NudgeMatch, type TopicNudges } from './topicNudges'

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

describe('knowledgeHref', () => {
  it('encodeURIComponent 處理中文與斜線', () => {
    expect(knowledgeHref('機率/統計')).toBe(`#knowledge/${encodeURIComponent('機率/統計')}`)
    expect(knowledgeHref('機率/統計')).toBe('#knowledge/%E6%A9%9F%E7%8E%87%2F%E7%B5%B1%E8%A8%88')
    expect(knowledgeHref('rtk')).toBe('#knowledge/rtk')
  })
})

describe('新欄位（2026-11-13）', () => {
  it('resumes 與 matches 的選填欄位原樣通過；舊格式沒有這些欄位也通過', () => {
    const withNew: TopicNudges = {
      ...payload,
      matches: [{ ...match('2026-11-06', 'A'), why: '任務到期', at: '14:00', matchedBy: 'case', caseName: '王案' }],
      resumes: [{ forDate: '2026-11-06', at: null, caseName: '王案', quietDays: 39, why: '停了 39 天', events: [{ date: '2026-10-05', title: '電話聯絡' }] }],
    }
    expect(parseTopicNudges({ available: true, payload: withNew })).toEqual(withNew)
    expect(parseTopicNudges({ available: true, payload })?.resumes).toBeUndefined()
  })
})
