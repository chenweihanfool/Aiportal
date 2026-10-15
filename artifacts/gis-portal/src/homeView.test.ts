import { describe, expect, it } from 'vitest'
import {
  addDays, ageText, badFeedNames, blockState, buildHeatmap, dimensionLine, formatAge, formatDuration, greeting, hhiTrend, historyUpdatedAtMs, knowledgeStats,
  hhiRecordedDays, latestTrip, milestones, oldestWantPlace, placesBeenCount, systemLight, taipeiDate, todaySentence, yearProgress,
  type BlockInput, type SystemLightInput,
} from './homeView'
import { buildHhiBreakdown, type HhiRow } from './boardView'
import type { BoardPipeline, BoardStatus, HhiHistoryPoint, PusherHealth, UsageData } from './boardApi'
import type { FoodPlace } from './foodMap'
import type { Trip } from './tripsApi'

const pt = (date: string, displayedScore: number): HhiHistoryPoint => ({ date, displayedScore })
/** 從 start 起每天一筆 */
const series = (start: string, scores: number[]): HhiHistoryPoint[] => scores.map((s, i) => pt(addDays(start, i), s))
const row = (key: string, label: string, value: number | null, weightPct = 15): HhiRow => ({ key, label, value, weightPct, points: value === null ? null : (value * weightPct) / 100 })

describe('dates', () => {
  it('adds days across month, year and leap day', () => {
    expect(addDays('2026-10-31', 1)).toBe('2026-11-01')
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01')
    expect(addDays('2024-02-28', 1)).toBe('2024-02-29')
    expect(addDays('2026-02-28', 1)).toBe('2026-03-01')
    expect(addDays('2026-03-01', -1)).toBe('2026-02-28')
  })
  it('uses Taipei calendar date (UTC 17:00 is already next day in Taipei)', () => {
    expect(taipeiDate(new Date('2026-10-14T17:00:00Z'))).toBe('2026-10-15')
    expect(taipeiDate(new Date('2026-10-14T15:59:00Z'))).toBe('2026-10-14')
  })
})

describe('greeting', () => {
  const at = (h: number) => greeting(new Date(`2026-10-15T${String(h).padStart(2, '0')}:30:00+08:00`))
  it('changes by Taipei hour', () => {
    expect(at(5).part).toBe('morning')
    expect(at(10).text).toBe('早安')
    expect(at(11).part).toBe('noon')
    expect(at(14).part).toBe('afternoon')
    expect(at(18).part).toBe('evening')
    expect(at(21).part).toBe('evening')
    expect(at(22).part).toBe('night')
    expect(at(3).part).toBe('night')
    expect(at(0).text).toBe('夜深了')
  })
})

describe('yearProgress', () => {
  it('matches the audit wireframe: Oct 15 2026 is day 288 of 365 ≈ 79%', () => {
    const p = yearProgress(new Date('2026-10-15T12:00:00+08:00'))
    expect(p).toEqual({ year: 2026, dayOfYear: 288, daysInYear: 365, pct: 79 })
  })
  it('handles Jan 1 and Dec 31', () => {
    expect(yearProgress(new Date('2026-01-01T00:10:00+08:00'))).toMatchObject({ dayOfYear: 1, pct: 0 })
    expect(yearProgress(new Date('2026-12-31T23:50:00+08:00'))).toMatchObject({ dayOfYear: 365, pct: 100 })
  })
  it('uses 366 days in a leap year', () => {
    expect(yearProgress(new Date('2028-12-31T12:00:00+08:00'))).toMatchObject({ dayOfYear: 366, daysInYear: 366, pct: 100 })
    expect(yearProgress(new Date('2028-03-01T12:00:00+08:00')).dayOfYear).toBe(61)
  })
  it('follows Taipei date near the year boundary', () => {
    expect(yearProgress(new Date('2026-12-31T17:00:00Z')).year).toBe(2027)
  })
})

