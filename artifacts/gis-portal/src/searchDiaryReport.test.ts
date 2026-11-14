import { describe, expect, it } from 'vitest'
import { DIARY_EVENTS_MAX, isDiaryDate } from './omniSearch'

describe('isDiaryDate', () => {
  it('接受真實存在的 YYYY-MM-DD', () => {
    expect(isDiaryDate('2026-11-14')).toBe(true)
    expect(isDiaryDate('2024-02-29')).toBe(true)
  })
  it('拒絕格式不對或不存在的日期', () => {
    expect(isDiaryDate('2026-13-01')).toBe(false)
    expect(isDiaryDate('2025-02-29')).toBe(false)
    expect(isDiaryDate('2026-1-5')).toBe(false)
    expect(isDiaryDate('')).toBe(false)
    expect(isDiaryDate('某個事件')).toBe(false)
  })
  it('事件上限為 8', () => { expect(DIARY_EVENTS_MAX).toBe(8) })
})
