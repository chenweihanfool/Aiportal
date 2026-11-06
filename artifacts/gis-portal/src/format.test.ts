import { describe, expect, it } from 'vitest'
import { hhiTone, scoreColor } from './format'
import { SCORE_SCALE, SCORE_THRESHOLDS } from './theme'

describe('scoreColor（分數色階，越綠越好）', () => {
  it.each([
    [34, '#e2584f'], [35, '#d9772e'], [49, '#d9772e'],
    [50, '#e8b23d'], [64, '#e8b23d'],
    [65, '#9cc44a'], [79, '#9cc44a'],
    [80, '#34c26b'], [100, '#34c26b'],
  ])('%s → %s', (score, color) => {
    expect(scoreColor(score)).toBe(color)
  })
  it('色階由低到高、門檻為 35／50／65／80', () => {
    expect([SCORE_SCALE.crit, SCORE_SCALE.concern, SCORE_SCALE.warn, SCORE_SCALE.good, SCORE_SCALE.great]).toEqual(['#e2584f', '#d9772e', '#e8b23d', '#9cc44a', '#34c26b'])
    expect([...SCORE_THRESHOLDS]).toEqual([35, 50, 65, 80])
  })
})

describe('hhiTone', () => {
  it('80 分以上是綠色，不是琥珀色', () => {
    expect(hhiTone(85).color).toBe('#34c26b')
    expect(hhiTone(85)).toEqual({ color: '#34c26b', label: '很幸福' })
  })
  it('門檻與標籤不變', () => {
    expect(hhiTone(80)).toEqual({ color: '#34c26b', label: '很幸福' })
    expect(hhiTone(65)).toEqual({ color: '#9cc44a', label: '穩定前進' })
    expect(hhiTone(50)).toEqual({ color: '#e8b23d', label: '尚可，需留意' })
    expect(hhiTone(35)).toEqual({ color: '#d9772e', label: '需調整' })
    expect(hhiTone(34)).toEqual({ color: '#e2584f', label: '警報，先照顧自己' })
  })
})
