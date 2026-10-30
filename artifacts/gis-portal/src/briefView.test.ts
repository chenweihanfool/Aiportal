import { describe, expect, it } from 'vitest'
import { parseReports, pickBrief, type Report } from './briefView'

const r = (date: string, key = 'tomorrow'): Report => ({ key, title: '明日報告', date, bodyMd: `內容 ${date}`, createdAt: 't' })

describe('pickBrief', () => {
  it('前一晚看到明天的報告', () => {
    expect(pickBrief([r('2026-10-30'), r('2026-10-31')], '2026-10-30')).toMatchObject({ date: '2026-10-31', label: '明天 10/31' })
  })
  it('隔天白天仍顯示，標今天', () => {
    expect(pickBrief([r('2026-10-31')], '2026-10-31')?.label).toBe('今天的報告（10/31）')
  })
  it('過期的不顯示，其他 key 不混入', () => {
    expect(pickBrief([r('2026-10-30')], '2026-10-31')).toBeNull()
    expect(pickBrief([r('2026-10-31', 'other')], '2026-10-31')).toBeNull()
    expect(pickBrief(null, '2026-10-31')).toBeNull()
  })
})

describe('parseReports', () => {
  it('還沒推過回空陣列；格式不對回 null', () => {
    expect(parseReports({ available: false })).toEqual([])
    expect(parseReports({ available: true, payload: {} })).toBeNull()
    expect(parseReports({ available: true, payload: { reports: [r('2026-10-31')] } })).toHaveLength(1)
  })
})
