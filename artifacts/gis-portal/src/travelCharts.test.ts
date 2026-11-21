import { describe, expect, it } from 'vitest'
import type { FoodPlace } from './foodMap'
import type { Trip } from './tripsApi'
import {
  COUNTIES, buildCalendar, buildFootprint, countyOf, daysSinceLastTrip, footprintLevel, nextTrip, sameDayLastYear, travelDayMap,
} from './travelCharts'

const trip = (id: string, start: string, end: string, status: Trip['status'] = 'done', placeIds: string[] = []): Trip => ({
  id, name: `趟${id}`, start, end, status, area: null, summary: null, cover: null, placeIds, days: [],
})
const place = (id: string, o: Partial<FoodPlace> = {}): FoodPlace => ({
  id, name: id, area: null, address: null, lat: null, lng: null, cuisine: null, tags: [], status: 'want', priceLevel: null, why: null,
  source: null, mustTry: [], rating: null, addedAt: '2026-01-01', visitedAt: null, days: [], mapUrl: null, kind: 'food', photos: [], ...o,
})

describe('旅行日展開', () => {
  it('跨年趟次兩年都算，planned 排除', () => {
    const m = travelDayMap([trip('a', '2025-12-30', '2026-01-02'), trip('p', '2026-03-01', '2026-03-03', 'planned')])
    expect([...m.keys()]).toEqual(['2025-12-30', '2025-12-31', '2026-01-01', '2026-01-02'])
    expect(m.has('2026-03-01')).toBe(false)
  })
  it('同日多趟依 start 排序，第一趟在前', () => {
    const m = travelDayMap([trip('b', '2026-05-02', '2026-05-03'), trip('a', '2026-05-01', '2026-05-02')])
    expect(m.get('2026-05-02')!.map((t) => t.id)).toEqual(['a', 'b'])
  })
  it('日曆：週日在上、跨年只算今年那段、planned 另列、今天標記、美食小點', () => {
    const cal = buildCalendar(
      [trip('a', '2025-12-30', '2026-01-02'), trip('p', '2026-03-01', '2026-03-03', 'planned')],
      [place('f1', { status: 'visited', visitedAt: '2026-01-02', days: ['2026-01-10'] }), place('f2', { status: 'want', visitedAt: '2026-01-11' })],
      '2026-02-10',
    )
    expect(cal.year).toBe(2026)
    expect(cal.weeks.every((w) => w.length === 7)).toBe(true)
    // 2026-01-01 是週四 → 第一欄前 4 格空
    expect(cal.weeks[0]!.slice(0, 4)).toEqual([null, null, null, null])
    expect(cal.weeks[0]![4]!.date).toBe('2026-01-01')
    const cells = cal.weeks.flat().filter((c) => c)
    expect(cells).toHaveLength(365)
    const by = (d: string) => cells.find((c) => c!.date === d)!
    expect(by('2026-01-02').trips[0]!.id).toBe('a')
    expect(by('2026-01-02').food).toBe(true)
    expect(by('2026-01-10').food).toBe(true)
    expect(by('2026-01-11').food).toBe(false)
    expect(by('2026-03-02').trips).toHaveLength(0)
    expect(by('2026-03-02').planned[0]!.id).toBe('p')
    expect(by('2026-02-10').today).toBe(true)
    expect(cells.filter((c) => c!.today)).toHaveLength(1)
    expect(cal.daysThisYear).toBe(2)
  })
  it('去年同期天數（含 2/29 退 2/28）', () => {
    const trips = [trip('x', '2025-01-05', '2025-01-07'), trip('y', '2025-06-01', '2025-06-05'), trip('z', '2026-01-01', '2026-01-01')]
    const cal = buildCalendar(trips, [], '2026-02-10')
    expect(cal.daysLastYear).toBe(3)
    expect(cal.daysThisYear).toBe(1)
    expect(buildCalendar(trips, [], '2026-06-03').daysLastYear).toBe(6)
    expect(sameDayLastYear('2028-02-29')).toBe('2027-02-28')
  })
})