describe('hhiTrend', () => {
  const today = '2026-10-15'
  it('no data at all', () => {
    expect(hhiTrend([], today, null)).toEqual({ score: null, yesterday: null, delta: null, streak: null, historyDays: 0 })
  })
  it('only one day (today from dashboard): no delta, no streak', () => {
    const t = hhiTrend([], today, 70)
    expect(t).toMatchObject({ score: 70, yesterday: null, delta: null, streak: null, historyDays: 1 })
  })
  it('counts consecutive rises up to today', () => {
    const h = series('2026-10-10', [60, 62, 61, 63, 65, 68]) // 10/10..10/15
    const t = hhiTrend(h, today, null)
    expect(t.delta).toBe(3)
    expect(t.streak).toEqual({ direction: 'up', days: 3 }) // 61→63→65→68
  })
  it('counts consecutive falls', () => {
    const t = hhiTrend(series('2026-10-12', [75, 72, 70, 66]), today, null)
    expect(t.streak).toEqual({ direction: 'down', days: 3 })
    expect(t.delta).toBe(-4)
  })
  it('breaks the streak on a flat day', () => {
    const t = hhiTrend(series('2026-10-12', [60, 65, 65, 70]), today, null)
    expect(t.streak).toEqual({ direction: 'up', days: 1 })
  })
  it('breaks the streak on a missing day (not bridged)', () => {
    const h = [pt('2026-10-11', 60), pt('2026-10-12', 62), pt('2026-10-14', 64), pt('2026-10-15', 66)] // 10/13 missing
    const t = hhiTrend(h, today, null)
    expect(t.streak).toEqual({ direction: 'up', days: 1 }) // 只有 10/14→10/15 連得起來
    expect(t.delta).toBe(2)
  })
  it('yesterday missing: delta is null, not computed from an older day', () => {
    const h = [pt('2026-10-13', 60), pt('2026-10-15', 70)]
    const t = hhiTrend(h, today, null)
    expect(t.delta).toBeNull()
    expect(t.yesterday).toBeNull()
    expect(t.streak).toBeNull()
  })
  it('direction change ends the run', () => {
    const t = hhiTrend(series('2026-10-12', [50, 60, 58, 59]), today, null)
    expect(t.streak).toEqual({ direction: 'up', days: 1 })
  })
  it('current dashboard value overrides history for today; future dates are ignored', () => {
    const h = [...series('2026-10-13', [60, 62, 64]), pt('2026-10-16', 99)]
    const t = hhiTrend(h, today, 70)
    expect(t.score).toBe(70)
    expect(t.delta).toBe(8) // 70 − 昨天的 62
    expect(t.historyDays).toBe(3)
  })
  it('works across a year boundary', () => {
    const t = hhiTrend(series('2026-12-29', [60, 62, 64, 66]), '2027-01-01', null)
    expect(t.streak).toEqual({ direction: 'up', days: 3 })
  })
  it('ignores non-finite scores', () => {
    const t = hhiTrend([pt('2026-10-14', Number.NaN), pt('2026-10-15', 70)], today, null)
    expect(t.yesterday).toBeNull()
  })
})

describe('todaySentence', () => {
  const rows = (v: Array<number | null>): HhiRow[] => v.map((x, i) => row(`k${i}`, `面向${i}`, x, 15))
  const trend = (over: Partial<ReturnType<typeof hhiTrend>> = {}) => ({ score: 74, yesterday: 71, delta: 3, streak: null, historyDays: 10, ...over })
  it('is honest when there is no score', () => {
    expect(todaySentence({ trend: null, rows: [] })).toContain('還沒有資料')
    expect(todaySentence({ trend: trend({ score: null }), rows: rows([50]) })).toContain('還沒有資料')
  })
  it('streak beats delta and names the biggest drag with its gap', () => {
    const s = todaySentence({ trend: trend({ streak: { direction: 'up', days: 3 } }), rows: [row('a', '財務自由', 90, 27), row('travel', '旅遊', 55, 12)] })
    expect(s).toBe('連 3 天上升，現在最大的短板是「旅遊」（55 分，拉低總分 5.4 分）。')
  })
  it('falls back to delta when streak is only 1 day', () => {
    expect(todaySentence({ trend: trend({ streak: { direction: 'up', days: 1 } }), rows: rows([40]) })).toMatch(/^比昨天高 3 分，/)
    expect(todaySentence({ trend: trend({ delta: -2 }), rows: rows([40]) })).toMatch(/^比昨天低 2 分，/)
    expect(todaySentence({ trend: trend({ delta: 0 }), rows: rows([40]) })).toMatch(/^和昨天持平，/)
  })
  it('says so when yesterday is missing', () => {
    expect(todaySentence({ trend: trend({ delta: null, yesterday: null }), rows: rows([40]) })).toMatch(/^昨天沒有紀錄/)
  })
  it('falling streak', () => {
    expect(todaySentence({ trend: trend({ streak: { direction: 'down', days: 4 } }), rows: rows([40]) })).toMatch(/^連 4 天下降/)
  })
  it('mentions missing dimensions next to the drag', () => {
    expect(todaySentence({ trend: trend(), rows: rows([50, null, null]) })).toContain('另有 2 個面向今天沒有資料')
  })
  it('all dimensions empty: no conclusion', () => {
    expect(todaySentence({ trend: trend(), rows: rows([null, null]) })).toContain('先不下結論')
  })
  it('all perfect: no drag', () => {
    expect(todaySentence({ trend: trend(), rows: rows([100, 100]) })).toContain('沒有明顯的短板')
  })
  it('history unavailable: says nothing about the trend instead of claiming "no record yesterday"', () => {
    const s = todaySentence({ trend: trend({ delta: null, yesterday: null, historyDays: 0 }), rows: [row('travel', '旅遊', 55, 12)], trendKnown: false })
    expect(s).toBe('現在最大的短板是「旅遊」（55 分，拉低總分 5.4 分）。')
    expect(s).not.toContain('昨天')
  })
  it('works with the real breakdown builder', () => {
    const b = buildHhiBreakdown({ displayedScore: 72, lifeFreedomScore: 68, fitnessHabitScore: 81, calmScore: 74, mindScore: 79, socialScore: 77, travelScore: 55 })!
    // 財務自由 68×27% 離滿分的缺口（8.6）比旅遊 55×12%（5.4）大，所以最大短板是財務自由（與 biggestDrag 一致）
    expect(todaySentence({ trend: trend(), rows: b.rows })).toContain('「財務自由」（68 分，拉低總分 8.6 分）')
  })
})

