import { describe, expect, it } from 'vitest'
import { addDays, RANK } from './nowCards'
import {
  ideaAgeCard, isoWeek, recencyFor, travelFreshCard, type IdeaForAge, type PlaceForFresh, type TravelForFresh,
} from './nowPushesC'

const TODAY = '2026-11-22'

const bornDaysAgo = (id: string, days: number, o: Partial<IdeaForAge> = {}): IdeaForAge => ({
  id, title: id, status: 'new', bornAt: addDays(TODAY, -days), backfill: false, ...o,
})

const travel = (o: Partial<TravelForFresh> = {}): TravelForFresh => ({
  daysSinceLastTrip: 30, hasUpcomingTrip: false, travelScore: null,
  recencyScore: null, frequencyScore: 60, foodScore: null, ...o,
})

const place = (id: string, addedAt: string, o: Partial<PlaceForFresh> = {}): PlaceForFresh => ({
  id, name: id, area: '台北 大安', status: 'want', addedAt, ...o,
})

describe('isoWeek', () => {
  it('ISO 8601 週次（週一起算）', () => {
    expect(isoWeek('2026-11-16')).toBe('2026-W47')
    expect(isoWeek('2026-11-22')).toBe('2026-W47')
    expect(isoWeek('2026-11-23')).toBe('2026-W48')
    expect(isoWeek('2026-01-01')).toBe('2026-W01')
  })
})

describe('ideaAgeCard', () => {
  it('21 ≤ 年齡 < 28 才算；20、28 天排除', () => {
    const card = ideaAgeCard({
      ideas: [bornDaysAgo('A', 20), bornDaysAgo('B', 21), bornDaysAgo('C', 27), bornDaysAgo('D', 28)],
      today: TODAY,
    })
    expect(card?.title).toBe('2 個想法快過期')
    // bornAt 由舊到新（年齡大的先）
    expect(card?.lines).toEqual(['C（還剩 1 天）', 'B（還剩 7 天）'])
    expect(card?.kind).toBe('ideaAge')
    expect(card?.forDate).toBe(TODAY)
    expect(card?.at).toBeNull()
    expect(card?.rank).toBe(RANK.ideaAge)
    expect(card?.href).toBe('#ideas')
  })

  it('backfill 與非候選狀態（doing／done／evaluating 以外）都不算；evaluating 算', () => {
    const card = ideaAgeCard({
      ideas: [
        bornDaysAgo('A', 25, { backfill: true }),
        bornDaysAgo('B', 25, { status: 'doing' }),
        bornDaysAgo('C', 25, { status: 'shelved' }),
        bornDaysAgo('D', 25, { status: 'evaluating' }),
      ],
      today: TODAY,
    })
    expect(card?.title).toBe('1 個想法快過期')
    expect(card?.lines).toEqual(['D（還剩 3 天）'])
  })

  it('超過 3 個取最舊的 3 個', () => {
    const card = ideaAgeCard({
      ideas: [bornDaysAgo('A', 21), bornDaysAgo('B', 22), bornDaysAgo('C', 23), bornDaysAgo('D', 24), bornDaysAgo('E', 25)],
      today: TODAY,
    })
    expect(card?.title).toBe('3 個想法快過期')
    expect(card?.lines).toEqual(['E（還剩 3 天）', 'D（還剩 4 天）', 'C（還剩 5 天）'])
  })

  it('沒有資料或沒有候選回 null', () => {
    expect(ideaAgeCard({ ideas: null, today: TODAY })).toBeNull()
    expect(ideaAgeCard({ ideas: [], today: TODAY })).toBeNull()
    expect(ideaAgeCard({ ideas: [bornDaysAgo('A', 5)], today: TODAY })).toBeNull()
  })

  it('同一週 key 相同、跨週不同；標題與天數不進 key', () => {
    const a = ideaAgeCard({ ideas: [{ id: 'A', title: 'A', status: 'new', bornAt: '2026-10-26', backfill: false }], today: '2026-11-16' })
    const b = ideaAgeCard({ ideas: [{ id: 'B', title: 'B', status: 'new', bornAt: '2026-10-28', backfill: false }], today: '2026-11-22' })
    const c = ideaAgeCard({ ideas: [{ id: 'A', title: 'A', status: 'new', bornAt: '2026-10-29', backfill: false }], today: '2026-11-23' })
    expect(a?.key).toBe(b?.key)
    expect(b?.key).not.toBe(c?.key)
    expect(b?.key).toBe('ideaAge:2026-W47')
  })
})

