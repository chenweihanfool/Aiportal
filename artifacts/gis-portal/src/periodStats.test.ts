import { describe, expect, it } from 'vitest'
import type { IdeaItem } from './boardApi'
import type { FoodPlace } from './foodMap'
import type { Trip } from './tripsApi'
import { MAX_PINS, buildPeriodReport, eachDay, inputFromData, prevRange, spanDays, type StatsInput } from './periodStats'

const TODAY = '2026-10-22'
const idea = (n: number, born: string, status: IdeaItem['status'] = 'new', category: string | null = '旅遊', history: IdeaItem['history'] = []): IdeaItem => ({
  id: `IDEA-${String(n).padStart(4, '0')}`, title: `想法${n}`, category, dimension: null, source: null, why: null, value: 4, effort: 2, status,
  bornAt: `${born}T10:00`, lastMentioned: `${born}T10:00`, mentions: 1, backfill: false, days: [born], history, score: null, scoreWhy: ['價值4×(6−難度2)'], weakBoost: false,
})
const place = (id: string, over: Partial<FoodPlace>): FoodPlace => ({
  id, name: id, area: null, address: null, lat: 25.03, lng: 121.54, cuisine: null, tags: [], status: 'want', priceLevel: null, why: null, source: null,
  mustTry: [], rating: null, addedAt: '2026-10-20', visitedAt: null, days: [], mapUrl: null, kind: 'food', photos: [], ...over,
})
const trip: Trip = {
  id: 'TRIP-1', name: '台南旅遊', start: '2026-10-15', end: '2026-10-17', status: 'done', area: '台南', summary: null, cover: null, placeIds: [],
  days: [
    { date: '2026-10-16', title: null, placeIds: [], entries: [{ time: '10:00', text: 'x', photos: [{ url: 'u', thumb: null, w: null, h: null, takenAt: null, caption: null }, { url: 'v', thumb: null, w: null, h: null, takenAt: null, caption: null }], photosPending: 1 }] },
    { date: '2026-10-17', title: null, placeIds: [], entries: [{ time: '10:00', text: 'y', photos: [], photosPending: 2 }] },
  ],
}
const INPUT: StatsInput = {
  ideas: [
    idea(1, '2026-10-19'),
    idea(2, '2026-10-20', 'done', '創作', [{ status: 'done', at: '2026-10-21T09:00' }]),
    idea(3, '2026-10-12', 'doing', '旅遊', [{ status: 'doing', at: '2026-10-20T09:00' }]),
    idea(4, '2026-09-01', 'dropped'),
  ],
  top: ['IDEA-0003', 'IDEA-0001', 'IDEA-9999'],
  places: [
    place('老王', { status: 'visited', area: '大安區', cuisine: '牛肉麵', addedAt: '2026-10-10', visitedAt: '2026-10-20', days: ['2026-10-10', '2026-10-20'], rating: 4 }),
    place('新店', { area: '信義區', cuisine: '咖啡', lat: 25.04, lng: 121.56, addedAt: '2026-10-21', days: ['2026-10-21'] }),
    place('舊店', { addedAt: '2026-08-01', days: ['2026-08-01'], lat: null, lng: null }),
    place('赤崁樓', { kind: 'sight', status: 'visited', addedAt: '2026-10-16', visitedAt: '2026-10-16', days: ['2026-10-16'] }),
  ],
  trips: [trip],
}
const WEEK = ['2026-10-19', '2026-10-25'] as const

describe('區間運算', () => {
  it('spanDays／prevRange／eachDay', () => {
    expect(spanDays(WEEK)).toBe(7)
    expect(spanDays(['2026-10-25', '2026-10-19'])).toBe(0)
    expect(spanDays(['壞', '掉'])).toBe(0)
    expect(prevRange(WEEK)).toEqual(['2026-10-12', '2026-10-18'])
    expect(prevRange(['2026-10-01', '2026-10-31'])).toEqual(['2026-09-01', '2026-09-30'])   // 長度相同、緊接在前
    expect(prevRange(['2026-03-01', '2026-03-31'])).toEqual(['2026-02-01', '2026-02-28'])
    expect(prevRange(['2026-01-01', '2026-01-31'])).toEqual(['2025-12-01', '2025-12-31'])
    expect(eachDay(['2026-10-30', '2026-11-02'])).toEqual(['2026-10-30', '2026-10-31', '2026-11-01', '2026-11-02'])
  })
  it('非週一的週區間（第 38 週起是產出日往前 7 天）也能算', () => {
    expect(prevRange(['2026-09-22', '2026-09-28'])).toEqual(['2026-09-15', '2026-09-21'])
  })
})

