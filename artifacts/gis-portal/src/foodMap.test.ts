import { describe, expect, it } from 'vitest'
import {
  TAIWAN_BOUNDS, areaCounts, oldestWantSortLabel, wantFilterLabel, coordsFromMapUrl, daysBetween, filterPlaces, foodStats, foodStatusMessage, nextFoodStatuses,
  bearingDeg, bearingLabel, coverPhoto, distanceM, filterPlaces as filterPlacesK, formatDistance, navigateUrl, nearbyPlaces, statusLabelFor, parseFoodPayload, parseFoodPlace, parsePhotos, safeImageUrl, priceLabel, projectPlaces, sortPlaces, stars, tagCounts, type FoodPlace,
} from './foodMap'
import { sampleFoodData } from './foodSample'

const base = { id: 'FOOD-0001', name: '店', status: 'want', addedAt: '2026-01-01' }
const place = (o: Partial<FoodPlace> & { id: string }): FoodPlace => ({
  name: o.id, area: null, address: null, lat: null, lng: null, cuisine: null, tags: [], status: 'want', priceLevel: null,
  why: null, source: null, mustTry: [], rating: null, addedAt: '2026-01-01', visitedAt: null, days: [], mapUrl: null, ...o,
})
const NOW = new Date('2026-10-15T12:00:00+08:00')

describe('parseFoodPlace', () => {
  it('keeps a minimal valid row and fills defaults', () => {
    expect(parseFoodPlace(base)).toMatchObject({ id: 'FOOD-0001', name: '店', status: 'want', tags: [], lat: null, rating: null })
  })
  it('drops rows missing id/name/addedAt or with an unknown status', () => {
    expect(parseFoodPlace({ ...base, id: '' })).toBeNull()
    expect(parseFoodPlace({ ...base, name: '  ' })).toBeNull()
    expect(parseFoodPlace({ ...base, addedAt: '2026/01/01' })).toBeNull()
    expect(parseFoodPlace({ ...base, status: 'eaten' })).toBeNull()
    expect(parseFoodPlace(null)).toBeNull()
    expect(parseFoodPlace('x')).toBeNull()
  })
  it('nulls out-of-range numbers instead of trusting them', () => {
    const p = parseFoodPlace({ ...base, lat: 123, lng: 121.5, rating: 9, priceLevel: 0 })!
    expect(p.lat).toBeNull()
    expect(p.rating).toBeNull()
    expect(p.priceLevel).toBeNull()
  })
  it('falls back to coordinates in the map link when lat/lng are missing', () => {
    const p = parseFoodPlace({ ...base, mapUrl: 'https://www.google.com/maps/place/x/@25.0365,121.4999,17z' })!
    expect(p).toMatchObject({ lat: 25.0365, lng: 121.4999 })
  })
  it('filters malformed tag / day entries and bad visitedAt', () => {
    const p = parseFoodPlace({ ...base, tags: ['宵夜', 3, ''], days: ['2026-01-01', 'yesterday'], visitedAt: 'soon' })!
    expect(p.tags).toEqual(['宵夜'])
    expect(p.days).toEqual(['2026-01-01'])
    expect(p.visitedAt).toBeNull()
  })
})

describe('parseFoodPayload', () => {
  it('returns available=false for anything that is not {places: []}', () => {
    expect(parseFoodPayload(null).available).toBe(false)
    expect(parseFoodPayload({ places: 'x' }).available).toBe(false)
  })
  it('drops bad rows and duplicate ids but keeps the rest', () => {
    const d = parseFoodPayload({ receivedAt: '2026-10-15T00:00:00Z', places: [base, { ...base, name: '重複' }, { id: 'FOOD-0002' }, { ...base, id: 'FOOD-0003' }] })
    expect(d.available).toBe(true)
    expect(d.places.map(p => p.id)).toEqual(['FOOD-0001', 'FOOD-0003'])
    expect(d.places[0]!.name).toBe('店')
    expect(d.receivedAt).toBe('2026-10-15T00:00:00Z')
  })
})