describe('dimensionLine', () => {
  it('translates scores into plain words', () => {
    expect(dimensionLine(row('a', 'A', null), false)).toBe('今天沒有資料')
    expect(dimensionLine(row('a', 'A', 85), false)).toBe('表現很好')
    expect(dimensionLine(row('a', 'A', 70), false)).toBe('穩定')
    expect(dimensionLine(row('a', 'A', 55), false)).toBe('尚可，需留意')
    expect(dimensionLine(row('a', 'A', 40), false)).toBe('需要調整')
    expect(dimensionLine(row('a', 'A', 20), false)).toBe('偏低，優先照顧')
  })
  it('the drag row says how many points it costs', () => {
    expect(dimensionLine(row('travel', '旅遊', 55, 12), true)).toBe('目前最大短板，拉低總分 5.4 分')
  })
  it('a missing value wins over the drag flag', () => {
    expect(dimensionLine(row('a', 'A', null), true)).toBe('今天沒有資料')
  })
})

describe('buildHeatmap', () => {
  it('always has exactly 365 cells, empty days are null (not 0)', () => {
    const h = buildHeatmap([], '2026-10-15')
    expect(h.cells).toHaveLength(365)
    expect(h.withData).toBe(0)
    expect(h.cells.every((c) => c.value === null)).toBe(true)
  })
  it('starts 364 days before today and ends today', () => {
    const h = buildHeatmap([], '2026-10-15')
    expect(h.start).toBe('2025-10-16')
    expect(h.cells[0]!.date).toBe('2025-10-16')
    expect(h.cells[364]!.date).toBe('2026-10-15')
  })
  it('places cells in Sunday-first weeks (2026-10-15 is Thursday → row 4)', () => {
    const h = buildHeatmap([], '2026-10-15')
    const last = h.cells[364]!
    expect(last.row).toBe(4)
    expect(last.col).toBe(h.cols - 1)
    // 2025-10-16 is Thursday → first cell row 4, col 0
    expect(h.cells[0]).toMatchObject({ row: 4, col: 0 })
    // the following Sunday starts column 1
    expect(h.cells[3]).toMatchObject({ date: '2025-10-19', row: 0, col: 1 })
  })
  it('keeps real values and ignores history outside the window', () => {
    const h = buildHeatmap([pt('2026-10-15', 72), pt('2026-10-14', 70), pt('2024-01-01', 50), pt('2027-01-01', 90)], '2026-10-15')
    expect(h.withData).toBe(2)
    expect(h.cells[364]!.value).toBe(72)
    expect(h.cells[363]!.value).toBe(70)
  })
  it('spans a leap day correctly (window ending 2024-03-10 contains 2024-02-29)', () => {
    const h = buildHeatmap([pt('2024-02-29', 66)], '2024-03-10')
    expect(h.cells).toHaveLength(365)
    const leap = h.cells.find((c) => c.date === '2024-02-29')!
    expect(leap.value).toBe(66)
    expect(h.cells.filter((c) => c.date === '2024-03-01')).toHaveLength(1)
    // 2024-02-28 → 2024-02-29 → 2024-03-01 are consecutive
    const i = h.cells.findIndex((c) => c.date === '2024-02-29')
    expect(h.cells[i - 1]!.date).toBe('2024-02-28')
    expect(h.cells[i + 1]!.date).toBe('2024-03-01')
  })
  it('crosses the year boundary without gaps or duplicates', () => {
    const h = buildHeatmap([], '2027-01-05')
    const dates = h.cells.map((c) => c.date)
    expect(new Set(dates).size).toBe(365)
    expect(dates).toContain('2026-12-31')
    expect(dates).toContain('2027-01-01')
  })
  it('cols fits the last cell, and fewer days works too', () => {
    const h = buildHeatmap([], '2026-10-15', 30)
    expect(h.cells).toHaveLength(30)
    expect(Math.max(...h.cells.map((c) => c.col)) + 1).toBe(h.cols)
  })
  it('labels months at the 1st', () => {
    const h = buildHeatmap([], '2026-10-15')
    const labels = h.months.map((m) => m.label)
    expect(labels).toContain('11月')
    expect(labels).toContain('10月')
    const cols = h.months.map((m) => m.col)
    expect(new Set(cols).size).toBe(cols.length)
  })
  it('first column is labelled only when the next 1st is at least 3 columns away', () => {
    // 視窗從 2025-10-10（週五）開始，11/1 落在第 3 欄 → 第一欄補上「10月」
    const roomy = buildHeatmap([], '2026-10-09')
    expect(roomy.start).toBe('2025-10-10')
    expect(roomy.months[0]).toEqual({ col: 0, label: '10月' })
    expect(roomy.months[1]).toEqual({ col: 3, label: '11月' })
    // 視窗從 2025-10-29 開始，11/1 緊接在第 0–1 欄 → 不疊標籤
    const tight = buildHeatmap([], '2026-10-28')
    expect(tight.start).toBe('2025-10-29')
    expect(tight.months[0]!.label).toBe('11月')
    expect(tight.months[0]!.col).toBeLessThan(3)
  })
})