describe('距上次與下一趟', () => {
  const trips = [trip('a', '2026-01-01', '2026-01-03'), trip('b', '2026-02-20', '2026-02-22', 'planned'), trip('c', '2026-03-10', '2026-03-12', 'planned')]
  it('距上次旅行', () => {
    expect(daysSinceLastTrip(trips, '2026-01-13')).toBe(10)
    expect(daysSinceLastTrip(trips, '2026-01-02')).toBe(0)
    expect(daysSinceLastTrip([], '2026-01-02')).toBeNull()
    expect(daysSinceLastTrip([trip('p', '2026-02-01', '2026-02-02', 'planned')], '2026-01-02')).toBeNull()
  })
  it('下一趟倒數', () => {
    const n = nextTrip(trips, '2026-02-10')!
    expect(n.trip.id).toBe('b')
    expect(n.inDays).toBe(10)
    expect(nextTrip(trips, '2026-03-12')).toBeNull()
  })
})

describe('countyOf', () => {
  const c = (address: string | null, area: string | null = null) => countyOf({ address, area })
  it('台／臺視為同字，回傳統一用「台」', () => {
    expect(c('臺北市大安區忠孝東路')).toBe('台北市')
    expect(c('台北市大安區')).toBe('台北市')
    expect(c('臺南市中西區')).toBe('台南市')
  })
  it('簡稱與全名', () => {
    expect(c(null, '台北 大安')).toBe('台北市')
    expect(c(null, '新北 板橋')).toBe('新北市')
    expect(c(null, '桃園 中壢')).toBe('桃園市')
    expect(c(null, '高雄 左營')).toBe('高雄市')
    expect(c(null, '花蓮縣')).toBe('花蓮縣')
    expect(c('100台北市中正區')).toBe('台北市')
    expect(c(null, '新竹市 東區')).toBe('新竹市')
    expect(c(null, '嘉義縣 太保')).toBe('嘉義縣')
    expect(c(null, '新竹 東區')).toBe('新竹市')
    expect(c(null, '新竹 竹北')).toBe('新竹縣')
  })
  it('address 優先於 area', () => {
    expect(c('台中市西區', '台北 大安')).toBe('台中市')
    expect(c('某某路1號', '台南 中西區')).toBe('台南市')
  })
  it('認不出回 null', () => {
    expect(c(null, null)).toBeNull()
    expect(c('日本東京', '東京 新宿')).toBeNull()
    expect(c(null, '嘉義')).toBeNull()
  })
  it('22 縣市座標與名稱不重複', () => {
    expect(COUNTIES).toHaveLength(22)
    expect(new Set(COUNTIES.map((x) => `${x.col},${x.row}`)).size).toBe(22)
    expect(new Set(COUNTIES.map((x) => x.name)).size).toBe(22)
  })
})

describe('足跡縣市次數', () => {
  it('遊記地點與去過的地點合併、同一地點不重複、planned 不算、認不出另計', () => {
    const places = [
      place('p1', { area: '台北 大安', status: 'visited' }),
      place('p2', { area: '台北 信義', status: 'want' }),
      place('p3', { address: '花蓮縣花蓮市', status: 'want' }),
      place('p4', { area: '台南 中西區', status: 'want' }),
      place('p5', { area: '火星', status: 'favorite' }),
      place('p6', { area: '高雄 左營', status: 'skip' }),
    ]
    const trips = [trip('t1', '2026-01-01', '2026-01-02', 'done', ['p1', 'p2', 'p3', 'nope']), trip('t2', '2026-05-01', '2026-05-02', 'planned', ['p4', 'p6'])]
    const f = buildFootprint(trips, places)
    expect(f.counts.get('台北市')).toBe(2)
    expect(f.counts.get('花蓮縣')).toBe(1)
    expect(f.counts.get('台南市')).toBe(0)
    expect(f.counts.get('高雄市')).toBe(0)
    expect(f.visitedCounties).toBe(2)
    expect(f.unknown).toBe(1)
    expect(f.total).toBe(4)
  })
  it('階級', () => {
    expect([0, 1, 2, 3, 4, 7, 8, 30].map(footprintLevel)).toEqual([0, 1, 2, 2, 3, 3, 4, 4])
  })
})
