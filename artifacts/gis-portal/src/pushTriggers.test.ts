import { describe, expect, it } from 'vitest'
import {
  haversineMeters, pinTargetFor, makeMeetingMatcher, meetingCards, nearestPlace, nearbyCard, orderTriggerFirst, parseCalendarFeed, pinDateValid, pinDueOptions, pinnedCards,
  type CalendarFeed, type MeetingMatcher,
} from './pushTriggers'
import { cardKeyOf, type NowCard } from './nowCards'

describe('pinDueOptions', () => {
  it('週日：明天是週一，下週一也是明天', () => {
    const o = pinDueOptions('2026-11-15') // 週日
    expect(o[0]).toMatchObject({ id: 'tomorrow', label: '明天早上', date: '2026-11-16' })
    expect(o[1]).toMatchObject({ id: 'monday', label: '下週一', date: '2026-11-16' })
  })
  it('週一：下週一是 7 天後', () => {
    expect(pinDueOptions('2026-11-16')[1].date).toBe('2026-11-23')
  })
  it('週六：下週一是 2 天後', () => {
    expect(pinDueOptions('2026-11-14')[1].date).toBe('2026-11-16')
  })
  it('跨月與跨年', () => {
    expect(pinDueOptions('2026-11-30')[0].date).toBe('2026-12-01')
    expect(pinDueOptions('2026-11-30')[1].date).toBe('2026-12-07')
    expect(pinDueOptions('2026-12-31')[0].date).toBe('2027-01-01')
    expect(pinDueOptions('2026-12-31')[1].date).toBe('2027-01-04')
  })
})

describe('pinDateValid', () => {
  it('今天～+366 天', () => {
    expect(pinDateValid('2026-11-14', '2026-11-14')).toBe(true)
    expect(pinDateValid('2026-11-13', '2026-11-14')).toBe(false)
    expect(pinDateValid('2027-11-15', '2026-11-14')).toBe(true)
    expect(pinDateValid('2027-11-16', '2026-11-14')).toBe(false)
    expect(pinDateValid('abc', '2026-11-14')).toBe(false)
  })
})

describe('pinnedCards', () => {
  it('轉成 pinned 卡', () => {
    const [c] = pinnedCards([{ id: 7, targetKind: 'case', targetId: 'x', title: '王案判決書', href: '#dossier/case/x', dueDate: '2026-11-12', createdAt: '' }], '2026-11-14')
    expect(c).toMatchObject({ key: 'pinned:7', kind: 'pinned', title: '王案判決書', href: '#dossier/case/x', pinId: 7 })
    expect(c.lines[0]).toBe('你在 11/12 要我提醒')
  })
})

describe('haversine / nearestPlace', () => {
  it('台北車站到台北 101 約 5.9 公里（誤差 <1%）', () => {
    // 緯度 1 度約 111.195 公里：已知值
    const d = haversineMeters({ lat: 25, lng: 121 }, { lat: 26, lng: 121 })
    expect(Math.abs(d - 111_195) / 111_195).toBeLessThan(0.01)
    const e = haversineMeters({ lat: 0, lng: 0 }, { lat: 0, lng: 1 })
    expect(Math.abs(e - 111_195) / 111_195).toBeLessThan(0.01)
    expect(haversineMeters({ lat: 25, lng: 121 }, { lat: 25, lng: 121 })).toBe(0)
  })
  const here = { lat: 25, lng: 121 }
  // 緯度每 0.001 度約 111.2 公尺
  const at = (m: number) => ({ id: `p${m}`, name: `地點${m}`, lat: 25 + m / 111_195, lng: 121 })
  it('略過沒有座標的，取最近的', () => {
    const r = nearestPlace([{ id: 'n', name: '無座標', lat: null, lng: null }, at(800), at(300)], here)
    expect(r?.place.id).toBe('p300')
    expect(Math.round(r!.meters)).toBe(300)
  })
  it('1 公里邊界：990 公尺在、1010 公尺不在', () => {
    expect(nearestPlace([at(990)], here)?.place.id).toBe('p990')
    expect(nearestPlace([at(1010)], here)).toBeNull()
  })
  it('只有無座標或空陣列回 null', () => {
    expect(nearestPlace([{ lat: null, lng: 121 }], here)).toBeNull()
    expect(nearestPlace([], here)).toBeNull()
  })
  it('nearbyCard', () => {
    const c = nearbyCard({ id: 'FOOD-1', name: '好吃麵店' }, 312.4, '2026-11-14')
    expect(c).toMatchObject({ key: 'nearby:FOOD-1:2026-11-14', kind: 'nearby', title: '好吃麵店' })
    expect(c.lines[0]).toBe('距離約 312 公尺')
  })
})