describe('knowledgeStats', () => {
  it('passes counts through and uses null for missing optional fields', () => {
    const m = { peopleCount: 186, eventsCount: 1156, casesCount: 52, objectsCount: 626, avgParticipantsPerEvent: 0.9, orphanEventRatioPct: 51, trueOrphanEventRatioPct: 20, newEventsThisWeek: 5, newPeopleThisWeek: 1, mostActivePerson: null, activeCasesCount: 52, personRelationsCount: 0 }
    expect(knowledgeStats(m)).toEqual({ people: 186, events: 1156, concepts: null, methods: null, newEventsThisWeek: 5, newPeopleThisWeek: 1 })
    expect(knowledgeStats({ ...m, conceptsCount: 40, methodsCount: 12 })).toMatchObject({ concepts: 40, methods: 12 })
  })
  it('no metrics: everything null', () => {
    expect(knowledgeStats(undefined)).toEqual({ people: null, events: null, concepts: null, methods: null, newEventsThisWeek: null, newPeopleThisWeek: null })
    expect(knowledgeStats(null).events).toBeNull()
  })
  it('zero is a real zero', () => {
    expect(knowledgeStats({ peopleCount: 0 } as never).people).toBe(0)
  })
})

describe('milestones', () => {
  const none = { events: null, people: null, concepts: null, methods: null, ideasDone: null, placesBeen: null, trips: null, hhiDays: null }
  it('lists nothing when no source is available', () => {
    expect(milestones(none)).toEqual({ badges: [], next: null })
  })
  it('crossing 1000 events: one badge for the highest rung, next target 2,000', () => {
    const m = milestones({ ...none, events: 1156 })
    expect(m.badges).toEqual([{ id: 'events', icon: '📅', title: '事件突破 1,000', detail: '目前 1,156 個事件' }])
    expect(m.next).toMatchObject({ text: '下一個：事件 2,000（目前 1,156，還差 844）', current: 1156, target: 2000, remaining: 844 })
    expect(m.next!.ratio).toBeCloseTo(0.578, 3)
  })
  it('rung boundaries are inclusive (999 → 500, 1000 → 1,000)', () => {
    expect(milestones({ ...none, events: 999 }).badges[0]!.title).toBe('事件突破 500')
    expect(milestones({ ...none, events: 1000 }).badges[0]!.title).toBe('事件突破 1,000')
    expect(milestones({ ...none, events: 100 }).badges[0]!.title).toBe('事件突破 100')
  })
  it('below the first rung: no badge, but still a next target (a real zero is not hidden)', () => {
    const m = milestones({ ...none, events: 99, ideasDone: 0 })
    expect(m.badges).toEqual([])
    // 99/100 比 0/1 高
    expect(m.next).toMatchObject({ id: 'events', text: '下一個：事件 100（目前 99，還差 1）' })
  })
  it('top of a ladder has a badge but no next from that group', () => {
    const m = milestones({ ...none, events: 6000 })
    expect(m.badges[0]!.title).toBe('事件突破 5,000')
    expect(m.next).toBeNull()
  })
  it('every group has the specified rungs', () => {
    const m = milestones({ events: 5000, people: 500, concepts: 500, methods: 200, ideasDone: 25, placesBeen: 100, trips: 25, hhiDays: 365 })
    expect(m.badges.map((b) => b.title)).toEqual(['事件突破 5,000', '人物突破 500', '概念突破 500', '方法突破 200', '已實行 25 個想法', '去過 100 個地點'])
    expect(m.next).toBeNull()
    expect(milestones({ ...none, concepts: 50 }).badges[0]!.title).toBe('概念突破 50')
    expect(milestones({ ...none, methods: 25 }).badges[0]!.title).toBe('方法突破 25')
    expect(milestones({ ...none, ideasDone: 1 }).badges[0]!.title).toBe('已實行 1 個想法')
    expect(milestones({ ...none, placesBeen: 10 }).badges[0]!.title).toBe('去過 10 個地點')
    expect(milestones({ ...none, trips: 5 }).badges[0]!.title).toBe('遊記 5 趟')
    expect(milestones({ ...none, hhiDays: 100 }).badges[0]!.title).toBe('幸福指數紀錄 100 天')
  })
  it('shows at most 6 badges, in group order', () => {
    const m = milestones({ events: 200, people: 60, concepts: 60, methods: 30, ideasDone: 2, placesBeen: 11, trips: 2, hhiDays: 40 })
    expect(m.badges).toHaveLength(6)
    expect(m.badges.map((b) => b.id)).toEqual(['events', 'people', 'concepts', 'methods', 'ideasDone', 'placesBeen'])
  })
  it('skips unavailable groups entirely instead of showing 0', () => {
    const m = milestones({ ...none, events: 1156, people: null, trips: 3 })
    expect(m.badges.map((b) => b.id)).toEqual(['events', 'trips'])
    expect(milestones({ ...none, people: Number.NaN, events: -5 })).toEqual({ badges: [], next: null })
  })
  it('next = the group closest to its next rung by ratio', () => {
    // events 1156/2000 = 0.578；people 186/200 = 0.93；concepts 74/100 = 0.74；methods 31/50 = 0.62
    const m = milestones({ ...none, events: 1156, people: 186, concepts: 74, methods: 31 })
    expect(m.next).toMatchObject({ id: 'people', text: '下一個：人物 200（目前 186，還差 14）' })
    expect(m.next!.ratio).toBeCloseTo(0.93, 2)
  })
  it('ties keep the earlier group', () => {
    const m = milestones({ ...none, events: 50, people: 25 }) // 都是 0.5
    expect(m.next!.id).toBe('events')
  })
  it('fractional input is floored', () => {
    expect(milestones({ ...none, events: 99.9 }).next).toMatchObject({ current: 99, remaining: 1 })
  })
  it('per-group next text', () => {
    expect(milestones({ ...none, ideasDone: 1 }).next!.text).toBe('下一個：已實行想法 5（目前 1，還差 4）')
    expect(milestones({ ...none, trips: 0 }).next!.text).toBe('下一個：遊記 1 趟（目前 0，還差 1）')
    expect(milestones({ ...none, hhiDays: 80 }).next!.text).toBe('下一個：幸福指數紀錄 100 天（目前 80，還差 20）')
  })
})