describe('coordsFromMapUrl', () => {
  it('reads @lat,lng, !3d!4d and q= forms', () => {
    expect(coordsFromMapUrl('https://www.google.com/maps/@22.99,120.20,15z')).toEqual({ lat: 22.99, lng: 120.2 })
    expect(coordsFromMapUrl('https://www.google.com/maps/place/x/data=!3d24.8066!4d120.9686')).toEqual({ lat: 24.8066, lng: 120.9686 })
    expect(coordsFromMapUrl('https://maps.google.com/?q=25.03%2C121.56')).toEqual({ lat: 25.03, lng: 121.56 })
  })
  it('prefers the exact pin (!3d!4d) over the viewport centre (@)', () => {
    expect(coordsFromMapUrl('https://www.google.com/maps/place/x/@25.0,121.0,17z/data=!3d25.1!4d121.1')).toEqual({ lat: 25.1, lng: 121.1 })
  })
  it('returns null for short links, junk and out-of-range values', () => {
    expect(coordsFromMapUrl('https://maps.app.goo.gl/abcd')).toBeNull()
    expect(coordsFromMapUrl(null)).toBeNull()
    expect(coordsFromMapUrl('https://x/@95,121,3z')).toBeNull()
  })
})

describe('filterPlaces / sortPlaces', () => {
  const ps = [
    place({ id: 'A', status: 'want', addedAt: '2026-03-01', tags: ['宵夜'], area: '台北 大安', cuisine: '拉麵' }),
    place({ id: 'B', status: 'visited', addedAt: '2026-01-01', visitedAt: '2026-09-01', rating: 3, area: '台南 中西' }),
    place({ id: 'C', status: 'favorite', addedAt: '2026-02-01', visitedAt: '2026-10-01', rating: 5, why: '湯頭很清' }),
    place({ id: 'D', status: 'want', addedAt: '2026-01-15' }),
    place({ id: 'E', status: 'skip', addedAt: '2026-05-01', rating: 2 }),
  ]
  const all = { status: 'all' as const, tag: null, area: null, query: '' }
  it('been = visited + favorite', () => {
    expect(filterPlaces(ps, { ...all, status: 'been' }).map(p => p.id)).toEqual(['B', 'C'])
  })
  it('matches tag or cuisine, area, and free text (case-insensitive) across why', () => {
    expect(filterPlaces(ps, { ...all, tag: '宵夜' }).map(p => p.id)).toEqual(['A'])
    expect(filterPlaces(ps, { ...all, tag: '拉麵' }).map(p => p.id)).toEqual(['A'])
    expect(filterPlaces(ps, { ...all, area: '台南 中西' }).map(p => p.id)).toEqual(['B'])
    expect(filterPlaces(ps, { ...all, query: '湯頭' }).map(p => p.id)).toEqual(['C'])
  })
  it('oldestWant: wants first, oldest first; then the rest by most recent touch', () => {
    expect(sortPlaces(ps, 'oldestWant').map(p => p.id)).toEqual(['D', 'A', 'C', 'B', 'E'])
  })
  it('rating: highest first, unrated last, stable by id', () => {
    expect(sortPlaces(ps, 'rating').map(p => p.id)).toEqual(['C', 'B', 'E', 'A', 'D'])
  })
  it('does not mutate the input', () => {
    const before = ps.map(p => p.id)
    sortPlaces(ps, 'recent')
    expect(ps.map(p => p.id)).toEqual(before)
  })
})

