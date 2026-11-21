import { describe, expect, it } from 'vitest'
import { BOOST_THRESHOLD, boostCard, lowDayInsight, weakestDimension } from './hhiBoost'
import { MOVES, type CompanionData, type PersonAction } from './companion'
import type { HhiHistoryPoint } from './boardApi'
import type { HhiRow } from './boardView'
import type { Insight } from './insightModel'

const TODAY = '2026-11-13'
const LABELS: Record<string, string> = { lifeFreedom: '財務', fitness: '身體', calm: '從容', mind: '心智', social: '社交', travel: '旅遊' }

const row = (key: string, value: number | null): HhiRow => ({ key, label: LABELS[key]!, value, weightPct: 10, points: null })
const rows = (v: Partial<Record<string, number | null>> = {}): HhiRow[] =>
  ['lifeFreedom', 'fitness', 'calm', 'mind', 'social', 'travel'].map((k) => row(k, k in v ? v[k]! : 80))

const insight = (id: string, date: string, o: Partial<Insight> = {}): Insight => ({
  id, date, time: null, text: `心得 ${id}`, provenance: 'quote', cluster: '測試群', thread: '測試脈絡', relation: 'new', parent: null,
  links: { people: [], ideas: [], topics: [] }, ...o,
})

const point = (date: string, mind: number, displayedScore = 90): HhiHistoryPoint => ({ date, displayedScore, components: { mind } })

const companion = (people: Array<{ name: string; lastDate: string }>): CompanionData => ({
  computedAt: '2026-11-13T00:00:00Z', date: TODAY, onThisDay: [], socialDays: [],
  quietPeople: people.map((p) => ({ ...p, daysQuiet: 43, events: 3 })),
})

describe('weakestDimension', () => {
  it('排除財務與沒有分數的列', () => {
    expect(weakestDimension([row('lifeFreedom', 10), row('fitness', 55), row('calm', null), row('mind', 40)])?.key).toBe('mind')
    expect(weakestDimension([row('lifeFreedom', 10), row('fitness', null)])).toBeNull()
    expect(weakestDimension([])).toBeNull()
  })
  it('門檻 60：59.9 會出、60 不出', () => {
    expect(BOOST_THRESHOLD).toBe(60)
    expect(weakestDimension([row('social', 59.9)])?.key).toBe('social')
    expect(weakestDimension([row('social', 60)])).toBeNull()
  })
  it('同分取 rows 中先出現的', () => {
    expect(weakestDimension([row('fitness', 40), row('social', 40)])?.key).toBe('fitness')
    expect(weakestDimension([row('social', 40), row('fitness', 40)])?.key).toBe('social')
  })
})

describe('lowDayInsight', () => {
  const eightDays = (): HhiHistoryPoint[] => [
    point('2026-11-01', 80), point('2026-11-02', 75), point('2026-11-03', 70), point('2026-11-04', 65),
    point('2026-11-05', 60), point('2026-11-06', 55), point('2026-11-07', 50), point('2026-11-08', 45),
  ]
  it('取最低 25% 的日子裡最新的一則（date、time、id 由新到舊）', () => {
    const ins = [insight('a', '2026-11-07', { time: '09:00' }), insight('b', '2026-11-08', { time: '10:00' }), insight('c', '2026-11-05')]
    expect(lowDayInsight(ins, eightDays(), 'mind', TODAY)?.id).toBe('b')
  })
  it('同一天依 time、再依 id 由新到舊', () => {
    const ins = [insight('a', '2026-11-08', { time: '09:00' }), insight('b', '2026-11-08', { time: '10:00' }), insight('c', '2026-11-08', { time: '10:00' })]
    expect(lowDayInsight(ins, eightDays(), 'mind', TODAY)?.id).toBe('c')
  })
  it('優先 components[dimKey] 而不是 displayedScore', () => {
    const dates = ['2026-11-01', '2026-11-02', '2026-11-03', '2026-11-04', '2026-11-05', '2026-11-06', '2026-11-07', '2026-11-08']
    const history = dates.map((date) => ({
      date, displayedScore: date === '2026-11-07' ? 10 : 90, components: { mind: date === '2026-11-08' ? 10 : 90 },
    }))
    // 以 components 算，11-08 是最低；以 displayedScore 算，11-08 是 90，不會入選
    expect(lowDayInsight([insight('x', '2026-11-08')], history, 'mind', TODAY)?.id).toBe('x')
  })
  it('components 沒有這個面向時退回 displayedScore', () => {
    const history: HhiHistoryPoint[] = [
      { date: '2026-11-01', displayedScore: 90, components: { mind: null } },
      { date: '2026-11-02', displayedScore: 20, components: { mind: null } },
      { date: '2026-11-03', displayedScore: 90, components: { mind: null } },
      { date: '2026-11-04', displayedScore: 90 },
    ]
    expect(lowDayInsight([insight('y', '2026-11-02')], history, 'mind', TODAY)?.id).toBe('y')
    expect(lowDayInsight([insight('z', '2026-11-03')], history, 'mind', TODAY)).toBeNull()
  })
  it('排除今天與之後的日期', () => {
    const history: HhiHistoryPoint[] = [
      ...['2026-11-09', '2026-11-10', '2026-11-11', '2026-11-12'].map((date) => point(date, 80)),
      point(TODAY, 1), point('2026-11-14', 1),
    ]
    // 低潮日只算今天以前 → 11-09（80 分，最低的 1 天）；今天與明天分數再低也不算
    expect(lowDayInsight([insight('t', TODAY), insight('u', '2026-11-14')], history, 'mind', TODAY)).toBeNull()
  })
  it('低潮日沒有心得回 null', () => {
    expect(lowDayInsight([insight('n', '2026-11-03')], eightDays(), 'mind', TODAY)).toBeNull()
    expect(lowDayInsight([], eightDays(), 'mind', TODAY)).toBeNull()
    expect(lowDayInsight([insight('n', '2026-11-03')], [], 'mind', TODAY)).toBeNull()
  })
})

