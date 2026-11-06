import { describe, expect, it } from 'vitest'
import type { CompanionData } from './companion'
import { socialRecent } from './socialRecent'

const TODAY = '2026-11-14'
const day = (back: number) => new Date(Date.UTC(2026, 10, 14 - back)).toISOString().slice(0, 10)
const data = (socialDays: CompanionData['socialDays']): CompanionData => ({ computedAt: '2026-11-14T00:00:00Z', date: TODAY, onThisDay: [], quietPeople: [], socialDays })
const types = (face_to_face: number, call: number, text: number) => ({ face_to_face, call, text })

describe('socialRecent', () => {
  it('沒資料：14 格全空、hasDetail false', () => {
    const r = socialRecent(null, TODAY)
    expect(r.strip).toHaveLength(14)
    expect(r.strip.every((c) => c.level === 'none')).toBe(true)
    expect(r.hasDetail).toBe(false)
    expect(r.people).toEqual([])
  })
  it('strip：今天最右；依 types 最強；無 types 但有人 → text', () => {
    const r = socialRecent(data([
      { date: day(0), people: 2, names: ['甲', '乙'], types: types(1, 1, 0) },
      { date: day(1), people: 1, names: ['甲'], types: types(0, 1, 1) },
      { date: day(2), people: 1, names: ['丙'], types: types(0, 0, 1) },
      { date: day(3), people: 1 },
    ]), TODAY)
    expect(r.strip[13]).toEqual({ date: day(0), level: 'face', names: ['甲', '乙'] })
    expect(r.strip[12]!.level).toBe('call')
    expect(r.strip[11]!.level).toBe('text')
    expect(r.strip[10]!.level).toBe('text')
    expect(r.strip[0]!.date).toBe(day(13))
    expect(r.strip[9]!.level).toBe('none')
    expect(r.hasDetail).toBe(true)
  })
  it('people：計次降冪、同次數依名字、最多 8 人、只算近 14 天', () => {
    const names = ['一', '二', '三', '四', '五', '六', '七', '八', '九']
    const r = socialRecent(data([
      { date: day(0), people: 9, names },
      { date: day(1), people: 1, names: ['五'] },
      { date: day(14), people: 1, names: ['十'] },
    ]), TODAY)
    expect(r.people).toHaveLength(8)
    expect(r.people[0]).toEqual({ name: '五', count: 2 })
    expect(r.people.some((p) => p.name === '十')).toBe(false)
  })
  it('compare：本 14 天 vs 前 14 天的人數、互動天數、見面次數', () => {
    const r = socialRecent(data([
      { date: day(0), people: 2, names: ['甲', '乙'], types: types(2, 0, 0) },
      { date: day(5), people: 1, names: ['甲'], types: types(1, 0, 0) },
      { date: day(14), people: 1, names: ['丙'], types: types(1, 0, 0) },
      { date: day(20), people: 1, names: ['丁'], types: types(0, 1, 0) },
      { date: day(27), people: 2, names: ['丙', '戊'], types: types(0, 0, 2) },
      { date: day(28), people: 5, names: ['己'] },
    ]), TODAY)
    expect(r.compare.current).toEqual({ people: 2, days: 2, meets: 3 })
    expect(r.compare.previous).toEqual({ people: 3, days: 3, meets: 1 })
    expect(r.compare.approx).toBe(false)
  })
  it('沒有 names 時用 people 最大值近似並標記 approx', () => {
    const r = socialRecent(data([{ date: day(0), people: 2 }, { date: day(3), people: 4 }]), TODAY)
    expect(r.compare.current.people).toBe(4)
    expect(r.compare.approx).toBe(true)
    expect(r.hasDetail).toBe(false)
  })
})
