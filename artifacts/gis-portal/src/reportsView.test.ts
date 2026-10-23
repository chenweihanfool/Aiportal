import { describe, expect, it } from 'vitest'
import type { PeriodReport } from './periodStats'
import { barPct, cellLevel, delta, funnelRows, ganttBars, isEmptyReport, levelOf, pinPositions, rhythmCells, tipText, topCounts } from './reportsView'
import type { SeriesRow } from './periodStats'

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
  it('levelOf：以最大值為基準分三階', () => {
    expect([0, 1, 5, 10].map((n) => levelOf(n, 10))).toEqual([0, 1, 2, 3])
    expect(levelOf(3, 0)).toBe(0)
  })
  it('tipText：逐項列出、超過 8 項寫「另 N 項」、沒有就寫沒有紀錄', () => {
    expect(tipText('10/20 想法 2', ['甲', '乙'])).toBe('10/20 想法 2\n• 甲\n• 乙')
    expect(tipText('10/20 美食 0', [])).toBe('10/20 美食 0：沒有紀錄')
    const many = Array.from({ length: 11 }, (_, i) => `想法${i}`)
    expect(tipText('x', many).split('\n').slice(-1)[0]).toBe('…另 3 項')
  })
})

describe('rhythmCells（活動節奏的格子與提示）', () => {
  const row = (date: string, over: Partial<SeriesRow> = {}): SeriesRow => ({ date, ideas: 0, food: 0, travel: 0, ideaTitles: [], foodNames: [], tripNames: [], ...over })
  const days = Array.from({ length: 14 }, (_, i) => row(`2026-10-${String(i + 1).padStart(2, '0')}`))
  it('日報不畫節奏；沒資料不畫', () => {
    expect(rhythmCells(days, 'day').cells).toEqual([])
    expect(rhythmCells([], 'week').cells).toEqual([])
  })
  it('週／月：一天一格，提示列出當天具體是哪些想法', () => {
    const s = [row('2026-10-19', { ideas: 2, ideaTitles: ['想法甲', '想法乙'] }), row('2026-10-20')]
    const { cells, aggregated } = rhythmCells(s, 'week')
    expect(aggregated).toBe(false)
    expect(cells[0]!.label).toBe('19')
    expect(cells[0]!.tips.ideas).toBe('10-19 想法 2\n• 想法甲\n• 想法乙')
    expect(cells[1]!.tips.ideas).toBe('10-20 想法 0：沒有紀錄')
  })
  it('季：每 7 天一格並合併名稱；年：每月一格', () => {
    const q = rhythmCells(days, 'quarter')
    expect(q.aggregated).toBe(true)
    expect(q.cells).toHaveLength(2)
    expect(q.cells[0]!.label).toBe('10/01')
    const withIdea = days.map((d, i) => (i === 2 || i === 4 ? { ...d, ideas: 1, ideaTitles: [`想法${i}`] } : d))
    const c = rhythmCells(withIdea, 'quarter').cells[0]!
    expect(c.ideas).toBe(2)
    expect(c.tips.ideas).toContain('• 想法2')
    expect(c.tips.ideas).toContain('• 想法4')
    const y = rhythmCells([row('2026-01-31'), row('2026-02-01', { food: 1, foodNames: ['老王（吃過）'] })], 'year')
    expect(y.cells.map((x) => x.label)).toEqual(['1月', '2月'])
    expect(y.cells[1]!.tips.food).toContain('老王（吃過）')
  })
  it('旅程提示的趟次名稱不重複', () => {
    const s = [row('2026-10-01', { travel: 1, tripNames: ['台南旅遊'] }), row('2026-10-02', { travel: 1, tripNames: ['台南旅遊'] })]
    expect(rhythmCells(s, 'quarter').cells[0]!.tips.travel).toBe('10-01～10-02 旅程\n• 台南旅遊')
  })
})