describe('hhiRecordedDays', () => {
  it('counts distinct dates with a finite score', () => {
    expect(hhiRecordedDays([])).toBe(0)
    expect(hhiRecordedDays([pt('2026-10-01', 60), pt('2026-10-01', 61), pt('2026-10-02', 62)])).toBe(2)
    expect(hhiRecordedDays([pt('2026-10-01', Number.NaN), pt('2026-10-02', 62)])).toBe(1)
  })
})

describe('oldestWantPlace / placesBeenCount', () => {
  const place = (id: string, over: Partial<FoodPlace> = {}): FoodPlace => ({
    id, name: `店${id}`, area: null, address: null, lat: null, lng: null, cuisine: null, tags: [], status: 'want', priceLevel: null,
    why: null, source: null, mustTry: [], rating: null, addedAt: '2026-01-20', visitedAt: null, days: [], mapUrl: null, kind: 'food', photos: [], ...over,
  })
  const now = new Date('2026-10-15T12:00:00+08:00')
  it('none when no want places', () => {
    expect(oldestWantPlace([], now)).toBeNull()
    expect(oldestWantPlace([place('1', { status: 'visited' }), place('2', { status: 'favorite' })], now)).toBeNull()
  })
  it('picks the earliest addedAt among want, id breaks ties', () => {
    const r = oldestWantPlace([place('B', { addedAt: '2026-03-01' }), place('A2', { addedAt: '2026-01-20' }), place('A1', { addedAt: '2026-01-20' }), place('V', { status: 'visited', addedAt: '2020-01-01' })], now)
    expect(r?.place.id).toBe('A1')
    expect(r?.days).toBe(268)
  })
  it('added today is 0 days; a future addedAt does not go negative', () => {
    expect(oldestWantPlace([place('1', { addedAt: '2026-10-15' })], now)?.days).toBe(0)
    expect(oldestWantPlace([place('1', { addedAt: '2026-10-20' })], now)?.days).toBe(0)
  })
  it('counts visited and favorite as been', () => {
    expect(placesBeenCount([place('1', { status: 'visited' }), place('2', { status: 'favorite' }), place('3'), place('4', { status: 'skip' })])).toBe(2)
    expect(placesBeenCount([])).toBe(0)
  })
})

