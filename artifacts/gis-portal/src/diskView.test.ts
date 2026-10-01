import { describe, expect, it } from 'vitest'
import { describeForecast, formatBytes, formatSignedBytes, pickBaseline, storageShares } from './diskView'

describe('formatBytes', () => {
  it.each([
    [0, '0 B'], [512, '512 B'], [2_500, '3 KB'], [1_500_000, '1.5 MB'], [250_000_000, '250 MB'],
    [1_230_000_000, '1.23 GB'], [18_000_000_000, '18.0 GB'],
  ])('%s → %s', (n, s) => expect(formatBytes(n)).toBe(s))
  it('signed: tiny change is 持平', () => {
    expect(formatSignedBytes(50_000)).toBe('持平')
    expect(formatSignedBytes(300_000_000)).toBe('+300 MB')
    expect(formatSignedBytes(-2_000_000_000)).toBe('−2.00 GB')
  })
})

describe('storageShares', () => {
  const items = [{ label: 'vault', bytes: 2e9 }, { label: 'pg', bytes: 1e9 }]
  it('sorts desc and adds an unclassified remainder when used total is known', () => {
    const r = storageShares(items, 6e9, null)
    expect(r.map(x => x.label)).toEqual(['其他（未歸類）', 'vault', 'pg'])
    expect(r[0]).toMatchObject({ bytes: 3e9 })
    expect(r.reduce((a, b) => a + b.share, 0)).toBeCloseTo(1, 5)
  })
  it('no remainder when used < measured sum; share relative to the sum', () => {
    const r = storageShares(items, 2e9, null)
    expect(r.map(x => x.label)).toEqual(['vault', 'pg'])
    expect(r[0]!.share).toBeCloseTo(2 / 3, 5)
  })
  it('delta only for labels present in the baseline', () => {
    const r = storageShares(items, null, [{ label: 'vault', bytes: 1.5e9 }])
    expect(r.find(x => x.label === 'vault')!.delta).toBe(5e8)
    expect(r.find(x => x.label === 'pg')!.delta).toBeNull()
  })
  it('empty → empty', () => expect(storageShares([], 1e9, null)).toEqual([]))
})

describe('describeForecast', () => {
  it('insufficient', () => expect(describeForecast({ basedOnDays: 1, insufficient: true, growthGbPerDay: null, daysUntilFull: null }).tone).toBe('dim'))
  it('flat → ok', () => expect(describeForecast({ basedOnDays: 10, insufficient: false, growthGbPerDay: 0, daysUntilFull: null })).toMatchObject({ tone: 'ok' }))
  it('growth tones by days', () => {
    const mk = (d: number) => describeForecast({ basedOnDays: 14, insufficient: false, growthGbPerDay: 0.35, daysUntilFull: d })
    expect(mk(10).tone).toBe('crit')
    expect(mk(30).tone).toBe('warn')
    expect(mk(120).tone).toBe('ok')
    expect(mk(120).text).toContain('350 MB')
    expect(mk(120).text).toContain('4 個月')
    expect(mk(900).text).toContain('一年以上')
  })
  it('null forecast', () => expect(describeForecast(null).tone).toBe('dim'))
})

describe('pickBaseline', () => {
  const h = ['2026-09-20', '2026-09-24', '2026-09-28', '2026-09-30', '2026-10-01'].map(date => ({ date }))
  it('picks the closest to N days ago, never a too-recent one', () => {
    expect(pickBaseline(h, '2026-10-01', 7)!.date).toBe('2026-09-24')
    expect(pickBaseline(h, '2026-10-01', 30)!.date).toBe('2026-09-20')
  })
  it('null when everything is too recent', () => {
    expect(pickBaseline([{ date: '2026-10-01' }, { date: '2026-09-30' }], '2026-10-01', 7)).toBeNull()
  })
})

describe('storageShares notes', () => {
  it('carries the note (e.g. reclaimable) through to the row', () => {
    const r = storageShares([{ label: 'docker build cache', bytes: 25.9e9, note: '可回收 17.3 GB' }, { label: 'vault', bytes: 2e9 }], null, null)
    expect(r[0]).toMatchObject({ label: 'docker build cache', note: '可回收 17.3 GB' })
    expect(r[1]!.note).toBeUndefined()
  })
})
