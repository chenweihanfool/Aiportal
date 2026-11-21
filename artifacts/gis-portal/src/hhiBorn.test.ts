import { describe, expect, it } from 'vitest'
import type { HhiHistoryPoint } from './boardApi'
import { SCALE_SINCE } from './companion'
import type { Insight } from './insightModel'
import { HIGH, LOW, bornBand, insightsByBand, scoreByDate } from './hhiBorn'

const pt = (date: string, displayedScore: number): HhiHistoryPoint => ({ date, displayedScore })
const ins = (id: string, date: string): Insight => ({
  id, date, time: '21:00', text: `心得 ${id}`, provenance: 'quote', cluster: 'K01', thread: 'TH-a', relation: 'new', parent: null,
  links: { people: [], ideas: [], topics: [] },
})

describe('scoreByDate', () => {
  it('只收 SCALE_SINCE 當天與之後的點', () => {
    const m = scoreByDate([pt('2026-10-29', 90), pt(SCALE_SINCE, 70), pt('2026-11-01', 65)])
    expect(m.has('2026-10-29')).toBe(false)
    expect(m.get(SCALE_SINCE)).toBe(70)
    expect(m.get('2026-11-01')).toBe(65)
  })

  it('分數四捨五入到整數', () => {
    const m = scoreByDate([pt('2026-11-02', 74.5), pt('2026-11-03', 74.4), pt('2026-11-04', 59.6)])
    expect(m.get('2026-11-02')).toBe(75)
    expect(m.get('2026-11-03')).toBe(74)
    expect(m.get('2026-11-04')).toBe(60)
  })

  it('有時間的 date 只取前 10 碼', () => {
    const m = scoreByDate([pt('2026-11-05T23:55:00+08:00', 81)])
    expect(m.get('2026-11-05')).toBe(81)
  })
})

describe('bornBand', () => {
  it('沒有分數是 null', () => {
    expect(bornBand(undefined)).toBe(null)
  })

  it('75 與 60 的邊界', () => {
    expect(bornBand(HIGH)).toBe('high')
    expect(bornBand(HIGH + 1)).toBe('high')
    expect(bornBand(HIGH - 1)).toBe('mid')
    expect(bornBand(LOW)).toBe('mid')
    expect(bornBand(LOW - 1)).toBe('low')
  })
})

describe('insightsByBand', () => {
  const scores = new Map([
    ['2026-11-01', 80], // high
    ['2026-11-02', 50], // low
    ['2026-11-03', 70], // mid（已知但不列入 high／low）
  ])
  const list = [
    ins('A', '2026-11-01'),
    ins('B', '2026-11-02'),
    ins('C', '2026-11-03'),
    ins('D', SCALE_SINCE), // 沒有分數
  ]

  it('依日期分組、新到舊、known 只算有分數的心得', () => {
    const r = insightsByBand(list, scores)
    expect(r.high.map((i) => i.id)).toEqual(['A'])
    expect(r.low.map((i) => i.id)).toEqual(['B'])
    expect(r.known).toBe(3)
  })

  it('同組多則時新到舊', () => {
    const more = new Map([
      ['2026-11-01', 90],
      ['2026-11-04', 85],
      ['2026-11-02', 88],
    ])
    const r = insightsByBand([ins('old', '2026-11-01'), ins('new', '2026-11-04'), ins('mid', '2026-11-02')], more)
    expect(r.high.map((i) => i.id)).toEqual(['new', 'mid', 'old'])
  })

  it('SCALE_SINCE 之前的分數不在表裡，心得就不算 known', () => {
    const r = insightsByBand([ins('X', '2026-10-01')], scoreByDate([pt('2026-10-01', 90)]))
    expect(r.known).toBe(0)
    expect(r.high).toEqual([])
    expect(r.low).toEqual([])
  })
})
