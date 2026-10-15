import { describe, expect, it } from 'vitest'
import {
  dayDiff, dayHeading, dayNumber, dayRouteNames, dayRouteText, formatDateRange, isEmptyTrip, photoSummary, tripMapPlaces, tripSpanDays, tripStats, weekdayZh,
} from './tripsView'
import type { FoodPlace } from './foodMap'
import type { Trip } from './tripsApi'

const place = (id: string, over: Partial<FoodPlace> = {}): FoodPlace => ({
  id, name: `店${id}`, area: null, address: null, lat: 25, lng: 121, cuisine: null, tags: [], status: 'want', priceLevel: null,
  why: null, source: null, mustTry: [], rating: null, addedAt: '2026-01-01', visitedAt: null, days: [], mapUrl: null, kind: 'food', photos: [], ...over,
})
const entry = (time: string, photos = 0, pending = 0) => ({
  time, text: `內容${time}`, photos: Array.from({ length: photos }, (_, i) => ({ url: `/m/${i}.webp`, thumb: null, w: null, h: null, takenAt: null, caption: null })), photosPending: pending,
})
const trip = (over: Partial<Trip> = {}): Trip => ({
  id: 'T', name: '遊', start: '2026-10-10', end: '2026-10-12', status: 'ongoing', area: null, summary: null, cover: null, placeIds: [], days: [], ...over,
})

describe('dates', () => {
  it('counts days inclusively and across months', () => {
    expect(dayDiff('2026-10-10', '2026-10-12')).toBe(2)
    expect(tripSpanDays(trip())).toBe(3)
    expect(tripSpanDays(trip({ start: '2026-10-30', end: '2026-11-02' }))).toBe(4)
    expect(tripSpanDays(trip({ start: '2026-10-10', end: '2026-10-10' }))).toBe(1)
  })
  it('numbers the day from the start date', () => {
    const t = trip()
    expect(dayNumber(t, '2026-10-10')).toBe(1)
    expect(dayNumber(t, '2026-10-12')).toBe(3)
  })
  it('gives the Chinese weekday in Taipei calendar terms (2026-10-10 is a Saturday)', () => {
    expect(weekdayZh('2026-10-10')).toBe('六')
    expect(weekdayZh('2026-10-11')).toBe('日')
    expect(weekdayZh('2026-02-28')).toBe('六')
  })
  it('formats ranges: single day, same year, cross year', () => {
    expect(formatDateRange('2026-10-10', '2026-10-10')).toBe('2026/10/10')
    expect(formatDateRange('2026-10-10', '2026-10-12')).toBe('2026/10/10 – 10/12')
    expect(formatDateRange('2026-12-30', '2027-01-02')).toBe('2026/12/30 – 2027/01/02')
  })
  it('builds the day heading', () => {
    expect(dayHeading(trip(), { date: '2026-10-11' })).toBe('Day 2 · 2026/10/11（日）')
  })
})

describe('stats and photo summary', () => {
  const t = trip({
    days: [
      { date: '2026-10-10', title: null, placeIds: [], entries: [entry('08:00', 2), entry('12:00', 0, 1)] },
      { date: '2026-10-12', title: null, placeIds: [], entries: [] },
    ],
  })
  it('sums entries, photos and pending photos; recorded days only count days with entries', () => {
    expect(tripStats(t)).toEqual({ days: 3, recordedDays: 1, entries: 2, photos: 2, pending: 1 })
  })
  it('writes the photo line with pending count in parentheses', () => {
    expect(photoSummary({ photos: 12, pending: 0 })).toBe('12 張相片')
    expect(photoSummary({ photos: 12, pending: 3 })).toBe('12 張相片（另 3 張處理中）')
    expect(photoSummary({ photos: 0, pending: 2 })).toBe('0 張相片（另 2 張處理中）')
  })
  it('detects a trip with nothing recorded', () => {
    expect(isEmptyTrip(trip())).toBe(true)
    expect(isEmptyTrip(t)).toBe(false)
    expect(isEmptyTrip(trip({ days: [{ date: '2026-10-10', title: null, placeIds: [], entries: [entry('08:00', 0, 1)] }] }))).toBe(false)
  })
})

describe('route and map places', () => {
  const places = [place('FOOD-0001', { name: '巷口牛肉麵' }), place('FOOD-0002', { name: '河岸早午餐' }), place('FOOD-0009', { lat: null, lng: null, name: '沒座標' })]
  it('lists route names in placeIds order and skips unknown ids', () => {
    const d = { placeIds: ['FOOD-0002', 'FOOD-9999', 'FOOD-0001'] }
    expect(dayRouteNames(d, places)).toEqual(['河岸早午餐', '巷口牛肉麵'])
    expect(dayRouteText(d, places)).toBe('河岸早午餐 → 巷口牛肉麵')
    expect(dayRouteText({ placeIds: [] }, places)).toBeNull()
  })
  it('maps the trip places: trip-level first, then day-level, unique, only with coordinates', () => {
    const t = trip({
      placeIds: ['FOOD-0002', 'FOOD-0009'],
      days: [{ date: '2026-10-10', title: null, placeIds: ['FOOD-0001', 'FOOD-0002'], entries: [] }],
    })
    expect(tripMapPlaces(t, places).map((p) => p.id)).toEqual(['FOOD-0002', 'FOOD-0001'])
    expect(tripMapPlaces(trip(), places)).toEqual([])
  })
})