describe('boostCard', () => {
  const input = (o: Partial<Parameters<typeof boostCard>[0]>) => ({
    rows: rows(), history: [] as HhiHistoryPoint[], insights: null, companion: null, personActions: null as PersonAction[] | null, today: TODAY, ...o,
  })

  it('社交最弱：點名最久沒聯絡的人', () => {
    const c = boostCard(input({
      rows: rows({ social: 50, lifeFreedom: 10 }), companion: companion([{ name: '測試甲', lastDate: '2026-10-01' }]), personActions: [],
    }))!
    expect(c.kind).toBe('boost')
    expect(c.key).toBe(`boost:social:${TODAY}`)
    expect(c.why).toBe('「社交」是今天最弱的一面（50 分）')
    expect(c.title).toBe('跟 測試甲 聯絡一下')
    expect(c.lines).toEqual(['最後聯絡 2026-10-01'])
    expect(c.person).toBe('測試甲')
    expect(c.forDate).toBe(TODAY)
    expect(c.at).toBeNull()
    expect(c.rank).toBe(0.5)
    expect(c.href).toBeUndefined()
  })
  it('社交最弱但沒人可點名：用一般建議句', () => {
    expect(boostCard(input({ rows: rows({ social: 50 }), companion: companion([]), personActions: [] }))!.title).toBe(MOVES.social)
    expect(boostCard(input({ rows: rows({ social: 50 }), companion: null, personActions: null }))!.title).toBe(MOVES.social)
    // 提醒設定還沒讀到（null）時不點名
    expect(boostCard(input({ rows: rows({ social: 50 }), companion: companion([{ name: '測試甲', lastDate: '2026-10-01' }]), personActions: null }))!.title).toBe(MOVES.social)
  })
  it('心智最弱且找得到低潮日心得：指向心得卷宗', () => {
    const history = [
      point('2026-11-01', 80), point('2026-11-02', 75), point('2026-11-03', 70), point('2026-11-04', 65),
      point('2026-11-05', 60), point('2026-11-06', 55), point('2026-11-07', 50), point('2026-11-08', 45),
    ]
    const c = boostCard(input({ rows: rows({ mind: 50 }), history, insights: [insight('I1', '2026-11-08', { text: '低潮那天寫下的話' })] }))!
    expect(c.title).toBe('你上次低潮時寫下的心得')
    expect(c.point).toBe('低潮那天寫下的話')
    expect(c.lines).toEqual(['2026-11-08 寫的'])
    expect(c.href).toBe('#insight/I1')
  })
  it('心智最弱但沒有低潮日心得：用一般建議句', () => {
    expect(boostCard(input({ rows: rows({ mind: 50 }), insights: [] }))!.title).toBe(MOVES.mind)
    expect(boostCard(input({ rows: rows({ mind: 50 }), insights: null }))!.title).toBe(MOVES.mind)
  })
  it('身體、從容、旅遊：用陪伴區塊的建議句，沒有 CTA', () => {
    for (const key of ['fitness', 'calm', 'travel'] as const) {
      const c = boostCard(input({ rows: rows({ [key]: 55 }) }))!
      expect(c.title).toBe(MOVES[key])
      expect(c.href).toBeUndefined()
      expect(c.person).toBeUndefined()
      expect(c.point).toBe('')
    }
  })
  it('每面向每天一把 key；rank 0.5；最弱 ≥ 門檻回 null', () => {
    const social = boostCard(input({ rows: rows({ social: 50 }) }))!
    const fitness = boostCard(input({ rows: rows({ fitness: 50 }) }))!
    const nextDay = boostCard(input({ rows: rows({ social: 50 }), today: '2026-11-14' }))!
    expect(social.rank).toBe(0.5)
    expect(social.key).not.toBe(fitness.key)
    expect(social.key).not.toBe(nextDay.key)
    expect(nextDay.key).toBe('boost:social:2026-11-14')
    expect(boostCard(input({ rows: rows() }))).toBeNull()
  })
})
