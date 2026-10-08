import { describe, expect, it } from 'vitest'
import { balanceChartGeometry, biggestDrag, buildHhiBreakdown, dailyBars, formatCalls, formatEmptyDay, formatUsd } from './boardView'

const data = {
  displayedScore: 72, baseScore: 74.5, weakestScore: 55, finalScore: 73, weakestComponent: '旅遊生活', isSnapshotFinal: true, usingStaleData: false,
  lifeFreedomScore: 68, fitnessHabitScore: 81, calmScore: 74, mindScore: 79, socialScore: 77, travelScore: 55,
  weights: { lifeFreedomWeight: 0.27, fitnessWeight: 0.18, calmWeight: 0.15, mindWeight: 0.15, socialWeight: 0.13, travelWeight: 0.12 },
}

describe('buildHhiBreakdown', () => {
  it('spreads each dimension into score × weight = points, summing to the base score', () => {
    const b = buildHhiBreakdown(data)!
    expect(b.rows.map((r) => r.label)).toEqual(['人生自由', '健身習慣', '生活從容', '心智指標', '社交指標', '旅遊生活'])
    expect(b.rows[0]).toMatchObject({ value: 68, weightPct: 27, points: 18.4 })
    expect(b.pointsSum).toBeCloseTo(18.4 + 14.6 + 11.1 + 11.9 + 10.0 + 6.6, 1)
    expect(b.base).toBe(74.5)
    expect(b.afterPenalty).toBe(73)
    expect(b.displayed).toBe(72)
    expect(b.hasMissing).toBe(false)
  })
  it('falls back to the default weights when the backend sends none', () => {
    const b = buildHhiBreakdown({ displayedScore: 60, lifeFreedomScore: 50 })!
    expect(b.rows.map((r) => r.weightPct)).toEqual([27, 18, 15, 15, 13, 12])
    expect(b.hasMissing).toBe(true)
    expect(b.rows[1]!.points).toBeNull()
  })
  it('returns null without a displayed score', () => {
    expect(buildHhiBreakdown(undefined)).toBeNull()
    expect(buildHhiBreakdown({})).toBeNull()
  })
})

describe('biggestDrag', () => {
  it('picks the row with the largest weighted gap to 100', () => {
    const b = buildHhiBreakdown(data)!
    // 人生自由 (100-68)*27% = 8.64 > 旅遊 (100-55)*12% = 5.4
    expect(biggestDrag(b.rows)!.label).toBe('人生自由')
  })
  it('ignores rows without a score and returns null when everything is 100', () => {
    expect(biggestDrag([{ key: 'a', label: 'a', value: null, weightPct: 10, points: null }])).toBeNull()
    expect(biggestDrag([{ key: 'a', label: 'a', value: 100, weightPct: 10, points: 10 }])).toBeNull()
  })
})

describe('formatters', () => {
  it('formats money, call counts and the empty day', () => {
    expect(formatUsd(29.31)).toBe('$29.31')
    expect(formatUsd(null)).toBe('—')
    expect(formatCalls(1300)).toBe('1300')
    expect(formatCalls(19794)).toBe('19.8k')
    expect(formatEmptyDay('2026-10-20', 12.04)).toBe('10/20（約 12 天）')
    expect(formatEmptyDay('2026-10-12', 4.26)).toBe('10/12（約 4.3 天）')
    expect(formatEmptyDay(null, null)).toBe('—')
  })
})

describe('balanceChartGeometry', () => {
  const base = { now: new Date('2026-10-08T12:00:00Z'), width: 400, height: 100, pad: { l: 10, r: 10, t: 10, b: 10 }, capUsd: 60 }
  it('puts today and the refill marker on one scale and draws the forecast down to zero', () => {
    const g = balanceChartGeometry({ ...base, entries: [{ enteredAt: '2026-10-08T04:00:00Z', balanceUsd: 30 }], balanceUsd: 30, usdPerDay: 2.5, daysUntilEmpty: 12, daysToRefill: 21 })
    expect(g.refillX).toBeGreaterThan(g.todayX)
    expect(g.forecast!.y2).toBeGreaterThan(g.forecast!.y1)
    expect(g.zero).not.toBeNull()
    expect(g.zero!.x).toBeLessThan(g.refillX!)
    expect(g.dots).toHaveLength(1)
    expect(g.yTicks).toHaveLength(5)
    expect(g.yTicks[0]!.v).toBe(0)
    expect(g.yTicks[4]!.v).toBe(60)
  })
  it('does not draw a zero point when the balance outlasts the window', () => {
    const g = balanceChartGeometry({ ...base, entries: [], balanceUsd: 55, usdPerDay: 1, daysUntilEmpty: 55, daysToRefill: 21 })
    expect(g.zero).toBeNull()
    expect(g.forecast).not.toBeNull()
  })
  it('draws nothing for the forecast without a burn rate', () => {
    const g = balanceChartGeometry({ ...base, entries: [], balanceUsd: 30, usdPerDay: null, daysUntilEmpty: null, daysToRefill: null })
    expect(g.forecast).toBeNull()
    expect(g.refillX).toBeNull()
  })
  it('keeps every drawn coordinate inside the chart bounds', () => {
    const g = balanceChartGeometry({ ...base, entries: [{ enteredAt: '2026-10-08T04:00:00Z', balanceUsd: 400 }], balanceUsd: 400, usdPerDay: 50, daysUntilEmpty: 8, daysToRefill: 21 })
    for (const p of [...g.dots, g.forecast && { x: g.forecast.x2, y: g.forecast.y2 }, g.zero].filter(Boolean) as Array<{ x: number; y: number }>) {
      expect(p.x).toBeGreaterThanOrEqual(0)
      expect(p.x).toBeLessThanOrEqual(400)
      expect(p.y).toBeGreaterThanOrEqual(0)
      expect(p.y).toBeLessThanOrEqual(100)
    }
  })
})

describe('dailyBars', () => {
  it('scales to the tallest day and never divides by zero', () => {
    const b = dailyBars([{ date: 'a', calls: 50 }, { date: 'b', calls: 100 }])
    expect(b.map((x) => x.ratio)).toEqual([0.5, 1])
    expect(dailyBars([{ date: 'a', calls: 0 }])[0]!.ratio).toBe(0)
    expect(dailyBars([], 14)).toEqual([])
  })
  it('keeps only the last n days', () => {
    const days = Array.from({ length: 20 }, (_, i) => ({ date: String(i), calls: i }))
    expect(dailyBars(days, 14)).toHaveLength(14)
    expect(dailyBars(days, 14)[0]!.date).toBe('6')
  })
})
