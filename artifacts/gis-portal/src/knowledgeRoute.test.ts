import { describe, expect, it } from 'vitest'
import { formatKnowledgeHash, parseKnowledgeHash, type KnowledgeRoute } from './knowledgeRoute'

describe('parseKnowledgeHash', () => {
  it('overview', () => { expect(parseKnowledgeHash('#knowledge')).toEqual({ view: 'overview' }) })
  it('topic', () => { expect(parseKnowledgeHash('#knowledge/abc')).toEqual({ view: 'topic', topicId: 'abc', stationId: null }) })
  it('topic＋station', () => { expect(parseKnowledgeHash('#knowledge/abc/s/s1')).toEqual({ view: 'topic', topicId: 'abc', stationId: 's1' }) })
  it('非 knowledge 回 null', () => {
    expect(parseKnowledgeHash('')).toBeNull()
    expect(parseKnowledgeHash('#food')).toBeNull()
    expect(parseKnowledgeHash('#knowledgebase')).toBeNull()
  })
  it('decode 失敗或空白 id 回 overview', () => {
    expect(parseKnowledgeHash('#knowledge/%E0%A4%A')).toEqual({ view: 'overview' })
    expect(parseKnowledgeHash('#knowledge/')).toEqual({ view: 'overview' })
    expect(parseKnowledgeHash('#knowledge/%20')).toEqual({ view: 'overview' })
    expect(parseKnowledgeHash('#knowledge/abc/s/%E0%A4%A')).toEqual({ view: 'overview' })
  })
})

describe('formatKnowledgeHash 來回', () => {
  const ids = ['abc', '測量/地籍', '100%', 'a b/c%2F', '中文 題目']
  for (const id of ids) {
    it(`topic ${id}`, () => {
      const r: KnowledgeRoute = { view: 'topic', topicId: id, stationId: null }
      expect(parseKnowledgeHash(formatKnowledgeHash(r))).toEqual(r)
    })
    it(`station ${id}`, () => {
      const r: KnowledgeRoute = { view: 'topic', topicId: id, stationId: `步驟/1%${id}` }
      expect(parseKnowledgeHash(formatKnowledgeHash(r))).toEqual(r)
    })
  }
  it('overview', () => { expect(formatKnowledgeHash({ view: 'overview' })).toBe('#knowledge') })
})
