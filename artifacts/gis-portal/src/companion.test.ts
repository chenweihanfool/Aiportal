import { describe, expect, it } from 'vitest'
import type { HhiRow } from './boardView'
import { MIN_INSIGHT_DAYS, activityInsight, bestMove, parseCompanion, rotateQuiet, visibleQuietPeople, type CompanionData, type PersonAction, type QuietPerson } from './companion'
import type { DailyLife } from './milestones'

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


const qp = (name: string, lastDate = '2026-06-01'): QuietPerson => ({ name, lastDate, daysQuiet: 100, events: 3 })
const act = (name: string, action: PersonAction['action'], over: Partial<PersonAction> = {}): PersonAction => ({ name, action, until: null, reason: null, updatedAt: '2026-11-01T02:00:00Z', ...over })

describe('visibleQuietPeople', () => {
  const today = '2026-11-07'
  it('沒有動作就全部顯示；never 移除；保持原順序', () => {
    const ps = [qp('甲'), qp('乙'), qp('丙')]
    expect(visibleQuietPeople(ps, [], today).map((p) => p.name)).toEqual(['甲', '乙', '丙'])
    expect(visibleQuietPeople(ps, [act('乙', 'never', { reason: '已故' })], today).map((p) => p.name)).toEqual(['甲', '丙'])
  })
  it('snooze：到期日（含當天）前移除，過了才回來', () => {
    const ps = [qp('甲')]
    expect(visibleQuietPeople(ps, [act('甲', 'snooze', { until: '2026-11-07' })], today)).toHaveLength(0)
    expect(visibleQuietPeople(ps, [act('甲', 'snooze', { until: '2026-11-06' })], today)).toHaveLength(1)
  })
  it('contacted：之後有新互動、或滿 30 天才再顯示', () => {
    const a = [act('甲', 'contacted', { updatedAt: '2026-11-01T02:00:00Z' })]
    expect(visibleQuietPeople([qp('甲', '2026-06-01')], a, today)).toHaveLength(0)
    expect(visibleQuietPeople([qp('甲', '2026-11-02')], a, today)).toHaveLength(1)
    expect(visibleQuietPeople([qp('甲', '2026-06-01')], a, '2026-12-01')).toHaveLength(1)
    expect(visibleQuietPeople([qp('甲', '2026-06-01')], a, '2026-11-30')).toHaveLength(0)
  })
  it('動作日用台北日期（UTC 16:00 後是隔天）', () => {
    const a = [act('甲', 'contacted', { updatedAt: '2026-10-31T17:00:00Z' })]
    expect(visibleQuietPeople([qp('甲', '2026-11-01')], a, today)).toHaveLength(0)
  })
})

describe('rotateQuiet', () => {
  const list = Array.from({ length: 12 }, (_, i) => `p${i}`)
  it('不足 n 人回全部', () => {
    expect(rotateQuiet(['a', 'b'], '2026-11-07')).toEqual(['a', 'b'])
  })
  it('前 9 人分三組，依日期輪替', () => {
    const d = (n: number) => new Date(Date.UTC(2026, 10, 7 + n)).toISOString().slice(0, 10)
    const seen = [0, 1, 2].map((n) => rotateQuiet(list, d(n)))
    expect(seen.every((g) => g.length === 3)).toBe(true)
    expect(new Set(seen.flat()).size).toBe(9)
    expect(rotateQuiet(list, d(3))).toEqual(seen[0])
    expect(seen.flat().every((x) => list.indexOf(x) < 9)).toBe(true)
  })
  it('組號＝天數 % 組數', () => {
    // 2026-11-07 距 1970-01-01 = 20764 天；20764 % 3 = 1 → 第二組
    expect(rotateQuiet(list, '2026-11-07')).toEqual(['p3', 'p4', 'p5'])
  })
})

const life = (entries: Record<number, Partial<DailyLife[string]>>): DailyLife => {
  const out: DailyLife = {}
  for (const [i, v] of Object.entries(entries)) out[day(Number(i))] = { date: day(Number(i)), socialPeople: 0, newPlaces: [], trip: null, workouts: [], ...v }
  return out
}

describe('activityInsight', () => {
  it('不足門檻只報累積進度，不下結論', () => {
    const r = activityInsight(hist([60, 61, 62]), life({ 0: { socialPeople: 1 } }))
    expect(r.ready).toBe(false)
    expect(r.lines).toEqual([])
    expect(r.pending).toContain(`見人 1／${MIN_INSIGHT_DAYS}`)
    expect(r.pending).toContain(`新店 0／${MIN_INSIGHT_DAYS}`)
  })
  it('見人的日子隔天多 2.3 分；其他項還在累積', () => {
    const scores: number[] = [60]
    const entries: Record<number, Partial<DailyLife[string]>> = {}
    for (let i = 0; i < 24; i++) {
      const met = i % 2 === 0
      if (met) entries[i] = { socialPeople: 1 }
      scores.push(scores[i]! + (met ? 2.3 : 0))
    }
    const r = activityInsight(hist(scores), life(entries))
    expect(r.ready).toBe(true)
    expect(r.lines).toEqual(['見人的日子，隔天幸福指數多 2.3 分'])
    expect(r.pending).toBe('累積中：新店 0／5、旅行 0／5、運動 0／5')
  })
  it('四項都成立：依差距降冪取前 3、pending 為空', () => {
    const scores: number[] = [60]
    const entries: Record<number, Partial<DailyLife[string]>> = {}
    for (let i = 0; i < 40; i++) {
      const e: Partial<DailyLife[string]> = {}
      let gain = 0
      if (i % 2 === 0) { e.socialPeople = 1; gain += 1 }
      if (i % 3 === 0) { e.workouts = ['跑步']; gain += 3 }
      if (i % 5 === 0) { e.newPlaces = ['店'] }
      if (i % 7 === 0) { e.trip = '旅'; gain -= 1 }
      entries[i] = e
      scores.push(scores[i]! + gain)
    }
    const r = activityInsight(hist(scores), life(entries))
    expect(r.lines).toHaveLength(3)
    expect(r.lines[0]).toMatch(/^運動的日子，隔天幸福指數多/)
    expect(r.pending).toBe('')
  })
  it('|差|<0.5 寫差不多', () => {
    const scores: number[] = [60]
    const entries: Record<number, Partial<DailyLife[string]>> = {}
    for (let i = 0; i < 24; i++) { if (i % 2 === 0) entries[i] = { socialPeople: 1 }; scores.push(scores[i]! + 0.1) }
    expect(activityInsight(hist(scores), life(entries)).lines).toEqual(['見人的日子，隔天幸福指數和平常差不多'])
  })
  it('換尺之前的分數不比；沒資料不亂講', () => {
    expect(activityInsight([{ date: '2026-10-01', displayedScore: 50 }, { date: '2026-10-02', displayedScore: 60 }], life({})).pending).toContain('見人 0／')
    expect(activityInsight([], null).ready).toBe(false)
  })
})