describe('foodStats', () => {
  it('counts conversion without skip, oldest want, this-year visits and mapped rows', () => {
    const s = foodStats([
      place({ id: 'A', addedAt: '2026-10-05' }),
      place({ id: 'B', addedAt: '2026-01-05', lat: 25, lng: 121 }),
      place({ id: 'C', status: 'visited', visitedAt: '2026-03-01' }),
      place({ id: 'D', status: 'favorite', visitedAt: '2025-12-31' }),
      place({ id: 'E', status: 'skip' }),
    ], NOW)
    expect(s).toMatchObject({ total: 5, want: 2, been: 2, favorite: 1, conversionPct: 50, beenThisYear: 1, mapped: 1 })
    expect(s.oldestWant?.place.id).toBe('B')
    expect(s.oldestWant?.days).toBe(283)
  })
  it('splits 想吃（food）and 想去（non-food）wants, each with its own oldest', () => {
    const s = foodStats([
      place({ id: 'F1', kind: 'food', addedAt: '2026-10-05' }),
      place({ id: 'F2', kind: 'food', addedAt: '2026-09-01' }),
      place({ id: 'S1', kind: 'sight', addedAt: '2026-02-01' }),
      place({ id: 'H1', kind: 'stay', addedAt: '2026-08-01' }),
      place({ id: 'V1', kind: 'sight', status: 'visited', visitedAt: '2026-03-01' }),
    ], NOW)
    expect(s).toMatchObject({ want: 4, wantEat: 2, wantGo: 2 })
    expect(s.oldestWantEat?.place.id).toBe('F2')
    expect(s.oldestWantGo?.place.id).toBe('S1')
    expect(s.oldestWant?.place.id).toBe('S1')           // 全部 want 裡最久的，行為不變
  })
  it('no 想去 at all → wantGo 0 and no oldestWantGo', () => {
    const s = foodStats([place({ id: 'F', kind: 'food' })], NOW)
    expect(s).toMatchObject({ wantEat: 1, wantGo: 0, oldestWantGo: null })
  })
  it('null conversion and no oldest when empty', () => {
    expect(foodStats([], NOW)).toMatchObject({ conversionPct: null, oldestWant: null, total: 0 })
  })
})

describe('wantFilterLabel / oldestWantSortLabel', () => {
  it('follows the selected kind', () => {
    expect(wantFilterLabel('food')).toBe('🔖 想吃')
    expect(wantFilterLabel('sight')).toBe('🔖 想去')
    expect(wantFilterLabel('all')).toBe('🔖 想吃／想去')
    expect(wantFilterLabel(undefined)).toBe('🔖 想吃／想去')
    expect(oldestWantSortLabel('food')).toBe('想吃最久')
    expect(oldestWantSortLabel('sight')).toBe('想去最久')
    expect(oldestWantSortLabel('all')).toBe('想吃／想去最久')
  })
})

describe('tagCounts / areaCounts', () => {
  it('counts cuisine + tags once per place, most common first', () => {
    const ps = [place({ id: 'A', cuisine: '小吃', tags: ['小吃', '宵夜'] }), place({ id: 'B', tags: ['宵夜'] }), place({ id: 'C', area: '台北' }), place({ id: 'D', area: '台北' })]
    expect(tagCounts(ps)).toEqual([['宵夜', 2], ['小吃', 1]])
    expect(areaCounts(ps)).toEqual([['台北', 2]])
  })
})

describe('projectPlaces', () => {
  it('falls back to Taiwan bounds with no coordinates', () => {
    const r = projectPlaces([place({ id: 'A' })], 400, 300)
    expect(r.points).toEqual([])
    expect(r.bounds).toEqual(TAIWAN_BOUNDS)
  })
  it('keeps points inside the box, north up and east right', () => {
    const r = projectPlaces([
      place({ id: 'N', lat: 25.1, lng: 121.5 }),
      place({ id: 'S', lat: 22.6, lng: 120.3 }),
    ], 400, 600, 20)
    const n = r.points.find(p => p.id === 'N')!, s = r.points.find(p => p.id === 'S')!
    expect(n.y).toBeLessThan(s.y)
    expect(n.x).toBeGreaterThan(s.x)
    for (const p of r.points) {
      expect(p.x).toBeGreaterThanOrEqual(20); expect(p.x).toBeLessThanOrEqual(380)
      expect(p.y).toBeGreaterThanOrEqual(20); expect(p.y).toBeLessThanOrEqual(580)
    }
  })
  it('handles a single place without dividing by zero', () => {
    const r = projectPlaces([place({ id: 'A', lat: 25, lng: 121.5 })], 300, 300)
    expect(r.points[0]).toEqual({ id: 'A', x: 150, y: 150, status: 'want' })
  })
})

describe('foodStatusMessage', () => {
  const p = place({ id: 'FOOD-0003', name: '拉麵店' })
  it('builds the HERMES sentence with rating only for been statuses', () => {
    expect(foodStatusMessage(p, 'visited', 4, '')).toBe('🍜✅ FOOD-0003「拉麵店」去過 評分 4')
    expect(foodStatusMessage(p, 'skip', 4, ' 太鹹 ')).toBe('🍜🚫 FOOD-0003「拉麵店」不再去｜太鹹')
    expect(foodStatusMessage(p, 'favorite', 9, '')).toBe('🍜❤️ FOOD-0003「拉麵店」愛店 評分 5')
  })
  it('offers every other status as a next step', () => {
    expect(nextFoodStatuses('want')).toEqual(['visited', 'favorite', 'skip'])
  })
})