describe('latestTrip', () => {
  const trip = (id: string, start: string, end: string, status: Trip['status']): Trip => ({ id, name: id, start, end, status, area: null, summary: null, cover: null, placeIds: [], days: [] })
  it('none for no trips', () => expect(latestTrip([])).toBeNull())
  it('ongoing first, even if an older done trip started later is impossible; picks latest-started ongoing', () => {
    const r = latestTrip([trip('d', '2026-09-01', '2026-09-03', 'done'), trip('o', '2026-10-14', '2026-10-17', 'ongoing')])
    expect(r).toMatchObject({ when: 'ongoing', days: 4 })
    expect(r?.trip.id).toBe('o')
  })
  it('otherwise the most recently started finished trip', () => {
    const r = latestTrip([trip('a', '2026-05-01', '2026-05-03', 'done'), trip('b', '2026-09-10', '2026-09-12', 'done'), trip('p', '2026-12-01', '2026-12-05', 'planned')])
    expect(r?.trip.id).toBe('b')
    expect(r?.when).toBe('recent')
    expect(r?.days).toBe(3)
  })
  it('only planned trips: the nearest upcoming', () => {
    const r = latestTrip([trip('far', '2027-01-01', '2027-01-03', 'planned'), trip('near', '2026-11-01', '2026-11-02', 'planned')])
    expect(r).toMatchObject({ when: 'upcoming', days: 2 })
    expect(r?.trip.id).toBe('near')
  })
})

describe('blockState', () => {
  const base: BlockInput = { unlocked: true, loading: false, error: false, hasData: true, nowMs: Date.parse('2026-10-15T12:00:00Z') }
  const agoMin = (m: number) => base.nowMs - m * 60_000
  it('locked wins over everything', () => {
    expect(blockState({ ...base, unlocked: false, error: true }).state).toBe('locked')
  })
  it('loading only when there is no data yet', () => {
    expect(blockState({ ...base, hasData: false, loading: true }).state).toBe('loading')
    expect(blockState({ ...base, hasData: true, loading: true }).state).toBe('fresh')
  })
  it('error keeps the last value when there is one', () => {
    expect(blockState({ ...base, error: true })).toEqual({ state: 'error', ageMin: null, keepLastValue: true })
    expect(blockState({ ...base, error: true, hasData: false })).toMatchObject({ state: 'error', keepLastValue: false })
  })
  it('loaded but nothing → empty; zero rows → empty', () => {
    expect(blockState({ ...base, hasData: false }).state).toBe('empty')
    expect(blockState({ ...base, empty: true }).state).toBe('empty')
  })
  it('pending beats freshness', () => {
    expect(blockState({ ...base, pending: true, updatedAtMs: agoMin(5), expectedEveryMin: 60 }).state).toBe('pending')
  })
  it('daily data: stale after 36h, dead after 72h (§2.4)', () => {
    const at = (h: number) => blockState({ ...base, updatedAtMs: agoMin(h * 60), expectedEveryMin: 1440 }).state
    expect(at(1)).toBe('fresh')
    expect(at(36)).toBe('fresh')
    expect(at(36.1)).toBe('stale')
    expect(at(72)).toBe('stale')
    expect(at(72.1)).toBe('dead')
  })
  it('reports the age', () => {
    expect(blockState({ ...base, updatedAtMs: agoMin(100), expectedEveryMin: 60 })).toMatchObject({ state: 'stale', ageMin: 100 })
  })
  it('no timestamp or no expected interval: never stale', () => {
    expect(blockState({ ...base, updatedAtMs: null, expectedEveryMin: 60 }).state).toBe('fresh')
    expect(blockState({ ...base, updatedAtMs: agoMin(99999), expectedEveryMin: null }).state).toBe('fresh')
    expect(blockState({ ...base, updatedAtMs: Number.NaN, expectedEveryMin: 60 }).state).toBe('fresh')
  })
  it('a timestamp in the future counts as age 0', () => {
    expect(blockState({ ...base, updatedAtMs: base.nowMs + 3600_000, expectedEveryMin: 60 })).toMatchObject({ state: 'fresh', ageMin: 0 })
  })
})

describe('formatAge / historyUpdatedAtMs', () => {
  it('formats minutes, hours and days', () => {
    expect(formatAge(0.2)).toBe('剛剛')
    expect(formatAge(45)).toBe('45 分鐘前')
    expect(formatAge(180)).toBe('3 小時前')
    expect(formatAge(47 * 60)).toBe('47 小時前')
    expect(formatAge(3 * 1440)).toBe('3 天前')
    expect(formatDuration(3 * 60)).toBe('3 小時')
    expect(formatDuration(0.1)).toBe('1 分鐘')
  })
  it('history is complete at the end of its last day (Taipei)', () => {
    expect(historyUpdatedAtMs([])).toBeNull()
    expect(historyUpdatedAtMs([pt('2026-10-14', 60), pt('2026-10-13', 60)])).toBe(Date.parse('2026-10-15T00:00:00+08:00'))
  })
})

