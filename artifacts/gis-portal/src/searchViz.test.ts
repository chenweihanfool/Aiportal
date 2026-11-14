import { describe, expect, it } from 'vitest'
import { buildIndex } from './graphInsights'
import type { Topic } from './knowledgeView'
import { flattenHits, parseSearchResponse, type SearchGroup, type SearchHit, type SearchKind } from './omniSearch'
import { cardModel, kindSegments, languageColor, monthBuckets, sampleTicks, shiftMonth, splitDate, taipeiYm, tickPosition, type CardCtx } from './searchViz'
import type { Trip } from './tripsApi'

const hit = (kind: SearchKind, id: string, title = id, date: string | null = null, snippet = ''): SearchHit => ({ kind, id, title, snippet, date })
const grp = (kind: SearchKind, count: number): SearchGroup => ({ kind, count, items: [hit(kind, `${kind}1`)] })

describe('monthBuckets', () => {
  it('沒資料補 0、由舊到新、窗口 24 月＋更早', () => {
    const b = monthBuckets([{ ym: '2026-03', n: 5 }], '2026-11')
    expect(b).toHaveLength(25)
    expect(b[0]).toEqual({ older: true, before: '2024-12', n: 0 })
    expect(b[1]).toEqual({ ym: '2024-12', n: 0 })
    expect(b[24]).toEqual({ ym: '2026-11', n: 0 })
    expect(b.find((x) => !x.older && x.ym === '2026-03')?.n).toBe(5)
  })
  it('窗口之前的總和進「更早」，跨年也對', () => {
    const b = monthBuckets([{ ym: '2024-11', n: 2 }, { ym: '2020-01', n: 3 }, { ym: '2025-01', n: 1 }], '2026-01', 3)
    expect(b).toEqual([
      { older: true, before: '2025-11', n: 6 },
      { ym: '2025-11', n: 0 }, { ym: '2025-12', n: 0 }, { ym: '2026-01', n: 0 },
    ])
    expect(shiftMonth('2026-01', -1)).toBe('2025-12')
    expect(shiftMonth('2025-12', 1)).toBe('2026-01')
  })
  it('taipeiYm 格式', () => { expect(taipeiYm(new Date('2026-11-14T00:00:00Z'))).toBe('2026-11') })
})

describe('kindSegments', () => {
  it('依 KIND_ORDER、比例加總 100', () => {
    const s = kindSegments([grp('topic', 1), grp('case', 3)])
    expect(s.map((x) => x.kind)).toEqual(['case', 'topic'])
    expect(s[0].pct).toBeCloseTo(75)
  })
  it('第 7 類起合併成其他', () => {
    const kinds: SearchKind[] = ['case', 'topic', 'person', 'object', 'event', 'concept', 'method', 'source']
    const s = kindSegments(kinds.map((k) => grp(k, 1)))
    expect(s).toHaveLength(7)
    expect(s[6]).toMatchObject({ kind: 'other', n: 2 })
    expect(kindSegments([])).toEqual([])
  })
})

