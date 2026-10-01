import { describe, expect, it } from 'vitest'
import { scheduleLine, shortSchedule } from './pipelineSchedule'

describe('shortSchedule', () => {
  it('falls back when nothing was reported', () => {
    expect(shortSchedule(undefined, '靜態')).toBe('靜態')
    expect(shortSchedule([], '靜態')).toBe('靜態')
  })
  it('strips 每日 and joins entries', () => {
    expect(shortSchedule(['每日 10:30、16:30、20:30'], 'x')).toBe('10:30 / 16:30 / 20:30')
    expect(shortSchedule(['每日 00:10', '每日 01:10'], 'x')).toBe('00:10 / 01:10')
    expect(shortSchedule(['每週日 02:30'], 'x')).toBe('每週日 02:30')
  })
  it('truncates very long text', () => {
    expect(shortSchedule(['每日 01:00、02:00、03:00、04:00、05:00、06:00、07:00'], 'x').endsWith('…')).toBe(true)
  })
})

describe('scheduleLine', () => {
  it('prefers reported schedules, else fallback, else null', () => {
    expect(scheduleLine(['每日 02:00'], '舊')).toBe('每日 02:00')
    expect(scheduleLine([], '舊')).toBe('舊')
    expect(scheduleLine(undefined, undefined)).toBeNull()
  })
})
