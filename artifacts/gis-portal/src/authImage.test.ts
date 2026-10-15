import { describe, expect, it } from 'vitest'
import { isProtectedMediaUrl, thumbOf } from './AuthImage'

describe('AuthImage helpers', () => {
  it('only site-absolute /api/ urls need credentials', () => {
    expect(isProtectedMediaUrl('/api/media/trips/t/a.webp')).toBe(true)
    expect(isProtectedMediaUrl('https://example.com/a.jpg')).toBe(false)
    expect(isProtectedMediaUrl('data:image/svg+xml;utf8,x')).toBe(false)
    expect(isProtectedMediaUrl('/media/a.webp')).toBe(false)
  })
  it('thumbOf swaps in the -t thumbnail for our own webp, leaves everything else alone', () => {
    expect(thumbOf('/api/media/trips/t/a.webp')).toBe('/api/media/trips/t/a-t.webp')
    expect(thumbOf('/api/media/trips/t/a-t.webp')).toBe('/api/media/trips/t/a-t.webp')
    expect(thumbOf('/api/media/trips/t/a.png')).toBe('/api/media/trips/t/a.png')
    expect(thumbOf('https://example.com/a.webp')).toBe('https://example.com/a.webp')
  })
})