describe('meetingCards', () => {
  // 現在：台北 2026-11-14 10:00 = UTC 02:00
  const now = Date.parse('2026-11-14T10:00:00+08:00')
  const hit: MeetingMatcher = () => ({ label: '知識頁A', href: '#knowledge/a' })
  const feed = (events: CalendarFeed['events'], date = '2026-11-14'): CalendarFeed => ({ computedAt: '', date, events })
  const ev = (start: string, over: Partial<CalendarFeed['events'][number]> = {}) => ({ start, end: '', allDay: false, title: '開會', location: '', ...over })

  it('59 分鐘後出卡，標題與副標', () => {
    const [c] = meetingCards(feed([ev('2026-11-14T10:59:00+08:00')]), now, hit)
    expect(c).toMatchObject({ kind: 'meeting', title: '10:59 開會', key: 'meeting:2026-11-14:2026-11-14T10:59:00+08:00', href: '#knowledge/a' })
    expect(c.lines[0]).toBe('會前看：知識頁A')
  })
  it('61 分鐘後不出卡', () => {
    expect(meetingCards(feed([ev('2026-11-14T11:01:00+08:00')]), now, hit)).toEqual([])
  })
  it('已開始不出卡', () => {
    expect(meetingCards(feed([ev('2026-11-14T09:59:00+08:00')]), now, hit)).toEqual([])
  })
  it('全天不出卡', () => {
    expect(meetingCards(feed([ev('2026-11-14', { allDay: true })]), now, hit)).toEqual([])
  })
  it('feed 不是今天不出卡', () => {
    expect(meetingCards(feed([ev('2026-11-14T10:30:00+08:00')], '2026-11-13'), now, hit)).toEqual([])
  })
  it('matcher 回 null 不出卡；null feed 不出卡', () => {
    expect(meetingCards(feed([ev('2026-11-14T10:30:00+08:00')]), now, () => null)).toEqual([])
    expect(meetingCards(null, now, hit)).toEqual([])
  })
  it('時區：UTC 寫法也以台北顯示', () => {
    const [c] = meetingCards(feed([ev('2026-11-14T02:30:00Z')]), now, hit)
    expect(c.title.startsWith('10:30 ')).toBe(true)
  })
})

describe('parseCalendarFeed / matcher / order', () => {
  it('available:false 與壞格式回 null', () => {
    expect(parseCalendarFeed({ available: false })).toBeNull()
    expect(parseCalendarFeed(null)).toBeNull()
    expect(parseCalendarFeed({ available: true, payload: { date: '2026-11-14', events: [{ start: '2026-11-14', title: 'x', allDay: true }, 5] } })?.events).toHaveLength(1)
  })
  it('matcher：知識頁優先，名稱至少 2 字', () => {
    const m = makeMeetingMatcher([{ id: 't1', name: '土地登記' }, { id: 't2', name: 'A' }], [{ kind: 'case', name: '王案' }])
    expect(m('討論土地登記與王案')).toEqual({ label: '土地登記', href: '#knowledge/t1' })
    expect(m('王案開會')?.href).toBe('#dossier/case/%E7%8E%8B%E6%A1%88')
    expect(m('A 會議')).toBeNull()
  })
  it('orderTriggerFirst', () => {
    const mk = (kind: NowCard['kind'], k: string): NowCard => ({ key: cardKeyOf({ kind: 'quiet', name: k }), kind, forDate: '', at: null, why: '', title: k, lines: [], point: '', rank: 0 })
    expect(orderTriggerFirst([mk('topic', 'a'), mk('pinned', 'b'), mk('meeting', 'c')]).map((c) => c.title)).toEqual(['c', 'b', 'a'])
  })
})

describe('pinTargetFor', () => {
  it('有 hash 的類別才有目標', () => {
    expect(pinTargetFor({ kind: 'topic', id: 't 1', title: 'T' })).toEqual({ targetKind: 'topic', targetId: 't 1', title: 'T', href: '#knowledge/t%201' })
    expect(pinTargetFor({ kind: 'case', id: '王案', title: '王案' })?.href).toBe('#dossier/case/%E7%8E%8B%E6%A1%88')
    expect(pinTargetFor({ kind: 'place', id: 'F1', title: '店' })?.href).toBe('#food')
    expect(pinTargetFor({ kind: 'event', id: 'e', title: 'e' })).toBeNull()
    expect(pinTargetFor({ kind: 'idea', id: 'e', title: 'e' })).toBeNull()
    expect(pinTargetFor({ kind: 'repo', id: 'r', title: 'r' })).toBeNull()
    expect(pinTargetFor({ kind: 'diary', id: '2026-01-01', title: 'e' })).toBeNull()
  })
})
