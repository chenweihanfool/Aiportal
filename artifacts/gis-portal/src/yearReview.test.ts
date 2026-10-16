import { describe, expect, it } from 'vitest'
import { dimensionsYear, hhiYear, placesYear, tripsYear, yearFromHash } from './yearReview'
import { buildDimensionHeatmap, buildHeatmap } from './homeView'
import type { FoodPlace } from './foodMap'
import type { Trip } from './tripsApi'

const day = (date: string, displayedScore: number, components?: Record<string, number | null>) => ({ date, displayedScore, components })

describe('yearFromHash', () => {
  it('#year＝今年；#year/2026＝2026；不合理的年份或格式 → null', () => {
    expect(yearFromHash('#year', 2026)).toBe(2026)
    expect(yearFromHash('#year/2025', 2026)).toBe(2025)
    for (const h of ['#year/1999', '#year/2101', '#year/26', '#year/abc', '#year/2026/x', '#years', '', '#dim/mind']) expect(yearFromHash(h, 2026), h).toBeNull()
  })
})

describe('hhiYear', () => {
  it('只算該年、算平均／最高／最低日／各月平均；沒有紀錄的月份是 null', () => {
    const h = [day('2025-12-31', 99), day('2026-01-05', 60), day('2026-01-06', 80), day('2026-03-01', 40), day('2027-01-01', 1)]
    const r = hhiYear(h, 2026)
    expect(r.count).toBe(3)
    expect(r.avg).toBe(60)
    expect(r.best).toEqual({ date: '2026-01-06', value: 80 })
    expect(r.worst).toEqual({ date: '2026-03-01', value: 40 })
    expect(r.months[0]).toEqual({ month: 1, avg: 70, days: 2 })
    expect(r.months[1]).toEqual({ month: 2, avg: null, days: 0 })
    expect(r.months[2]!.avg).toBe(40)
  })
  it('沒有資料／壞資料 → count 0、其餘 null，不丟例外', () => {
    for (const h of [null, undefined, [], [day('2026-01-01', Number.NaN)]]) {
      const r = hhiYear(h as never, 2026)
      expect(r.count).toBe(0)
      expect(r.avg).toBeNull(); expect(r.best).toBeNull(); expect(r.worst).toBeNull()
      expect(r.months.every((m) => m.avg === null)).toBe(true)
    }
  })
})

describe('dimensionsYear', () => {
  it('各面向年平均由高到低，沒資料的排最後；值夾在 0–100', () => {
    const h = [day('2026-02-01', 50, { fitness: 80, mind: 60, social: null }), day('2026-02-02', 50, { fitness: 100, mind: 130 }), day('2025-02-02', 50, { fitness: 0 })]
    const r = dimensionsYear(h, 2026)
    expect(r).toHaveLength(6)
    expect(r[0]).toMatchObject({ key: 'fitness', avg: 90, days: 2 })
    expect(r[1]).toMatchObject({ key: 'mind', avg: 80, days: 2 })            // 130 夾成 100 → (60+100)/2
    expect(r.slice(2).every((d) => d.avg === null && d.days === 0)).toBe(true)
    expect(dimensionsYear(null, 2026).every((d) => d.avg === null)).toBe(true)
  })
})

const trip = (id: string, start: string, end: string, status: Trip['status'], area: string | null = null): Trip =>
  ({ id, name: id, start, end, status, area, summary: null, cover: null, placeIds: [], days: [] })

describe('tripsYear', () => {
  it('跨年的趟次只算落在該年的天數；規劃中的不算；最長一趟與地區去重', () => {
    const r = tripsYear([
      trip('金門', '2026-08-27', '2026-08-31', 'done', '金門'),
      trip('台南', '2026-10-15', '2026-10-17', 'ongoing', '台南'),
      trip('跨年', '2025-12-30', '2026-01-02', 'done', '金門'),
      trip('未來', '2026-12-01', '2026-12-03', 'planned', '日本'),
      trip('去年', '2025-05-01', '2025-05-03', 'done'),
    ], 2026)
    expect(r.count).toBe(3)
    expect(r.days).toBe(5 + 3 + 2)                                             // 跨年那趟只算 1/1～1/2 兩天
    expect(r.areas).toEqual(['金門', '台南'])
    expect(r.longest).toEqual({ name: '金門', days: 5 })
    expect(tripsYear(null, 2026)).toEqual({ count: 0, days: 0, areas: [], longest: null })
  })
})

describe('placesYear', () => {
  it('只算 visitedAt 在該年的；美食與愛店另計', () => {
    const p = (visitedAt: string | null, kind: FoodPlace['kind'], status: FoodPlace['status']) => ({ visitedAt, kind, status }) as FoodPlace
    const r = placesYear([p('2026-03-01', 'food', 'visited'), p('2026-04-01', 'food', 'favorite'), p('2026-05-01', 'sight', 'visited'), p('2025-05-01', 'food', 'visited'), p(null, 'food', 'want')], 2026)
    expect(r).toEqual({ visited: 3, food: 2, favorites: 1 })
    expect(placesYear(undefined, 2026)).toEqual({ visited: 0, food: 0, favorites: 0 })
  })
})

describe('buildDimensionHeatmap', () => {
  it('格數＝天數；有 components 的日子有值（夾在 0–100）、其餘空格；與 buildHeatmap 版面相同', () => {
    const h = [day('2026-10-15', 70, { mind: 55 }), day('2026-10-14', 70, { mind: 130 }), day('2026-10-13', 70, { fitness: 10 }), day('2026-10-12', 70)]
    const m = buildDimensionHeatmap(h, 'mind', '2026-10-15', 30)
    expect(m.cells).toHaveLength(30)
    expect(m.withData).toBe(2)
    expect(m.cells.find((c) => c.date === '2026-10-14')!.value).toBe(100)
    expect(m.cells.find((c) => c.date === '2026-10-13')!.value).toBeNull()
    const base = buildHeatmap(h, '2026-10-15', 30)
    expect(m.cols).toBe(base.cols)
    expect(m.cells.map((c) => [c.col, c.row])).toEqual(base.cells.map((c) => [c.col, c.row]))
    expect(buildDimensionHeatmap(null, 'mind', '2026-10-15', 7).withData).toBe(0)
  })
})