describe('recencyFor', () => {
  it('3 天內 100、線性遞減、最低 0', () => {
    expect(recencyFor(0)).toBe(100)
    expect(recencyFor(3)).toBe(100)
    expect(recencyFor(30)).toBe(70)
    expect(recencyFor(44)).toBe(54)
    expect(recencyFor(200)).toBe(0)
  })
})

describe('travelFreshCard', () => {
  it('travel 為 null、有已排定行程、天數 null 或 < 21 都回 null', () => {
    expect(travelFreshCard({ travel: null, places: null, today: TODAY })).toBeNull()
    expect(travelFreshCard({ travel: travel({ hasUpcomingTrip: true }), places: null, today: TODAY })).toBeNull()
    expect(travelFreshCard({ travel: travel({ daysSinceLastTrip: null }), places: null, today: TODAY })).toBeNull()
    expect(travelFreshCard({ travel: travel({ daysSinceLastTrip: 20 }), places: null, today: TODAY })).toBeNull()
    expect(travelFreshCard({ travel: travel({ daysSinceLastTrip: 21 }), places: null, today: TODAY })).not.toBeNull()
  })

  it('沒有 food：0.5／0.5；14 天後 recency 54 → 總分 57', () => {
    const card = travelFreshCard({ travel: travel({ daysSinceLastTrip: 30, frequencyScore: 60, foodScore: null }), places: null, today: TODAY })
    // 現在 recency 70 → 0.5×70＋0.5×60＝65；14 天後 recency 54 → 57
    expect(card?.title).toBe('再 14 天沒出門，旅遊分數約 65 → 57')
    expect(card?.why).toBe('距上次旅行 30 天')
    expect(card?.kind).toBe('travelFresh')
    expect(card?.forDate).toBe(TODAY)
    expect(card?.at).toBeNull()
    expect(card?.rank).toBe(RANK.travelFresh)
    expect(card?.href).toBe('#food')
  })

  it('有 food：0.4／0.4／0.2；有 travelScore 就用它當現在分數', () => {
    const card = travelFreshCard({
      travel: travel({ daysSinceLastTrip: 30, frequencyScore: 60, foodScore: 50, travelScore: 66 }),
      places: null, today: TODAY,
    })
    // 14 天後：0.4×54＋0.4×60＋0.2×50＝55.6 → 56
    expect(card?.title).toBe('再 14 天沒出門，旅遊分數約 66 → 56')
  })

  it('建議去最想去且最早加入（status want）的一間；沒有就省略', () => {
    const card = travelFreshCard({
      travel: travel(), today: TODAY,
      places: [
        place('P2', '2026-11-01', { name: '拉麵店', area: '台中 西區' }),
        place('P1', '2026-10-01', { name: '小吃攤', area: '台北 大安' }),
        place('P3', '2026-09-01', { name: '去過的店', status: 'been' }),
      ],
    })
    expect(card?.lines).toEqual(['去 小吃攤（台北 大安）？'])
    expect(travelFreshCard({ travel: travel(), places: [place('P3', '2026-09-01', { status: 'been' })], today: TODAY })?.lines).toEqual([])
    expect(travelFreshCard({ travel: travel(), places: null, today: TODAY })?.lines).toEqual([])
  })

  it('同一週 key 相同、跨週不同', () => {
    const a = travelFreshCard({ travel: travel(), places: null, today: '2026-11-16' })
    const b = travelFreshCard({ travel: travel(), places: null, today: '2026-11-22' })
    const c = travelFreshCard({ travel: travel(), places: null, today: '2026-11-23' })
    expect(a?.key).toBe(b?.key)
    expect(b?.key).not.toBe(c?.key)
    expect(b?.key).toBe('travelFresh:2026-W47')
  })

  it('讀不到 frequencyScore 就算不出總分，回 null', () => {
    expect(travelFreshCard({ travel: travel({ frequencyScore: null }), places: null, today: TODAY })).toBeNull()
  })
})