describe('systemLight', () => {
  const nowMs = Date.parse('2026-10-15T12:00:00+08:00')
  const layer = (health: 'ok' | 'crit' | 'unknown' = 'ok', errorSummary: string | null = null) => ({ status: 'success', lastRunTs: nowMs - 14 * 3600e3, health, errorSummary })
  const pipeline = (over: Partial<Record<'L1' | 'L2' | 'L3' | 'L4' | 'L5', ReturnType<typeof layer>>> = {}): BoardPipeline => ({ available: true, layers: { L1: layer(), L2: layer(), L3: layer(), L4: layer(), L5: layer(), ...over } })
  const status = (over: Partial<BoardStatus> = {}): BoardStatus => ({
    available: true, cpuPercent: 5, memPercent: 32, disks: [{ drive: '/opt/data', percentUsed: 38, freeGb: 64, totalGb: 103 }],
    containers: [{ name: 'a', status: 'running', health: 'healthy' }], stale: false, computedAt: new Date(nowMs).toISOString(), ...over,
  })
  const usage = (over: Partial<UsageData['forecast']> = {}, hasBalance = true): UsageData => ({
    available: true, today: '2026-10-15', days: [], last7Days: {}, entries: [], scope: 'x',
    balance: hasBalance ? { enteredAt: '', balanceUsd: 29, capUsd: 60, refillAt: null, monthUsedUsd: null, note: null } : null,
    forecast: { callsPerDay: 1, callsBasedOnDays: 7, usdPerDay: 2.4, source: 'observed', usdPerCall: 0.002, balanceUsd: 29, daysUntilEmpty: 12, emptyDate: '2026-10-27', daysToRefill: 21, shortfallUsd: null, level: 'ok', ...over },
  })
  const ok = (): SystemLightInput => ({
    nowMs, pipeline: { data: pipeline(), error: false }, status: { data: status(), error: false }, usage: { data: usage(), error: false },
    pusher: { bad: 0, total: 3, level: 'ok' }, badFeeds: [], deadBlocks: [],
  })
  const nothing = { data: null, error: false }

  it('all green → one calm line listing what was checked', () => {
    const l = systemLight(ok())
    expect(l.level).toBe('ok')
    expect(l.reasons).toEqual([])
    expect(l.headline).toBe('全部正常（管線、主機、推送、Ollama）')
  })
  it('nothing loaded yet → unknown, never "normal"', () => {
    const l = systemLight({ ...ok(), pipeline: nothing, status: nothing, usage: nothing, pusher: null })
    expect(l.level).toBe('unknown')
    expect(l.headline).toBe('還沒有拿到系統狀態')
  })
  it('a failed pipeline layer is crit and says which layer, how long ago, and why', () => {
    const l = systemLight({ ...ok(), pipeline: { data: pipeline({ L3: layer('crit', 'apply 失敗：磁碟寫入錯誤') }), error: false } })
    expect(l.level).toBe('crit')
    expect(l.reasons[0]).toMatchObject({ level: 'crit', source: 'pipeline', text: '管線 L3 失敗（14 小時前）：apply 失敗：磁碟寫入錯誤' })
    expect(l.headline).toContain('管線 L3 失敗')
  })
  it('unknown layer health does not raise an alarm', () => {
    expect(systemLight({ ...ok(), pipeline: { data: pipeline({ L2: layer('unknown') }), error: false } }).level).toBe('ok')
  })
  it('crit reasons sort before warn, then by source order', () => {
    const l = systemLight({
      ...ok(),
      status: { data: status({ memPercent: 95 }), error: false },
      usage: { data: usage({ level: 'crit', shortfallUsd: 20 }), error: false },
      pipeline: { data: pipeline({ L1: layer('crit', 'x'), L5: layer('crit', 'y') }), error: false },
      pusher: { bad: 1, total: 3, level: 'warn' }, badFeeds: ['Ollama 用量'],
    })
    expect(l.reasons.map((r) => `${r.level}:${r.source}`)).toEqual(['crit:pipeline', 'crit:pipeline', 'crit:ollama', 'warn:host', 'warn:push'])
    expect(l.reasons[0]!.text).toContain('L1')
    expect(l.reasons[1]!.text).toContain('L5')
    expect(l.headline).toMatch(/＋4 項$/)
  })
  it('host: disk alert uses the forecast sentence; plain percentage when no alert', () => {
    const a = systemLight({ ...ok(), status: { data: status({ diskAlert: 'warn', diskForecast: { basedOnDays: 7, insufficient: false, growthGbPerDay: 2, daysUntilFull: 21 } as never }), error: false } })
    expect(a.reasons[0]).toMatchObject({ level: 'warn', source: 'host' })
    expect(a.reasons[0]!.text).toContain('約 21 天後寫滿')
    const b = systemLight({ ...ok(), status: { data: status({ disks: [{ drive: 'C:', percentUsed: 93, freeGb: 7, totalGb: 100 }] }), error: false } })
    expect(b.reasons[0]).toMatchObject({ level: 'crit', text: '硬碟 C: 已用 93%（剩 7.0 GB）' })
    expect(systemLight({ ...ok(), status: { data: status({ disks: [{ drive: 'C:', percentUsed: 74, freeGb: 7, totalGb: 100 }] }), error: false } }).level).toBe('ok')
  })
  it('host: stale data, unhealthy containers', () => {
    const l = systemLight({ ...ok(), status: { data: status({ stale: true, computedAt: new Date(nowMs - 3 * 3600e3).toISOString(), containers: [{ name: 'api', status: 'running', health: 'unhealthy' }, { name: 'db', status: 'Exited (1)', health: null }] }), error: false } })
    expect(l.reasons.map((r) => r.text)).toEqual(['主機資料已過期（3 小時前）', '2 個容器不正常：api、db'])
  })
  it('fetch error is a warning of its own, and the source counts as missing', () => {
    const l = systemLight({ ...ok(), usage: { data: null, error: true } })
    expect(l.level).toBe('warn')
    expect(l.reasons[0]).toMatchObject({ source: 'ollama', text: 'Ollama讀取失敗' })
    expect(l.missing).toContain('Ollama')
  })
  it('unavailable source is not an alarm, but the headline admits the gap', () => {
    const l = systemLight({ ...ok(), pipeline: { data: { available: false, layers: pipeline().layers }, error: false } })
    expect(l.level).toBe('ok')
    expect(l.headline).toBe('主機、推送、Ollama正常；管線尚無資料')
  })
  it('loading source (no data, no error) is simply not counted', () => {
    const l = systemLight({ ...ok(), usage: nothing })
    expect(l.level).toBe('ok')
    expect(l.missing).toEqual(['Ollama'])
  })
  it('ollama: shortfall before refill names the date and amount; no balance entered is not an alarm', () => {
    const l = systemLight({ ...ok(), usage: { data: usage({ level: 'warn', shortfallUsd: 21.4, emptyDate: '2026-10-27', daysUntilEmpty: 12 }), error: false } })
    expect(l.reasons[0]!.text).toBe('Ollama 會在補點前用完（預估 10/27 用完，約缺 $21）')
    expect(systemLight({ ...ok(), usage: { data: usage({}, false), error: false } }).level).toBe('ok')
  })
  it('pusher lag lists up to three feeds then "等"', () => {
    const l = systemLight({ ...ok(), pusher: { bad: 4, total: 5, level: 'crit' }, badFeeds: ['a', 'b', 'c', 'd'] })
    expect(l.reasons[0]).toMatchObject({ level: 'crit', source: 'push', text: '推送 4 項落後：a、b、c 等' })
  })
  it('old pusher (no rows) is admitted as missing, not as green', () => {
    const l = systemLight({ ...ok(), pusher: null })
    expect(l.headline).toBe('管線、主機、Ollama正常；推送尚無資料')
  })
  it('dead data blocks raise the light', () => {
    const l = systemLight({ ...ok(), deadBlocks: [{ label: '幸福指數歷史', ageMin: 4 * 1440 }] })
    expect(l.level).toBe('warn')
    expect(l.reasons[0]).toMatchObject({ source: 'data', text: '幸福指數歷史已 4 天沒有更新' })
  })
})

describe('ageText / badFeedNames', () => {
  const now = Date.parse('2026-10-15T12:00:00Z')
  it('matches the board thresholds', () => {
    expect(ageText(null, now)).toBe('—')
    expect(ageText(now - 20_000, now)).toBe('剛剛')
    expect(ageText(now - 5 * 60_000, now)).toBe('5 分鐘前')
    expect(ageText(now - 5 * 3600_000, now)).toBe('5 小時前')
    expect(ageText(now - 3 * 86400_000, now)).toBe('3 天前')
  })
  it('lists non-ok feeds with their Chinese names', () => {
    const rows = [{ feed: 'a', level: 'ok' }, { feed: 'hermes-usage', level: 'crit' }, { feed: 'zzz', level: 'warn' }] as PusherHealth[]
    expect(badFeedNames(rows, (f) => (f === 'hermes-usage' ? 'Ollama 用量' : f))).toEqual(['Ollama 用量', 'zzz'])
    expect(badFeedNames(null, (f) => f)).toEqual([])
  })
})
