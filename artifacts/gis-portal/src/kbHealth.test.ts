import { describe, expect, it } from 'vitest'
import { ageText, kbHealthCells } from './kbHealth'

const NOW = Date.parse('2026-10-16T06:00:00Z')
const layer = (o: Record<string, unknown> = {}) => ({ backlog: 0, lastRunTs: NOW - 5 * 3600e3, health: 'ok', processed: 4, failed: 0, ...o })
const full = () => ({
  graph: { newEventsThisWeek: 23, newPeopleThisWeek: 2 },
  pipeline: { L1: layer(), L2: layer({ backlog: 12 }), L3: layer({ processed: 9, failed: 1 }), L4: layer(), L5: layer({ backlog: 3 }) },
  mind: { score: 71.4, conversion: 90.2, linkHealth: 80, vitality: 55.5, rhythm: 66, stale: false },
  now: NOW,
})
const by = (cells: ReturnType<typeof kbHealthCells>, k: string) => cells.find((c) => c.key === k)!

describe('kbHealthCells', () => {
  it('summarises the four raw numbers', () => {
    const c = kbHealthCells(full())
    expect(by(c, 'newEvents')).toMatchObject({ value: '23', sub: '新人物 +2', tone: null })
    expect(by(c, 'backlog')).toMatchObject({ value: '15', sub: 'L2 12・L5 3', tone: null })
    expect(by(c, 'l3')).toMatchObject({ value: '5 小時前', sub: '處理 9・失敗 1', tone: null })
    expect(by(c, 'score')).toMatchObject({ value: '71', sub: '轉化 90・連結 80・活化 56・節奏 66', tone: null })
  })
  it('flags trouble: zero new events, big backlog, crit L3, stale/low score', () => {
    const i = full()
    i.graph.newEventsThisWeek = 0
    i.pipeline.L2 = layer({ backlog: 25 })
    i.pipeline.L3 = layer({ health: 'crit' })
    i.mind = { score: 35, stale: false } as never
    const c = kbHealthCells(i)
    expect(by(c, 'newEvents').tone).toBe('warn')
    expect(by(c, 'backlog')).toMatchObject({ value: '28', tone: 'warn' })
    expect(by(c, 'l3').tone).toBe('crit')
    expect(by(c, 'score').tone).toBe('crit')
    i.mind = { score: 80, conversion: 90, stale: true } as never
    expect(by(kbHealthCells(i), 'score')).toMatchObject({ tone: 'warn', sub: '轉化 90（已過期）' })
  })
  it('L3 not run for over 36 hours is a warning', () => {
    const i = full()
    i.pipeline.L3 = layer({ lastRunTs: NOW - 40 * 3600e3 })
    expect(by(kbHealthCells(i), 'l3')).toMatchObject({ value: '40 小時前', tone: 'warn' })
  })
  it('missing data shows dashes, never zeros', () => {
    const c = kbHealthCells({ graph: null, pipeline: null, mind: null, now: NOW })
    expect(c.map((x) => x.value)).toEqual(['—', '—', '—', '—'])
    expect(by(c, 'backlog').sub).toBeNull()
    expect(by(c, 'score').tone).toBe('dim')
    const partial = kbHealthCells({ graph: { newEventsThisWeek: 'x' }, pipeline: { L1: { backlog: null } }, mind: { score: 'NaN' }, now: NOW })
    expect(partial.map((x) => x.value)).toEqual(['—', '—', '—', '—'])
  })
  it('all layers empty says so', () => {
    const i = full()
    i.pipeline = { L1: layer(), L2: layer(), L3: layer(), L4: layer(), L5: layer() }
    expect(by(kbHealthCells(i), 'backlog')).toMatchObject({ value: '0', sub: '各層都清空了' })
  })
  it('ageText', () => {
    expect(ageText(NOW - 30 * 60e3, NOW)).toBe('30 分鐘前')
    expect(ageText(NOW - 47 * 3600e3, NOW)).toBe('47 小時前')
    expect(ageText(NOW - 72 * 3600e3, NOW)).toBe('3 天前')
    expect(ageText(NOW + 5 * 60e3, NOW)).toBe('0 分鐘前')
  })
})
