import { describe, expect, it } from 'vitest'
import { backLabel, buildTimelineDayLink, isValidDay, parseTimelineHash, safeFrom } from './timelineLink'

describe('timelineLink', () => {
  it('isValidDay', () => {
    expect(isValidDay('2026-11-15')).toBe(true)
    expect(isValidDay('2026-02-30')).toBe(false)
    expect(isValidDay('2026-1-5')).toBe(false)
    expect(isValidDay('abc')).toBe(false)
  })
  it('safeFrom 白名單', () => {
    expect(safeFrom('insight/I-1')).toBe('insight/I-1')
    expect(safeFrom('')).toBe('')
    expect(safeFrom(null)).toBeNull()
    expect(safeFrom('https://evil.com')).toBeNull()
    expect(safeFrom('//evil.com')).toBeNull()
    expect(safeFrom('/x')).toBeNull()
    expect(safeFrom('javascript:alert(1)')).toBeNull()
    expect(safeFrom('JavaScript:alert(1)')).toBeNull()
    expect(safeFrom('a'.repeat(201))).toBeNull()
    expect(safeFrom('a'.repeat(200))).toBe('a'.repeat(200))
  })
  it('parseTimelineHash', () => {
    expect(parseTimelineHash('#graph/timeline')).toEqual({ day: null, from: null })
    expect(parseTimelineHash('#graph/timeline/day/2026-11-10')).toEqual({ day: '2026-11-10', from: null })
    expect(parseTimelineHash('#graph/timeline/day/2026-11-10?from=insight%2FI-1')).toEqual({ day: '2026-11-10', from: 'insight/I-1' })
    expect(parseTimelineHash('#graph/timeline/day/2026-11-10?from=')).toEqual({ day: '2026-11-10', from: '' })
    expect(parseTimelineHash('#graph/timeline/day/2026-13-40')).toEqual({ day: null, from: null })
    expect(parseTimelineHash('#graph/timeline/day/2026-11-10?from=javascript%3Aalert(1)')).toEqual({ day: '2026-11-10', from: null })
    expect(parseTimelineHash('#dossier')).toBeNull()
    expect(parseTimelineHash('#graph/timeline/x')).toBeNull()
  })
  it('buildTimelineDayLink', () => {
    expect(buildTimelineDayLink('2026-11-10', 'insight/I-1')).toBe('#graph/timeline/day/2026-11-10?from=insight%2FI-1')
    expect(buildTimelineDayLink('2026-11-10', '')).toBe('#graph/timeline/day/2026-11-10?from=')
    expect(buildTimelineDayLink('2026-11-10', null)).toBe('#graph/timeline/day/2026-11-10')
    expect(buildTimelineDayLink('nope', 'x')).toBe('#graph/timeline')
    expect(buildTimelineDayLink('2026-11-10', 'https://x')).toBe('#graph/timeline/day/2026-11-10')
  })
  it('往返一致、backLabel', () => {
    const p = parseTimelineHash(buildTimelineDayLink('2026-11-10', 'insight/I 1'))
    expect(p).toEqual({ day: '2026-11-10', from: 'insight/I 1' })
    expect(backLabel('insight/x')).toBe('‹ 回到心得')
    expect(backLabel('')).toBe('‹ 返回')
  })
})
