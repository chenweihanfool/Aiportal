import { describe, expect, it } from 'vitest'
import { formatWeekRange, parseFitnessWeeklyReport } from './fitnessWeeklyReport'

const sample = {
  weekStart: '2026-10-19', weekEnd: '2026-10-25', totalScore: 1082, scoreChangePct: 29, stars: 3, rank: 1, totalWeeks: 18,
  trainingDays: 7, strengthSets: 27, cardioMinutes: 60, dailySteps: 9316, acwr: 1.16, acwrZone: 'optimal', streak: 17,
  records: ['槓鈴臥推'], observations: [{ tone: 'good', text: '綜合分比前 4 週平均高 29%。' }], focus: ['胸'],
}

describe('parseFitnessWeeklyReport', () => {
  it('解析完整資料', () => {
    const r = parseFitnessWeeklyReport(sample)
    expect(r?.totalScore).toBe(1082)
    expect(r?.records).toEqual(['槓鈴臥推'])
    expect(r?.observations[0].tone).toBe('good')
  })

  it('FitnessForge 還沒部署新版時回 null', () => {
    expect(parseFitnessWeeklyReport(undefined)).toBeNull()
    expect(parseFitnessWeeklyReport({})).toBeNull()
    expect(parseFitnessWeeklyReport({ weekStart: '2026-10-19' })).toBeNull()
  })

  it('選填欄位缺少時用保守值，壞掉的觀察略過', () => {
    const r = parseFitnessWeeklyReport({
      weekStart: '2026-10-19', weekEnd: '2026-10-25', totalScore: 0,
      observations: [null, { text: '只有文字' }, { tone: 'bad', text: '不認得的語氣' }, 3],
      records: ['a', 1],
    })
    expect(r?.scoreChangePct).toBeNull()
    expect(r?.dailySteps).toBeNull()
    expect(r?.records).toEqual(['a'])
    expect(r?.observations.map(o => o.tone)).toEqual(['info', 'info'])
  })
})

describe('formatWeekRange', () => {
  it('去掉年份與補零', () => {
    expect(formatWeekRange('2026-10-05', '2026-10-11')).toBe('10/5–10/11')
    expect(formatWeekRange('2026-12-28', '2027-01-03')).toBe('12/28–1/3')
  })
})
