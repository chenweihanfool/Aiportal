import { describe, expect, it } from 'vitest'
import type { PeriodReport } from './periodStats'
import { barPct, cellLevel, delta, funnelRows, ganttBars, isEmptyReport, pinPositions, topCounts } from './reportsView'

const mkReport = (over: Partial<PeriodReport> = {}): PeriodReport => ({
  range: ['2026-10-19', '2026-10-25'], partial: false,
  ideas: { new: 0, done: 0, started: 0, openAtEnd: 0, doneRate: null, funnel: { new: 0, evaluating: 0, doing: 0, done: 0 }, byCategory: {}, top3: [], oldestOpen: null },
  food: { added: 0, visited: 0, wantBacklog: 0, avgRating: null, byCuisine: {}, byArea: {}, pins: [], oldestWant: null },
  travel: { trips: [], tripDays: 0, photos: 0, areas: [] },
  prev: { range: ['2026-10-12', '2026-10-18'], ideas: { new: 0, done: 0 }, food: { added: 0, visited: 0 }, travel: { tripDays: 0, trips: 0 } },
  series: [], ...over,
})

describe('reportsView（圖表純函式）', () => {
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
    expect(isEmptyReport(mkReport())).toBe(true)
    expect(isEmptyReport(mkReport({ travel: { trips: [], tripDays: 2, photos: 0, areas: [] } }))).toBe(false)
  })
})
