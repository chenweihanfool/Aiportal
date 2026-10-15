import { describe, expect, it } from 'vitest'
import { deriveTripStatus, parseTrip, parseTripList, taipeiTodayIso, tripDataFromResponse } from './tripsApi'

// 台北時間 2026-10-15 中午
const NOW = new Date('2026-10-15T12:00:00+08:00')
const trip = (over: Record<string, unknown> = {}) => ({ id: 'T-1', name: '北部', start: '2026-10-10', end: '2026-10-12', days: [], placeIds: [], ...over })

describe('taipeiTodayIso', () => {
  it('uses the Taipei calendar day', () => {
    expect(taipeiTodayIso(new Date('2026-10-14T16:30:00Z'))).toBe('2026-10-15')
    expect(taipeiTodayIso(new Date('2026-10-15T15:59:00Z'))).toBe('2026-10-15')
  })
})

describe('deriveTripStatus', () => {
  it('done when the trip has ended, planned when it has not started, ongoing otherwise', () => {
    expect(deriveTripStatus('2026-09-01', '2026-09-03', '2026-10-15')).toBe('done')
    expect(deriveTripStatus('2026-11-01', '2026-11-03', '2026-10-15')).toBe('planned')
    expect(deriveTripStatus('2026-10-14', '2026-10-16', '2026-10-15')).toBe('ongoing')
  })
})

describe('parseTrip', () => {
  it('drops trips without id/name, with bad dates, or end before start', () => {
    expect(parseTrip(trip({ id: '' }), NOW)).toBeNull()
    expect(parseTrip(trip({ name: '  ' }), NOW)).toBeNull()
    expect(parseTrip(trip({ start: '2026/10/10' }), NOW)).toBeNull()
    expect(parseTrip(trip({ start: '2026-02-31' }), NOW)).toBeNull()
    expect(parseTrip(trip({ start: '2026-10-12', end: '2026-10-10' }), NOW)).toBeNull()
    expect(parseTrip(null, NOW)).toBeNull()
  })

  it('keeps a valid status, derives an invalid one', () => {
    expect(parseTrip(trip({ status: 'planned' }), NOW)?.status).toBe('planned')
    expect(parseTrip(trip({ status: 'nope', start: '2026-10-14', end: '2026-10-16' }), NOW)?.status).toBe('ongoing')
    expect(parseTrip(trip({ status: 'nope' }), NOW)?.status).toBe('done')
    expect(parseTrip(trip({ start: '2026-09-01', end: '2026-09-02' }), NOW)?.status).toBe('done')
  })

  it('drops days out of range, sorts days and entries, keeps newlines as plain text', () => {
    const t = parseTrip(trip({
      days: [
        { date: '2026-10-12', entries: [{ time: '18:00', text: '晚餐\r\n慢慢吃' }] },
        { date: '2026-10-09', entries: [{ time: '10:00', text: '早' }] },
        { date: '2026-10-10', title: '出發', placeIds: ['FOOD-0001', 'FOOD-0001'], entries: [{ time: '12:00', text: '午' }, { time: '08:00', text: '早餐' }] },
      ],
    }), NOW)!
    expect(t.days.map((d) => d.date)).toEqual(['2026-10-10', '2026-10-12'])
    expect(t.days[0]).toMatchObject({ title: '出發', placeIds: ['FOOD-0001'] })
    expect(t.days[0]!.entries.map((e) => e.time)).toEqual(['08:00', '12:00'])
    expect(t.days[1]!.entries[0]!.text).toBe('晚餐\n慢慢吃')
  })

  it('validates entries: HH:MM only, empty ones dropped, pending-only kept, unsafe photo urls removed', () => {
    const t = parseTrip(trip({
      days: [{
        date: '2026-10-10',
        entries: [
          { time: '7:00', text: 'x' },
          { time: '09:00', text: '   ' },
          { time: '10:00', text: '', photosPending: 3 },
          { time: '11:00', text: '好', photos: [{ url: 'javascript:alert(1)' }, { url: '/media/a.webp', thumb: '/media/a_t.webp' }], photosPending: -2 },
        ],
      }],
    }), NOW)!
    const es = t.days[0]!.entries
    expect(es.map((e) => e.time)).toEqual(['10:00', '11:00'])
    expect(es[0]).toMatchObject({ text: '', photosPending: 3, photos: [] })
    expect(es[1]).toMatchObject({ text: '好', photosPending: 0 })
    expect(es[1]!.photos).toEqual([{ url: '/media/a.webp', thumb: '/media/a_t.webp', w: null, h: null, takenAt: null, caption: null }])
  })

  it('accepts only safe cover urls', () => {
    expect(parseTrip(trip({ cover: '/media/trips/c.webp' }), NOW)?.cover).toBe('/media/trips/c.webp')
    expect(parseTrip(trip({ cover: 'javascript:x' }), NOW)?.cover).toBeNull()
    expect(parseTrip(trip({ cover: '//evil.example/x.jpg' }), NOW)?.cover).toBeNull()
  })
})

describe('parseTripList and tripDataFromResponse', () => {
  it('keeps the first of duplicate ids and skips bad rows', () => {
    const list = parseTripList([trip({ name: '甲' }), trip({ name: '乙' }), { id: 'x' }, 'bad'], NOW)
    expect(list.map((t) => t.name)).toEqual(['甲'])
  })

  it('treats available:false, bad shapes and empty lists as no data', () => {
    expect(tripDataFromResponse({ available: false, trips: [], generatedAt: null, receivedAt: null }, NOW)).toEqual({ available: false, trips: [], receivedAt: null })
    expect(tripDataFromResponse(null, NOW).available).toBe(false)
    expect(tripDataFromResponse({ available: true, trips: 'x' }, NOW).available).toBe(false)
    expect(tripDataFromResponse({ available: true, trips: [{ id: 'bad' }], receivedAt: '2026-10-15T11:05:00Z' }, NOW).available).toBe(false)
  })

  it('keeps valid trips and the receivedAt time', () => {
    const d = tripDataFromResponse({ available: true, trips: [trip()], generatedAt: '2026-10-15', receivedAt: '2026-10-15T11:05:00Z' }, NOW)
    expect(d.available).toBe(true)
    expect(d.trips.map((t) => t.id)).toEqual(['T-1'])
    expect(d.receivedAt).toBe('2026-10-15T11:05:00Z')
  })
})
