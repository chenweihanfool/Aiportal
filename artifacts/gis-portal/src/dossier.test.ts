import { describe, expect, it } from 'vitest'
import { buildIndex } from './graphInsights'
import type { HermesGraphData } from './hermesGraphApi'
import type { TimelineRow } from './nodeTimeline'
import {
  dossierFromHash, dossierHref, dossierIndex, dossierSummary, egoGraph, monthGroups, relatedRanked, relatedTopics,
} from './dossier'

type Graph = NonNullable<HermesGraphData['graph']>

function graph(extra?: Partial<Graph>): Graph {
  const ev = (id: string, date: string, c: string | null) => ({ id, date, title: `T${id}`, status: null, tags: [], case: c })
  return {
    people: [{ name: 'Alice', eventCount: 3 }, { name: 'Bob', eventCount: 2 }, { name: 'Carol', eventCount: 1 }],
    events: [ev('e1', '2026-01-01', 'CaseA'), ev('e2', '2026-01-10', 'CaseA'), ev('e3', '2026-02-01', 'CaseA'), ev('e4', '2026-03-05', null)],
    cases: [{ name: 'CaseA', eventCount: 3, status: 'open' }, { name: 'CaseEmpty', eventCount: 0, status: null }],
    objects: [{ name: 'Laptop', objectType: 'device', eventCount: 2 }],
    edges: [
      { person: 'Alice', eventId: 'e1', role: 'lead' }, { person: 'Bob', eventId: 'e1', role: 's' },
      { person: 'Alice', eventId: 'e2', role: 'lead' }, { person: 'Bob', eventId: 'e2', role: 's' },
      { person: 'Alice', eventId: 'e3', role: 'lead' }, { person: 'Carol', eventId: 'e4', role: 'lead' },
    ],
    caseEdges: [{ eventId: 'e1', case: 'CaseA' }, { eventId: 'e2', case: 'CaseA' }, { eventId: 'e3', case: 'CaseA' }],
    objectEdges: [{ eventId: 'e1', object: 'Laptop' }, { eventId: 'e2', object: 'Laptop' }],
    personRelations: [], hubNarratives: [], hubAssessments: [],
    ...extra,
  }
}

describe('dossierFromHash / dossierHref', () => {
  it('來回：空白、斜線、#、%', () => {
    for (const name of ['A B', 'x/y', 'a#b', '100%', '中文 案/件#%']) {
      for (const kind of ['case', 'person', 'object'] as const) {
        expect(dossierFromHash(dossierHref(kind, name))).toEqual({ kind, name })
      }
    }
  })
  it('索引與不合法', () => {
    expect(dossierFromHash('#dossier')).toBe('index')
    expect(dossierFromHash('#dossier/')).toBe('index')
    expect(dossierFromHash('#dossier/event/x')).toBe('index')
    expect(dossierFromHash('#dossier/case')).toBe('index')
    expect(dossierFromHash('#dossier/case/')).toBe('index')
    expect(dossierFromHash('#dossier/case/%E0%A4%A')).toBe('index')
    expect(dossierFromHash('#knowledge')).toBeNull()
    expect(dossierFromHash('#dossierX')).toBeNull()
  })
})

describe('monthGroups', () => {
  const row = (id: string, date: string): TimelineRow => ({ id, date, title: id, status: null, case: null })
  it('新到舊、最近 3 個有事件的月份展開', () => {
    const g = monthGroups([row('a', '2026-01-02'), row('b', '2026-05-01'), row('c', '2026-03-01'), row('d', '2025-12-01'), row('e', '2026-05-09'), row('u', '')])
    expect(g.map(x => x.ym)).toEqual(['2026-05', '2026-03', '2026-01', '2025-12', ''])
    expect(g.map(x => x.open)).toEqual([true, true, true, false, false])
    expect(g[0].n).toBe(2)
    expect(g[0].rows.map(r => r.id)).toEqual(['e', 'b'])
  })
})

