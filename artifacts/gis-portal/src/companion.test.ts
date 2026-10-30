import { describe, expect, it } from 'vitest'
import type { HhiRow } from './boardView'
import { MIN_INSIGHT_DAYS, activityInsight, bestMove, parseCompanion, type CompanionData } from './companion'

const row = (key: string, label: string, value: number | null, weightPct: number): HhiRow => ({ key, label, value, weightPct, points: null })
const data = (over: Partial<CompanionData> = {}): CompanionData => ({ computedAt: '2026-11-01T00:00:00Z', date: '2026-11-01', onThisDay: [], quietPeople: [], socialDays: [], ...over })
const day = (i: number) => new Date(Date.UTC(2026, 10, 1 + i)).toISOString().slice(0, 10)
const hist = (scores: number[]) => scores.map((displayedScore, i) => ({ date: day(i), displayedScore }))

describe('parseCompanion', () => {
  it('還沒推送或格式不對回 null', () => {
    expect(parseCompanion({ available: false })).toBeNull()
    expect(parseCompanion({ available: true, payload: { computedAt: 'x' } })).toBeNull()
    expect(parseCompanion({ available: true, payload: data() })?.date).toBe('2026-11-01')
  })
})

describe('bestMove', () => {
  it('挑補起來幫助最大的面向，寫出效益', () => {
    expect(bestMove([row('lifeFreedom', '財務自由', 67, 27), row('fitness', '身體', 20, 18)], null)).toBe('今天最划算：今天動一下，排一次訓練。「身體」每多 10 分，總分約加 1.8 分。')
  })
  it('財務不列入：今天做不了什麼，權重又大', () => {
    expect(bestMove([row('lifeFreedom', '財務自由', 40, 27), row('calm', '從容', 90, 15)], null)).toContain('「從容」')
  })
  it('社交點名最久沒聯絡的人', () => {
    const c = data({ quietPeople: [{ name: '王小明', lastDate: '2026-06-01', daysQuiet: 150, events: 5 }] })
    expect(bestMove([row('social', '社交', 10, 13)], c)).toContain('聯絡一下王小明（150 天沒聯絡了）')
  })
  it('沒有分數就不講', () => {
    expect(bestMove([row('social', '社交', null, 13)], null)).toBeNull()
  })
})

describe('activityInsight', () => {
  it('不足門檻只報累積進度，不下結論', () => {
    const r = activityInsight(hist([60, 61, 62]), data({ socialDays: [{ date: day(0), people: 1 }] }))
    expect(r.ready).toBe(false)
    expect(r.text).toContain(`1／${MIN_INSIGHT_DAYS}`)
  })
  it('兩邊都滿門檻才比；見人的日子隔天多 2 分', () => {
    const scores: number[] = [60]
    const socialDays: CompanionData['socialDays'] = []
    for (let i = 0; i < 24; i++) {
      const met = i % 2 === 0
      if (met) socialDays.push({ date: day(i), people: 1 })
      scores.push(scores[i]! + (met ? 2 : 0))
    }
    const r = activityInsight(hist(scores), data({ socialDays }))
    expect(r).toEqual({ ready: true, text: '和家人朋友互動的日子，隔天幸福指數比沒互動時多 2 分（共 24 天）。' })
  })
  it('換尺之前的分數不比；沒資料不亂講', () => {
    expect(activityInsight([{ date: '2026-10-01', displayedScore: 50 }, { date: '2026-10-02', displayedScore: 60 }], data()).text).toContain('0／')
    expect(activityInsight([], null).ready).toBe(false)
  })
})
