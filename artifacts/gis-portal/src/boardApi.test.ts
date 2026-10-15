import { describe, expect, it } from 'vitest'
import { parseHhiComponents, parseHhiHistory } from './boardApi'

const comps = { lifeFreedom: 70, fitness: 55.5, calm: null, mind: 40, social: 0, travel: 100 }

describe('parseHhiComponents', () => {
  it('keeps finite numbers and null (null is "no data", 0 is a real score)', () => {
    expect(parseHhiComponents(comps)).toEqual(comps)
  })
  it('drops bad values but keeps the good ones', () => {
    expect(parseHhiComponents({ calm: 'x', mind: 40, fitness: NaN, social: undefined, travel: {} })).toEqual({ mind: 40 })
  })
  it('treats missing, non-object, array or empty as no components', () => {
    for (const bad of [undefined, null, 'x', 5, [], [1, 2], {}, { a: 'b' }]) expect(parseHhiComponents(bad)).toBeUndefined()
  })
})

describe('parseHhiHistory', () => {
  it('old API (no components) parses exactly as before', () => {
    const d = { history: [{ date: '2026-10-14', finalScore: 60, displayedScore: 61, weakestComponent: '生活從容' }] }
    expect(parseHhiHistory(d)).toEqual([{ date: '2026-10-14', displayedScore: 61 }])
    expect('components' in parseHhiHistory(d)[0]!).toBe(false)
  })
  it('carries components through when valid, per point', () => {
    const d = { history: [
      { date: '2026-10-14', displayedScore: 61, components: comps },
      { date: '2026-10-15', displayedScore: 62, components: 'oops' },
      { date: '2026-10-16', displayedScore: 63 },
    ] }
    expect(parseHhiHistory(d)).toEqual([
      { date: '2026-10-14', displayedScore: 61, components: comps },
      { date: '2026-10-15', displayedScore: 62 },
      { date: '2026-10-16', displayedScore: 63 },
    ])
  })
  it('still drops points whose displayedScore is not a number, and tolerates bad payloads', () => {
    expect(parseHhiHistory({ history: [{ date: 'a', displayedScore: '5' }, null, { date: 'b', displayedScore: 7 }] })).toEqual([{ date: 'b', displayedScore: 7 }])
    for (const bad of [null, undefined, {}, { history: 'x' }, []]) expect(parseHhiHistory(bad)).toEqual([])
  })
})
