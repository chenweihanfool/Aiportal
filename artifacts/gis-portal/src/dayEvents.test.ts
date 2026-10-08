import { describe, expect, it } from 'vitest'
import { countWithTime, eventDisplayTime, eventTimeLabel, eventTimeTitle } from './dayEvents'

describe('eventTimeLabel', () => {
  it('shows only HH:mm when created on the same Taipei day', () => {
    expect(eventTimeLabel('2026-10-01T21:30:00+08:00', '2026-10-01')).toBe('21:30')
    expect(eventTimeLabel('2026-10-01T00:05:00+08:00', '2026-10-01')).toBe('00:05')
  })
  it('converts to Taipei time before deciding the day (UTC late evening is next day in Taipei)', () => {
    expect(eventTimeLabel('2026-10-01T16:30:00Z', '2026-10-02')).toBe('00:30')
    expect(eventTimeLabel('2026-10-01T16:30:00Z', '2026-10-01')).toBe('10-02 00:30')
  })
  it('adds the date when the file was created on another day than the event day', () => {
    expect(eventTimeLabel('2026-10-02T00:33:23+08:00', '2026-09-30')).toBe('10-02 00:33')
  })
  it('shows a dash when there is no usable time', () => {
    expect(eventTimeLabel(null, '2026-10-01')).toBe('—')
    expect(eventTimeLabel(undefined, '2026-10-01')).toBe('—')
    expect(eventTimeLabel('garbage', '2026-10-01')).toBe('—')
  })
})

describe('helpers', () => {
  it('builds a full-time tooltip and counts events that have a time', () => {
    expect(eventTimeTitle('2026-10-01T21:30:00+08:00', 'diary')).toBe('寫進日記 2026-10-01 21:30（台北）')
    expect(eventTimeTitle('2026-10-01T21:30:00+08:00')).toBe('萃取於 2026-10-01 21:30（台北；日記那行沒有時戳或非日記來源）')
    expect(eventDisplayTime({ createdAt: '2026-10-01T16:30:00+08:00', writtenAt: '2026-10-01T09:12:00+08:00' })).toEqual({ iso: '2026-10-01T09:12:00+08:00', source: 'diary' })
    expect(eventDisplayTime({ createdAt: '2026-10-01T16:30:00+08:00', writtenAt: null })).toEqual({ iso: '2026-10-01T16:30:00+08:00', source: 'extracted' })
    expect(eventDisplayTime({ createdAt: null })).toEqual({ iso: null, source: null })
    expect(countWithTime([{ createdAt: null, writtenAt: '2026-10-01T09:12:00+08:00' }])).toBe(1)
    expect(eventTimeTitle(null)).toBeUndefined()
    expect(countWithTime([{ createdAt: '2026-10-01T10:00:00Z' }, { createdAt: null }, { createdAt: 'x' }])).toBe(1)
  })
})