describe('helpers', () => {
  it('daysBetween uses Taipei midnight and never goes negative', () => {
    expect(daysBetween('2026-10-14', NOW)).toBe(1)
    expect(daysBetween('2026-12-01', NOW)).toBe(0)
    expect(daysBetween('bad', NOW)).toBe(0)
  })
  it('price and star labels', () => {
    expect(priceLabel(3)).toBe('$$$')
    expect(priceLabel(null)).toBe('—')
    expect(stars(4)).toBe('★★★★☆')
  })
})

describe('sample data', () => {
  it('parses every sample row, is flagged as sample, and exercises the map-link fallback and unmapped case', () => {
    const d = sampleFoodData()
    expect(d.sample).toBe(true)
    expect(d.places).toHaveLength(13)
    expect(d.places.find(p => p.id === 'FOOD-0009')).toMatchObject({ lat: 25.0365, lng: 121.4999 })
    expect(foodStats(d.places, NOW).mapped).toBe(12)
  })
})

describe('相片與種類', () => {
  const base = { id: 'FOOD-0001', name: '店', status: 'want', addedAt: '2026-01-01' }
  it('safeImageUrl 只收 https 與站內絕對路徑', () => {
    expect(safeImageUrl('https://a.example/x.jpg')).toBe('https://a.example/x.jpg')
    expect(safeImageUrl('/media/x.webp')).toBe('/media/x.webp')
    expect(safeImageUrl('http://a.example/x.jpg')).toBeNull()
    expect(safeImageUrl('//evil.example/x.jpg')).toBeNull()
    expect(safeImageUrl('javascript:alert(1)')).toBeNull()
    expect(safeImageUrl('data:image/svg+xml;base64,AAAA')).toBeNull()
    expect(safeImageUrl('https://a.example/a b.jpg')).toBeNull()
    expect(safeImageUrl(42)).toBeNull()
  })
  it('parsePhotos 丟掉壞的、補空欄位、最多 24 張', () => {
    const many = Array.from({ length: 30 }, (_, i) => ({ url: `/m/${i}.jpg` }))
    expect(parsePhotos(many)).toHaveLength(24)
    expect(parsePhotos('x')).toEqual([])
    const [a] = parsePhotos([{ url: '/m/a.jpg', thumb: 'javascript:1', w: -5, h: 300, takenAt: '2026/01/01', caption: ' 好吃 ' }, null, { url: 'ftp://x' }])
    expect(a).toEqual({ url: '/m/a.jpg', thumb: null, w: null, h: 300, takenAt: null, caption: '好吃' })
  })
  it('coverPhoto 優先縮圖、其次原圖、沒有相片回 null', () => {
    expect(coverPhoto({ photos: [] })).toBeNull()
    expect(coverPhoto({ photos: parsePhotos([{ url: '/m/a.jpg' }]) })).toBe('/m/a.jpg')
    expect(coverPhoto({ photos: parsePhotos([{ url: '/m/a.jpg', thumb: '/m/a-t.webp' }]) })).toBe('/m/a-t.webp')
  })
  it('parseFoodPlace 帶 photos 與 kind，kind 不合法時退回 food', () => {
    const p = parseFoodPlace({ ...base, kind: 'sight', photos: [{ url: '/m/a.jpg' }] })!
    expect(p.kind).toBe('sight')
    expect(p.photos).toHaveLength(1)
    expect(parseFoodPlace({ ...base, kind: 'zzz' })!.kind).toBe('food')
    expect(parseFoodPlace(base)!.photos).toEqual([])
  })
})

