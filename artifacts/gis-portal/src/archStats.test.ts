import { describe, expect, it } from 'vitest'
import { ageMinutes, cardMetrics, formatValue, isStale, parseArchStats } from './archStats'

const feed = (payload: unknown, available = true) => ({ available, payload })

describe('架構頁節點數字', () => {
  it('available=false 或形狀不對回 null', () => {
    expect(parseArchStats(feed(null, false))).toBeNull()
    expect(parseArchStats(feed({ nodes: {} }))).toBeNull()
    expect(parseArchStats(null)).toBeNull()
  })
  it('整理各節點數字；壞的 metric 被丟掉，error 節點保留錯誤', () => {
    const s = parseArchStats(feed({
      computedAt: '2026-10-22T10:00:00+08:00',
      nodes: {
        L1: { metrics: [{ label: '候選', value: 1234 }, { label: 'x' }, { value: 1 }] },
        L4: { error: 'boom' },
      },
    }))!
    expect(s.nodes['L1']!.metrics).toEqual([{ label: '候選', value: 1234 }])
    expect(s.nodes['L4']).toEqual({ metrics: [], error: 'boom' })
  })
  it('卡片只放前兩個；有 error 或沒資料就不放', () => {
    const m = (n: number) => Array.from({ length: n }, (_, i) => ({ label: `m${i}`, value: i }))
    expect(cardMetrics({ metrics: m(5), error: null })).toHaveLength(2)
    expect(cardMetrics({ metrics: m(5), error: 'x' })).toEqual([])
    expect(cardMetrics(undefined)).toEqual([])
  })
  it('數字加千分位、字串原樣', () => {
    expect(formatValue(12345)).toBe('12,345')
    expect(formatValue('1 / 2')).toBe('1 / 2')
  })
  it('新舊：30 分鐘內算新，超過或無法解析算舊', () => {
    const now = new Date('2026-10-22T10:30:00+08:00')
    expect(ageMinutes('2026-10-22T10:00:00+08:00', now)).toBe(30)
    expect(isStale('2026-10-22T10:00:00+08:00', now)).toBe(false)
    expect(isStale('2026-10-22T09:50:00+08:00', now)).toBe(true)
    expect(isStale('garbage', now)).toBe(true)
  })
})