describe('relatedRanked', () => {
  const idx = buildIndex(graph())
  it('依共同事件數排序、排除自己', () => {
    const r = relatedRanked(idx, 'person', 'Alice')
    expect(r.find(x => x.name === 'Alice')).toBeUndefined()
    expect(r[0]).toEqual({ kind: 'case', name: 'CaseA', shared: 3 })
    expect(r[1]).toEqual({ kind: 'person', name: 'Bob', shared: 2 })
    expect(r[2]).toEqual({ kind: 'object', name: 'Laptop', shared: 2 })
  })
  it('案件與物件', () => {
    expect(relatedRanked(idx, 'case', 'CaseA').map(x => `${x.name}:${x.shared}`)).toEqual(['Alice:3', 'Bob:2', 'Laptop:2'])
    expect(relatedRanked(idx, 'object', 'Laptop', 1)).toEqual([{ kind: 'person', name: 'Alice', shared: 2 }])
  })
})

describe('egoGraph', () => {
  const many = (): Graph => {
    const people = Array.from({ length: 20 }, (_, i) => ({ name: `P${String(i).padStart(2, '0')}`, eventCount: 1 }))
    return graph({
      people: [{ name: 'Hub', eventCount: 20 }, ...people],
      events: Array.from({ length: 20 }, (_, i) => ({ id: `x${i}`, date: '2026-01-01', title: `X${i}`, status: null, tags: [], case: null })),
      edges: [
        ...Array.from({ length: 20 }, (_, i) => ({ person: 'Hub', eventId: `x${i}`, role: 'a' })),
        ...people.map((p, i) => ({ person: p.name, eventId: `x${i}`, role: 'b' })),
      ],
      caseEdges: [], objectEdges: [],
    })
  }
  it('上限 12、決定性座標', () => {
    const idx = buildIndex(many())
    const a = egoGraph(idx, 'person', 'Hub')
    const b = egoGraph(idx, 'person', 'Hub')
    expect(a.nodes).toHaveLength(12)
    expect(a.edges).toHaveLength(12)
    expect(a).toEqual(b)
    expect(a.nodes[0].x).toBeCloseTo(300, 1)
    expect(a.nodes[0].y).toBeCloseTo(60, 1)
    expect(new Set(a.nodes.map(n => `${n.x},${n.y}`)).size).toBe(12)
  })
})

describe('dossierSummary', () => {
  it('無敘事時用預設句；不存在回 null', () => {
    const idx = buildIndex(graph())
    const s = dossierSummary(idx, 'case', 'CaseA', idx.narrativesByHub)!
    expect(s.sentence).toBe('共 3 件事件，最近 2026-02-01')
    expect(s).toMatchObject({ title: 'CaseA', kindLabel: '案件', events: 3, first: '2026-01-01', last: '2026-02-01', people: 2 })
    expect(dossierSummary(idx, 'person', 'Nobody', idx.narrativesByHub)).toBeNull()
  })
  it('有敘事用最近一則', () => {
    const idx = buildIndex(graph({ hubNarratives: [
      { hub: 'CaseA', kind: 'case', date: '2026-01-01', type: 'weave', text: '舊' },
      { hub: 'CaseA', kind: 'case', date: '2026-02-01', type: 'weave', text: '新' },
    ] }))
    expect(dossierSummary(idx, 'case', 'CaseA', idx.narrativesByHub)!.sentence).toBe('新')
  })
})

describe('dossierIndex', () => {
  it('依事件數排名、混合案件與人物', () => {
    const idx = buildIndex(graph())
    const r = dossierIndex(idx)
    expect(r.map(x => `${x.kind}:${x.name}:${x.events}`)).toEqual(['person:Alice:3', 'case:CaseA:3', 'person:Bob:2', 'person:Carol:1'])
    expect(r[1].last).toBe('2026-02-01')
    expect(dossierIndex(idx, 2)).toHaveLength(2)
  })
})

describe('relatedTopics', () => {
  it('案件比對 caseName；沒有資料回空', () => {
    expect(relatedTopics(null, 'case', 'A')).toEqual([])
    const n = { computedAt: '', date: '', recall: [], matches: [
      { forDate: '', topicId: 't1', name: 'N1', path: [], published: true, point: 'p', triggers: [], score: 1, caseName: 'A' },
      { forDate: '', topicId: 't1', name: 'N1', path: [], published: true, point: 'p', triggers: [], score: 1, caseName: 'A' },
    ] }
    expect(relatedTopics(n, 'case', 'A')).toHaveLength(1)
    expect(relatedTopics(n, 'case', 'B')).toEqual([])
  })
})
