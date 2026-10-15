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


import { defaultOpenDays, dayDigest, dayPhotoCount, entryPreview, isEntryExpandable, splitEntryText } from './tripsView'

const ent = (text: string, photos = 0, pending = 0) => ({
  time: '09:00', text,
  photos: Array.from({ length: photos }, (_, i) => ({ url: `/m/${i}.jpg`, thumb: null, w: null, h: null, takenAt: null, caption: null })),
  photosPending: pending,
})

describe('splitEntryText（條目文字結構化）', () => {
  it('「類別 — 主題」拆成 chip 與主題，其餘是內文', () => {
    const p = splitEntryText('生活紀錄 — 逛家樂福\n買了牛奶。\n- 麵包\n- 水果')
    expect(p).toMatchObject({ category: '生活紀錄', topic: '逛家樂福', body: '買了牛奶。\n- 麵包\n- 水果', photoMark: false })
  })
  it('沒有類別寫法時整個標題是主題；沒有內文時 body 為空', () => {
    expect(splitEntryText('下午獨自散步吃冰')).toMatchObject({ category: null, topic: '下午獨自散步吃冰', body: '' })
  })
  it('去掉標題結尾的「（附照片）」並標記', () => {
    const p = splitEntryText('中山林散步（附照片）\n天氣很好')
    expect(p).toMatchObject({ topic: '中山林散步', photoMark: true, body: '天氣很好' })
    expect(splitEntryText('散步(附照片)').topic).toBe('散步')
  })
  it('類別最多 12 字；連字號不算分隔；沒有空白的破折號不拆', () => {
    expect(splitEntryText('這是一個超過十二個字的很長很長類別 — 主題').category).toBeNull()
    expect(splitEntryText('早餐 - 路邊小店').category).toBeNull()
    expect(splitEntryText('早餐—路邊小店').category).toBeNull()
  })
  it('標題很長又沒有內文：整段當內文，主題仍是標題', () => {
    const long = '今天'.repeat(40)
    const p = splitEntryText(long)
    expect(p.body).toBe(long)
    expect(p.topic).toBe(long)
  })
  it('空字串與只有空白行', () => {
    expect(splitEntryText('')).toMatchObject({ title: '', topic: '', body: '' })
    expect(splitEntryText('\n\n  \n').topic).toBe('')
  })
  it('前面有空白行時仍以第一個非空行為標題；CRLF 正常處理', () => {
    expect(splitEntryText('\r\n\r\n標題\r\n內文')).toMatchObject({ topic: '標題', body: '內文' })
  })
})

describe('折疊用的小函式', () => {
  it('isEntryExpandable：有內文、相片或處理中相片才能展開', () => {
    expect(isEntryExpandable(ent('短標題'))).toBe(false)
    expect(isEntryExpandable(ent('標題\n內文'))).toBe(true)
    expect(isEntryExpandable(ent('短標題', 1))).toBe(true)
    expect(isEntryExpandable(ent('短標題', 0, 2))).toBe(true)
  })
  it('entryPreview：去掉清單與粗體記號、wikilink 取別名、截短', () => {
    expect(entryPreview('\n- **買了** [[某店|牛奶]]\n其他')).toBe('買了 牛奶')
    expect(entryPreview('x'.repeat(100), 10)).toBe(`${'x'.repeat(10)}…`)
    expect(entryPreview('')).toBe('')
  })
  it('dayDigest：前 n 個主題，超過就加「等 N 則」，過長主題截斷', () => {
    const d = { entries: [ent('早餐 — 豆漿'), ent('散步'), ent('午餐 — 牛肉麵')] }
    expect(dayDigest(d)).toBe('豆漿、散步、牛肉麵')
    expect(dayDigest({ entries: [...d.entries, ent('晚餐')] }, 3)).toBe('豆漿、散步、牛肉麵 等 4 則')
    expect(dayDigest({ entries: [] })).toBe('')
    expect(dayDigest({ entries: [ent('字'.repeat(30))] })).toBe(`${'字'.repeat(18)}…`)
  })
  it('dayPhotoCount 含處理中', () => {
    expect(dayPhotoCount({ entries: [ent('a', 2, 1), ent('b', 0, 3)] })).toBe(6)
  })
  it('defaultOpenDays：進行中展開最新有條目的一天，其他展開第一個有條目的；沒有條目回空', () => {
    const days = [
      { date: '2026-10-15', title: null, placeIds: [], entries: [ent('a')] },
      { date: '2026-10-16', title: null, placeIds: [], entries: [] },
      { date: '2026-10-17', title: null, placeIds: [], entries: [ent('b')] },
    ]
    expect(defaultOpenDays({ status: 'ongoing', days })).toEqual(['2026-10-17'])
    expect(defaultOpenDays({ status: 'done', days })).toEqual(['2026-10-15'])
    expect(defaultOpenDays({ status: 'ongoing', days: [] })).toEqual([])
  })
})