describe('buildPeriodReport', () => {
  const r = buildPeriodReport(INPUT, WEEK, TODAY)!
  it('想法：新增、實行、開始做、期末開著、實行率、漏斗、類別', () => {
    expect([r.ideas.new, r.ideas.done, r.ideas.started, r.ideas.openAtEnd]).toEqual([2, 1, 1, 2])
    expect(r.ideas.doneRate).toBe(0.33)
    expect(r.ideas.funnel).toEqual({ new: 1, evaluating: 0, doing: 0, done: 1 })
    expect(r.ideas.byCategory).toEqual({ 創作: 1, 旅遊: 1 })
    expect(r.ideas.oldestOpen).toMatchObject({ id: 'IDEA-0003', days: 13 })
  })
  it('前三名只在含今天的這一期出現，找不到的 id 略過', () => {
    expect(r.ideas.top3.map((t) => t.id)).toEqual(['IDEA-0003', 'IDEA-0001'])
    expect(buildPeriodReport(INPUT, ['2026-10-05', '2026-10-11'], TODAY)!.ideas.top3).toEqual([])
  })
  it('美食：新增、吃過、平均分、清單累積、菜系、釘子、想吃最久（沒座標的不進地圖）', () => {
    expect([r.food.added, r.food.visited, r.food.avgRating, r.food.wantBacklog]).toEqual([1, 1, 4, 2])
    expect(r.food.byCuisine).toEqual({ 咖啡: 1, 牛肉麵: 1 })
    expect(r.food.pins.map((p) => [p.name, p.status])).toEqual([['老王', 'visited'], ['新店', 'want']])
    expect(r.food.oldestWant).toEqual({ name: '舊店', days: 85 })
  })
  it('旅遊：只算趟次、裁到本期、相片含待處理；景點不算', () => {
    const t = buildPeriodReport(INPUT, ['2026-10-16', '2026-10-25'], TODAY)!.travel
    expect(t.tripDays).toBe(2)
    expect(t.photos).toBe(5)
    expect(t.trips[0]).toMatchObject({ daysInPeriod: 2, photos: 5 })
    expect(t.areas).toEqual(['台南'])
    expect(buildPeriodReport(INPUT, ['2026-11-01', '2026-11-30'], TODAY)!.travel.trips).toEqual([])
  })
  it('與上期比、逐日資料、還沒結束', () => {
    expect(r.prev.range).toEqual(['2026-10-12', '2026-10-18'])
    expect([r.prev.ideas.new, r.prev.travel.tripDays, r.prev.travel.trips]).toEqual([1, 3, 1])
    expect(r.series).toHaveLength(7)
    expect(r.series.find((s) => s.date === '2026-10-20')).toEqual({ date: '2026-10-20', ideas: 1, food: 1, travel: 0 })
    expect(r.partial).toBe(true)
    expect(buildPeriodReport(INPUT, ['2026-10-12', '2026-10-18'], TODAY)!.partial).toBe(false)
  })
  it('月區間：逐日 31 列', () => {
    expect(buildPeriodReport(INPUT, ['2026-10-01', '2026-10-31'], TODAY)!.series).toHaveLength(31)
  })
  it('壞區間回 null；空資料不崩潰', () => {
    expect(buildPeriodReport(INPUT, ['2026-10-25', '2026-10-19'], TODAY)).toBeNull()
    const e = buildPeriodReport(inputFromData(null, null, null), WEEK, TODAY)!
    expect([e.ideas.new, e.food.added, e.travel.tripDays, e.ideas.doneRate, e.food.avgRating]).toEqual([0, 0, 0, null, null])
  })
  it('壞掉的日期被略過，不拖垮整期', () => {
    const bad = { ...INPUT, ideas: [{ ...idea(1, '2026-10-19'), bornAt: '壞掉', history: undefined as unknown as IdeaItem['history'] }] }
    expect(buildPeriodReport(bad, WEEK, TODAY)!.ideas.new).toBe(0)
  })
  it('地圖釘有上限', () => {
    const many = Array.from({ length: MAX_PINS + 30 }, (_, i) => place(`店${i}`, { addedAt: '2026-10-20', days: ['2026-10-20'] }))
    expect(buildPeriodReport({ ...INPUT, places: many }, WEEK, TODAY)!.food.pins).toHaveLength(MAX_PINS)
  })
})
