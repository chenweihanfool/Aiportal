import { describe, expect, it } from 'vitest'
import { foodDataFromResponse, formatReceivedAt } from './foodApi'

const row = { id: 'FOOD-0001', name: '店', status: 'want', addedAt: '2026-06-02', lat: 25.03, lng: 121.56 }

describe('foodDataFromResponse', () => {
  it('treats available:false, bad shapes and empty lists as no data', () => {
    expect(foodDataFromResponse({ available: false, places: [], generatedAt: null, receivedAt: null })).toEqual({ available: false, places: [], receivedAt: null })
    expect(foodDataFromResponse(null).available).toBe(false)
    expect(foodDataFromResponse({ available: true, places: 'x' }).available).toBe(false)
    expect(foodDataFromResponse({ available: true, places: [], receivedAt: '2026-10-15T11:05:00Z' }).available).toBe(false)
  })
  it('keeps valid places and the receivedAt time', () => {
    const d = foodDataFromResponse({ available: true, places: [row, { id: 'bad' }], generatedAt: '2026-10-15', receivedAt: '2026-10-15T11:05:00Z' })
    expect(d.available).toBe(true)
    expect(d.places.map(p => p.id)).toEqual(['FOOD-0001'])
    expect(d.receivedAt).toBe('2026-10-15T11:05:00Z')
  })
})

describe('formatReceivedAt', () => {
  it('formats in Taipei time', () => {
    // 11:05 UTC = 19:05 台北
    expect(formatReceivedAt('2026-10-15T11:05:00Z')).toBe('10/15 19:05')
    expect(formatReceivedAt('2026-10-15T16:00:00Z')).toBe('10/16 00:00')
  })
  it('returns null for missing or invalid times', () => {
    expect(formatReceivedAt(null)).toBeNull()
    expect(formatReceivedAt('not a date')).toBeNull()
  })
})