describe('附近（由近到遠）', () => {
  const taipei = { lat: 25.0330, lng: 121.5654 }
  const mk = (id: string, lat: number | null, lng: number | null, status: 'want' | 'visited' = 'want', kind: 'food' | 'sight' = 'food') =>
    parseFoodPlace({ id, name: id, status, kind, lat, lng, addedAt: '2026-01-01' })!

  it('distanceM：台北 101 到台北車站約 5 公里，同點為 0，對稱', () => {
    const station = { lat: 25.0478, lng: 121.5170 }
    const d = distanceM(taipei, station)
    expect(d).toBeGreaterThan(4800); expect(d).toBeLessThan(5400)
    expect(distanceM(taipei, taipei)).toBe(0)
    expect(distanceM(station, taipei)).toBeCloseTo(d, 6)
  })
  it('bearingDeg：正北 0、正東 90、正南 180、正西 270；標籤', () => {
    expect(bearingDeg(taipei, { lat: taipei.lat + 0.01, lng: taipei.lng })).toBeCloseTo(0, 3)
    expect(bearingDeg(taipei, { lat: taipei.lat, lng: taipei.lng + 0.01 })).toBeCloseTo(90, 0)
    expect(bearingDeg(taipei, { lat: taipei.lat - 0.01, lng: taipei.lng })).toBeCloseTo(180, 3)
    expect(bearingDeg(taipei, { lat: taipei.lat, lng: taipei.lng - 0.01 })).toBeCloseTo(270, 0)
    expect(bearingLabel(0)).toBe('北'); expect(bearingLabel(90)).toBe('東'); expect(bearingLabel(225)).toBe('西南'); expect(bearingLabel(359)).toBe('北'); expect(bearingLabel(-45)).toBe('西北')
  })
  it('formatDistance 的進位', () => {
    expect(formatDistance(3)).toBe('10 m')
    expect(formatDistance(84)).toBe('80 m')
    expect(formatDistance(342)).toBe('340 m')
    expect(formatDistance(999)).toBe('1000 m')
    expect(formatDistance(1234)).toBe('1.2 km')
    expect(formatDistance(48_900)).toBe('48.9 km')
    expect(formatDistance(120_400)).toBe('120 km')
    expect(formatDistance(NaN)).toBe('—'); expect(formatDistance(-1)).toBe('—')
  })
  it('nearbyPlaces：由近到遠、半徑內、沒座標另計、wishOnly 排除去過的', () => {
    const near = mk('N', 25.0340, 121.5654)             // 約 120 m
    const mid = mk('M', 25.0400, 121.5654)              // 約 780 m
    const far = mk('F', 25.1000, 121.5654)              // 約 7.5 km
    const been = mk('B', 25.0335, 121.5654, 'visited')  // 約 55 m，但去過了
    const none = mk('X', null, null)
    const all = [far, none, mid, been, near]
    const r = nearbyPlaces(all, taipei, { radiusM: 3000, wishOnly: true })
    expect(r.items.map(i => i.place.id)).toEqual(['N', 'M'])
    expect(r.unmapped).toBe(1)
    expect(nearbyPlaces(all, taipei, { radiusM: 3000, wishOnly: false }).items.map(i => i.place.id)).toEqual(['B', 'N', 'M'])
    expect(nearbyPlaces(all, taipei, { radiusM: null, wishOnly: true }).items.map(i => i.place.id)).toEqual(['N', 'M', 'F'])
    expect(nearbyPlaces([], taipei, { radiusM: null, wishOnly: true })).toEqual({ items: [], unmapped: 0 })
  })
  it('距離相同時用 id 排序（結果穩定）', () => {
    const a = mk('A', 25.034, 121.5654), b = mk('B', 25.034, 121.5654)
    expect(nearbyPlaces([b, a], taipei, { radiusM: null, wishOnly: false }).items.map(i => i.place.id)).toEqual(['A', 'B'])
  })
  it('種類篩選、想去／想吃用語、導航連結', () => {
    const f = mk('F', 25, 121, 'want', 'food'), s = mk('S', 25, 121, 'want', 'sight')
    const base = { status: 'all' as const, tag: null, area: null, query: '' }
    expect(filterPlacesK([f, s], { ...base, kind: 'sight' }).map(p => p.id)).toEqual(['S'])
    expect(filterPlacesK([f, s], base).map(p => p.id)).toEqual(['F', 'S'])
    expect(statusLabelFor('food', 'want')).toBe('想吃'); expect(statusLabelFor('sight', 'want')).toBe('想去'); expect(statusLabelFor('sight', 'favorite')).toBe('愛店')
    expect(navigateUrl(f)).toBe('https://www.google.com/maps/dir/?api=1&destination=25,121')
    expect(navigateUrl(mk('Z', null, null))).toBeNull()
  })
})