describe('cardModel', () => {
  const graph = {
    people: [{ name: '甲', eventCount: 2 }, { name: '乙', eventCount: 1 }], objects: [], cases: [{ name: 'A案', eventCount: 2, status: null }],
    events: [
      { id: 'e1', date: '2026-01-05', title: 't1', status: null, tags: [], case: 'A案' },
      { id: 'e2', date: '2026-03-09', title: 't2', status: null, tags: [], case: 'A案' },
    ],
    edges: [{ person: '甲', eventId: 'e1', role: 'x' }, { person: '甲', eventId: 'e2', role: 'x' }, { person: '乙', eventId: 'e2', role: 'x' }],
    caseEdges: [{ eventId: 'e1', case: 'A案' }, { eventId: 'e2', case: 'A案' }], objectEdges: [], personRelations: [], hubNarratives: [], hubAssessments: [],
  }
  const topic = { id: 't1', name: '主題', why: '原因', growth: [{ date: '2026-01-01', text: '舊' }, { date: '2026-02-01', text: '新⟦1⟧' }], sources: [{ id: 's', title: 's', month: null }] } as unknown as Topic
  const trip = { id: 'tr', name: '旅', start: '2026-05-01', end: '2026-05-03' } as unknown as Trip
  const ctx: CardCtx = { index: buildIndex(graph as never), topics: [topic], trips: [trip] }
  const none: CardCtx = { index: null, topics: null, trips: null }

  it('case／person', () => {
    const c = cardModel(hit('case', 'A案', 'A案'), ctx)
    expect(c).toMatchObject({ type: 'entity', events: 2, first: '2026-01-05', last: '2026-03-09', ticks: ['2026-01-05', '2026-03-09'] })
    if ('type' in c && c.type === 'entity') expect(c.related).toEqual(['甲', '乙'].slice(0, 3).filter((n) => c.related.includes(n)))
    const p = cardModel(hit('person', '甲', '甲'), ctx)
    expect(p).toMatchObject({ type: 'entity', events: 2, related: ['A案', '乙'] })
  })
  it('topic（要點取 why＋最新成長、去 ⟦n⟧）', () => {
    expect(cardModel(hit('topic', 't1', '主題'), ctx)).toEqual({ type: 'topic', points: ['原因', '新'], sources: 1 })
  })
  it('event 類有日期與無日期', () => {
    expect(cardModel(hit('event', 'x', 'x', '2026-03-09', '摘'), ctx)).toEqual({ type: 'dated', day: '09', ym: '2026-03', summary: '摘' })
    expect(cardModel(hit('diary', '2026-03-09', '2026-03-09', null, '日記摘'), none)).toEqual({ type: 'dated', day: '09', ym: '2026-03', summary: '日記摘' })
    expect(cardModel(hit('idea', 'x'), none)).toEqual({ type: 'dated', day: null, ym: null, summary: '' })
    expect(cardModel(hit('place', 'x'), none)).toMatchObject({ type: 'dated' })
  })
  it('trip', () => { expect(cardModel(hit('trip', 'tr'), ctx)).toEqual({ type: 'trip', start: '2026-05-01', end: '2026-05-03' }) })
  it('資料不足一律 fallback', () => {
    expect(cardModel(hit('case', 'A案', 'A案'), none)).toEqual({ fallback: true })
    expect(cardModel(hit('case', '沒有', '沒有'), ctx)).toEqual({ fallback: true })
    expect(cardModel(hit('topic', 'zz', 'zz'), ctx)).toEqual({ fallback: true })
    expect(cardModel(hit('trip', 'zz'), ctx)).toEqual({ fallback: true })
    expect(cardModel(hit('tool', 'zz'), ctx)).toEqual({ fallback: true })
  })
})

describe('小工具', () => {
  it('splitDate／sampleTicks／tickPosition', () => {
    expect(splitDate('2026-03-09T10:00')).toEqual({ day: '09', ym: '2026-03' })
    expect(splitDate('壞')).toBeNull()
    const many = Array.from({ length: 100 }, (_, i) => `2026-01-${String((i % 28) + 1).padStart(2, '0')}`)
    const t = sampleTicks(many)
    expect(t).toHaveLength(24)
    expect(t[0]).toBe(many[0])
    expect(t[23]).toBe(many[99])
    expect(tickPosition('2026-01-02', '2026-01-01', '2026-01-03')).toBeCloseTo(0.5)
    expect(tickPosition('2026-01-01', '2026-01-01', '2026-01-01')).toBe(0.5)
  })
})

describe('flattenHits 依 KIND_ORDER', () => {
  it('後端順序顛倒也照畫面順序', () => {
    const groups = [grp('topic', 1), grp('case', 1)]
    expect(flattenHits(groups).map((h) => h.kind)).toEqual(['case', 'topic'])
  })
})

describe('parseSearchResponse facets', () => {
  it('缺 facets 當空、壞項目略過', () => {
    expect(parseSearchResponse({ q: 'a', groups: [] }).facets).toEqual({ months: [] })
    expect(parseSearchResponse({ facets: { months: [{ ym: '2026-03', n: 2 }, { ym: 'x', n: 1 }, { ym: '2026-04', n: 0 }] } }).facets.months).toEqual([{ ym: '2026-03', n: 2 }])
  })
})

describe('倉庫卡（2.95.0）', () => {
  const ctx: CardCtx = { index: null, topics: null, trips: null }
  it('cardModel：有 meta 回 repo 型、沒 meta 退回文字列', () => {
    const meta = { language: 'TypeScript', private: true, archived: false, url: 'https://github.com/o/r' }
    expect(cardModel({ ...hit('repo', 'r', 'r', '2026-11-10', '描述'), meta }, ctx)).toEqual({ type: 'repo', language: 'TypeScript', private: true, archived: false, pushed: '2026-11-10', summary: '描述' })
    expect(cardModel(hit('repo', 'r'), ctx)).toEqual({ fallback: true })
  })
  it('languageColor：已知語言不分大小寫、未知穩定、null 中性', () => {
    expect(languageColor('TypeScript')).toBe('#3178c6')
    expect(languageColor('typescript')).toBe('#3178c6')
    expect(languageColor('Zig')).toBe(languageColor('Zig'))
    expect(languageColor('Zig')).toMatch(/^var\(--c-/)
    expect(languageColor(null)).toBe('var(--c-ink-3)')
  })
})
