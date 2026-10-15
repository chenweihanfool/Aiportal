import { describe, expect, it } from 'vitest'
import { deltaText, dimHash, dimKeyFromHash, dimNeighbors, rangeStats } from './dimensionPage'
import { dimensionSeries } from './homeView'

const hist = (vals: Array<number | null>, end = '2026-10-16') => {
  const d = new Date(`${end}T00:00:00Z`)
  return vals.map((v, i) => {
    const x = new Date(d.getTime() - (vals.length - 1 - i) * 86400e3).toISOString().slice(0, 10)
    return { date: x, components: { calm: v } as Record<string, number | null> }
  })
}

describe('rangeStats', () => {
  it('avg/max/min/change over the valid points, skipping gaps', () => {
    const s = dimensionSeries(hist([60, null, 70, 80, 50, 90]), 'calm', '2026-10-16', 6)
    const r = rangeStats(s)!
    expect(r.count).toBe(5)
    expect(r.avg).toBe(70)
    expect(r.max).toEqual({ date: '2026-10-16', value: 90 })
    expect(r.min).toEqual({ date: '2026-10-15', value: 50 })
    expect(r.change).toBe(30)
    expect(r.firstDate).toBe('2026-10-11')
  })
  it('null series → null', () => {
    expect(rangeStats(null)).toBeNull()
    expect(rangeStats(dimensionSeries(hist([null, null, 5]), 'calm', '2026-10-16', 3))).toBeNull() // 少於 2 個有效點
  })
  it('ties pick the first max and the first min', () => {
    const r = rangeStats(dimensionSeries(hist([70, 70, 60, 60]), 'calm', '2026-10-16', 4))!
    expect(r.max.date).toBe('2026-10-13')
    expect(r.min.date).toBe('2026-10-15')
  })
})

describe('hash helpers', () => {
  it('parses only known dimension keys', () => {
    expect(dimKeyFromHash('#dim/calm')).toBe('calm')
    expect(dimKeyFromHash('#dim/lifeFreedom')).toBe('lifeFreedom')
    expect(dimKeyFromHash('#dim/nope')).toBeNull()
    expect(dimKeyFromHash('#dim/')).toBeNull()
    expect(dimKeyFromHash('#dim/calm/extra')).toBeNull()
    expect(dimKeyFromHash('#trips/calm')).toBeNull()
    expect(dimHash('mind')).toBe('dim/mind')
  })
  it('neighbors wrap around', () => {
    expect(dimNeighbors('lifeFreedom')).toEqual({ prev: 'travel', next: 'fitness' })
    expect(dimNeighbors('travel')).toEqual({ prev: 'social', next: 'lifeFreedom' })
    expect(dimNeighbors('x')).toBeNull()
  })
  it('deltaText', () => {
    expect(deltaText(3)).toBe('▲ 3')
    expect(deltaText(-2)).toBe('▼ 2')
    expect(deltaText(0)).toBe('— 持平')
    expect(deltaText(null)).toBeNull()
  })
})
