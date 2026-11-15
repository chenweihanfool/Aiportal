import { describe, expect, it } from 'vitest'
import { insightsForIdea, insightsForPerson, rootPaths, rootTargets } from './insightLinks'
import type { Insight, InsightData, InsightIdeaLink, InsightPersonLink, InsightRelation } from './insightTree'

function mk(id: string, date: string, o: { time?: string | null; relation?: InsightRelation; people?: InsightPersonLink[]; ideas?: InsightIdeaLink[] } = {}): Insight {
  return { id, date, time: o.time ?? null, text: id, provenance: 'diary', cluster: 'c', thread: 't', relation: o.relation ?? 'new', parent: null, links: { people: o.people ?? [], ideas: o.ideas ?? [], topics: [] } } as Insight
}
const data = (insights: Insight[]): InsightData => ({ total: insights.length, thisMonth: 0, clusters: [], insights })
const P = (name: string, sameSegment = false): InsightPersonLink => ({ id: name, name, dossier: name, sameSegment })
const I = (id: string, mentioned = false): InsightIdeaLink => ({ id, title: `想法${id}`, mentioned })

describe('insightsForPerson', () => {
  it('null 與沒有符合的回空', () => {
    expect(insightsForPerson(null, '甲')).toEqual([])
    expect(insightsForPerson(data([mk('a', '2026-01-01')]), '甲')).toEqual([])
  })
  it('依 dossier 比對、新到舊、最多 10', () => {
    const list = Array.from({ length: 12 }, (_, k) => mk(`i${k}`, `2026-01-${String(k + 1).padStart(2, '0')}`, { people: [P('甲')] }))
    list.push(mk('other', '2026-02-01', { people: [{ id: 'x', name: '甲', dossier: null, sameSegment: false }] }))
    const r = insightsForPerson(data(list), '甲')
    expect(r).toHaveLength(10)
    expect(r[0]!.id).toBe('i11')
  })
  it('同日用 time、再用 id', () => {
    const r = insightsForPerson(data([mk('a', '2026-01-01', { time: '09:00', people: [P('甲')] }), mk('b', '2026-01-01', { time: '10:00', people: [P('甲')] }), mk('c', '2026-01-01', { time: '10:00', people: [P('甲')] })]), '甲')
    expect(r.map((x) => x.id)).toEqual(['c', 'b', 'a'])
  })
})

describe('insightsForIdea', () => {
  it('推翻與其他分組、各最多 5', () => {
    const list = [
      ...Array.from({ length: 7 }, (_, k) => mk(`c${k}`, `2026-01-0${k + 1}`, { relation: k % 2 ? 'reinforce' : 'new', ideas: [I('x')] })),
      mk('o1', '2026-03-01', { relation: 'overturn', ideas: [I('x')] }),
      mk('z', '2026-03-02', { ideas: [I('y')] }),
    ]
    const r = insightsForIdea(data(list), 'x')
    expect(r.confirm).toHaveLength(5)
    expect(r.confirm[0]!.id).toBe('c6')
    expect(r.overturn.map((x) => x.id)).toEqual(['o1'])
    expect(insightsForIdea(null, 'x')).toEqual({ confirm: [], overturn: [] })
  })
})

describe('rootTargets', () => {
  it('同段與有提到優先、超過上限計 more', () => {
    const ins = mk('a', '2026-01-01', { people: [P('1'), P('2'), P('3', true), P('4'), P('5'), P('6', true)], ideas: [I('a'), I('b', true), I('c'), I('d'), I('e', true)] })
    const r = rootTargets(ins)
    expect(r.people.map((p) => p.name)).toEqual(['3', '6', '1', '2'])
    expect(r.ideas.map((p) => p.id)).toEqual(['b', 'e', 'a'])
    expect(r.morePeople).toBe(2)
    expect(r.moreIdeas).toBe(2)
  })
  it('沒有連結全空', () => {
    expect(rootTargets(mk('a', '2026-01-01'))).toEqual({ people: [], ideas: [], morePeople: 0, moreIdeas: 0 })
  })
})

describe('rootPaths', () => {
  it('n=0 回空', () => { expect(rootPaths(100, 300, 0)).toEqual([]) })
  it('末端在範圍內、y 在 depth 的 0.55～0.9、d 從原點出發', () => {
    for (const n of [1, 2, 5, 9]) {
      const r = rootPaths(120, 300, n, 56)
      expect(r).toHaveLength(n)
      for (const p of r) {
        expect(p.x).toBeGreaterThanOrEqual(0)
        expect(p.x).toBeLessThanOrEqual(300)
        expect(p.y).toBeGreaterThanOrEqual(56 * 0.55)
        expect(p.y).toBeLessThanOrEqual(56 * 0.9)
        expect(p.d.startsWith('M120,0 C')).toBe(true)
      }
    }
  })
  it('窄寬度與原點越界不超出，同輸入同輸出', () => {
    const r = rootPaths(-50, 20, 3)
    for (const p of r) { expect(p.x).toBeGreaterThanOrEqual(0); expect(p.x).toBeLessThanOrEqual(20) }
    expect(rootPaths(10, 200, 4)).toEqual(rootPaths(10, 200, 4))
  })
})
