import { describe, expect, it } from 'vitest'
import { deltaText, dimHash, dimHref, dimKeyFromHash, dimNeighbors, dimOverview, rangeStats, recentDigest } from './dimensionPage'
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
    expect(dimHref('mind')).toBe('#dim/mind')
    expect(dimKeyFromHash(dimHref('lifeFreedom'))).toBe('lifeFreedom')
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

describe('dimOverview', () => {
  const rows = [
    { key: 'calm', label: '從容', value: 60, weightPct: 15, points: 9 },
    { key: 'mind', label: '心智', value: null, weightPct: 15, points: null },
  ]
  it('gap = weight × (100 − value); gain10 for the current dimension', () => {
    const o = dimOverview(rows, 'calm')
    expect(o.rows[0]!.gap).toBe(6)
    expect(o.rows[1]!.gap).toBeNull()
    expect(o.gain10).toBe(1.5)
  })
  it('unknown key → gain10 null', () => {
    expect(dimOverview(rows, 'nope').gain10).toBeNull()
  })
})

describe('recentDigest', () => {
  it('last7 vs prev7, rank, streak above the 90-day average', () => {
    // 14 天：前 7 天都 40、近 7 天都 80（今天 2026-10-16）
    const r = recentDigest(hist([40, 40, 40, 40, 40, 40, 40, 80, 80, 80, 80, 80, 80, 80]), 'calm', '2026-10-16')!
    expect(r.last7).toBe(80)
    expect(r.prev7).toBe(40)
    expect(r.weekChange).toBe(40)
    expect(r.avg90).toBe(60)
    expect(r.rank).toEqual({ pos: 1, of: 14, date: '2026-10-16', value: 80 })
    expect(r.streak).toEqual({ side: 'above', days: 7 })
  })
  it('a gap breaks the streak; ties share the rank', () => {
    const r = recentDigest(hist([90, 10, null, 20, 20]), 'calm', '2026-10-16')!
    expect(r.streak).toEqual({ side: 'below', days: 2 })
    expect(r.rank.pos).toBe(2)
    expect(r.prev7).toBeNull()
    expect(r.weekChange).toBeNull()
  })
  it('weekday pattern needs ≥4 weekdays with ≥2 points', () => {
    expect(recentDigest(hist([50, 60, 70]), 'calm', '2026-10-16')!.weekday).toBeNull()
    // 2026-10-16 是週五；21 天，每個星期幾 3 筆，值＝星期幾 × 10（週日 0、週六 60）
    const vals = Array.from({ length: 21 }, (_, i) => new Date(Date.UTC(2026, 9, 16 - 20 + i)).getUTCDay() * 10)
    const w = recentDigest(hist(vals), 'calm', '2026-10-16')!.weekday!
    expect(w.best).toEqual({ day: '六', avg: 60 })
    expect(w.worst).toEqual({ day: '日', avg: 0 })
  })
  it('ignores dates outside 90 days and needs 2 points', () => {
    expect(recentDigest(hist([50]), 'calm', '2026-10-16')).toBeNull()
    expect(recentDigest(null, 'calm', '2026-10-16')).toBeNull()
    const old = [{ date: '2026-01-01', components: { calm: 100 } }, ...hist([30, 50])]
    expect(recentDigest(old, 'calm', '2026-10-16')!.rank.of).toBe(2)
  })
})
