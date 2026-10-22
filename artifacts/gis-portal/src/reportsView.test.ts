import { describe, expect, it } from 'vitest'
import { parseReport, parseReportsFeed } from './reportsApi'
import { barPct, cellLevel, delta, funnelRows, ganttBars, isEmptyReport, periodLabel, pinPositions, reportsOf, topCounts } from './reportsView'

const base = { period: 'week', range: ['2026-10-19', '2026-10-25'] }

describe('parseReport', () => {
  it('缺欄位一律當 0／空，不丟例外', () => {
    const r = parseReport(base)!
    expect(r.ideas.new).toBe(0)
    expect(r.ideas.funnel).toEqual({ new: 0, evaluating: 0, doing: 0, done: 0 })
    expect(r.food.pins).toEqual([])
    expect(r.travel.trips).toEqual([])
    expect(r.series).toEqual([])
    expect(r.partial).toBe(false)
  })
  it('壞的週期或區間 → null', () => {
    expect(parseReport({ period: 'decade', range: ['a', 'b'] })).toBeNull()
    expect(parseReport({ period: 'week', range: ['2026-10-19'] })).toBeNull()
    expect(parseReport(null)).toBeNull()
  })
  it('濾掉壞的釘子、趟次與逐日列', () => {
    const r = parseReport({
      ...base,
      food: { pins: [{ name: 'a', lat: 25, lng: 121, status: 'visited' }, { name: 'b', lat: 'x', lng: 1 }, { lat: 1, lng: 2, status: '怪' }] },
      travel: { trips: [{ id: 'T1', title: '台南', start: '2026-10-15', end: '2026-10-17', daysInPeriod: 2 }, { title: '沒有 id' }] },
      series: [{ date: '2026-10-19', ideas: 1 }, { ideas: 5 }],
    })!
    expect(r.food.pins.map((p) => [p.name, p.status])).toEqual([['a', 'visited'], ['—', 'want']])
    expect(r.travel.trips).toHaveLength(1)
    expect(r.series).toEqual([{ date: '2026-10-19', ideas: 1, food: 0, travel: 0 }])
  })
})

describe('parseReportsFeed', () => {
  it('還沒推送過 → null', () => {
    expect(parseReportsFeed({ available: false, payload: null })).toBeNull()
    expect(parseReportsFeed({ available: true, payload: { reports: [] } })).toBeNull()
  })
  it('壞掉的報告被略過，其餘照留', () => {
    const f = parseReportsFeed({ available: true, payload: { computedAt: '2026-10-22T10:00:00', reports: [base, { period: 'x' }], warnings: ['a', 3] } })!
    expect(f.reports).toHaveLength(1)
    expect(f.warnings).toEqual(['a'])
  })
})

describe('reportsView', () => {
  it('reportsOf 依週期過濾並新到舊', () => {
    const mk = (period: string, s: string) => parseReport({ period, range: [s, s] })!
    const list = [mk('week', '2026-10-12'), mk('month', '2026-10-01'), mk('week', '2026-10-19')]
    expect(reportsOf(list, 'week').map((r) => r.range[0])).toEqual(['2026-10-19', '2026-10-12'])
  })
  it('periodLabel', () => {
    expect(periodLabel({ period: 'week', range: ['2026-10-19', '2026-10-25'] })).toBe('10/19–10/25')
    expect(periodLabel({ period: 'month', range: ['2026-09-01', '2026-09-30'] })).toBe('2026 年 9 月')
  })
  it('delta：多、少、持平', () => {
    expect(delta(5, 3)).toEqual({ text: '▲ 2（上期 3）', tone: 'up' })
    expect(delta(1, 4)).toEqual({ text: '▼ 3（上期 4）', tone: 'down' })
    expect(delta(2, 2)).toEqual({ text: '與上期持平', tone: 'flat' })
  })
  it('barPct：最大 100、很小的至少 4、0 就是 0', () => {
    expect(barPct(10, 10)).toBe(100)
    expect(barPct(1, 100)).toBe(4)
    expect(barPct(0, 10)).toBe(0)
    expect(barPct(5, 0)).toBe(0)
  })
  it('funnelRows 以最大那階為 100%', () => {
    const rows = funnelRows({ new: 4, evaluating: 2, doing: 0, done: 1 })
    expect(rows.map((r) => r.pct)).toEqual([100, 50, 0, 25])
    expect(rows[0]!.label).toContain('新想法')
  })
  it('topCounts：由大到小、同數量依名稱、略過 0、最多 n 筆', () => {
    const rows = topCounts({ 咖啡: 1, 牛肉麵: 3, 拉麵: 1, 空: 0 }, 2)
    expect(rows.map((r) => r.label)).toEqual(['牛肉麵', '咖啡'])
    expect(rows[0]!.pct).toBe(100)
  })
  it('cellLevel', () => {
    expect([0, 1, 2, 3, 9].map(cellLevel)).toEqual([0, 1, 2, 3, 3])
  })
  it('pinPositions：北在上、單點置中、同緯度置中', () => {
    const [a, b] = pinPositions([{ name: 'n', lat: 25.1, lng: 121.0, status: 'want' }, { name: 's', lat: 25.0, lng: 121.5, status: 'want' }], 100, 100, 10)
    expect(a!.y).toBeLessThan(b!.y)
    expect(a!.x).toBeLessThan(b!.x)
    expect(pinPositions([{ name: 'x', lat: 1, lng: 2, status: 'want' }], 100, 60)[0]).toMatchObject({ x: 50, y: 30 })
    expect(pinPositions([], 100, 100)).toEqual([])
  })
  it('ganttBars：超出本期的部分裁掉', () => {
    const bars = ganttBars([{ id: 'T', title: '台南', start: '2026-10-15', end: '2026-10-21', daysInPeriod: 3, photos: 0, area: null }], ['2026-10-19', '2026-10-25'])
    expect(bars[0]!.leftPct).toBe(0)
    expect(bars[0]!.widthPct).toBeCloseTo((3 / 7) * 100)
    expect(ganttBars([], ['2026-10-19', '2026-10-25'])).toEqual([])
  })
  it('isEmptyReport', () => {
    expect(isEmptyReport(parseReport(base)!)).toBe(true)
    expect(isEmptyReport(parseReport({ ...base, travel: { tripDays: 2 } })!)).toBe(false)
  })
})
