import { describe, expect, it } from 'vitest'
import { CORE_FLOOR, CORE_PEAK, coreHeatColor, heatT, hexToHsl, hslToHex, outerHeatColor, outerPeak } from './graphHeat'

describe('hex <-> hsl', () => {
  it('round-trips colors (within rounding)', () => {
    for (const hex of ['#f5a623', '#aab4c4', '#5d6472', '#7fa6dc', '#86c4a0', '#000000', '#ffffff']) {
      const back = hslToHex(hexToHsl(hex))
      const a = parseInt(hex.slice(1), 16), b = parseInt(back.slice(1), 16)
      for (const shift of [16, 8, 0]) expect(Math.abs(((a >> shift) & 255) - ((b >> shift) & 255))).toBeLessThanOrEqual(2)
    }
  })

  it('returns a neutral hsl for garbage input', () => {
    expect(hexToHsl('not-a-color')).toEqual({ h: 0, s: 0, l: 0 })
  })
})

describe('heatT', () => {
  it('is 0 at the minimum, 1 at the maximum, and monotonic', () => {
    expect(heatT(1, 1, 100)).toBe(0)
    expect(heatT(100, 1, 100)).toBe(1)
    const ts = [1, 4, 9, 25, 64, 100].map(c => heatT(c, 1, 100))
    expect([...ts].sort((a, b) => a - b)).toEqual(ts)
  })

  it('uses a square-root scale so a long tail is not crushed into the pale end', () => {
    expect(heatT(25, 1, 100)).toBeCloseTo(4 / 9, 5) // (5-1)/(10-1)；線性映射會是 0.24
  })

  it('has no meaningful ordering when all counts are equal (or only one node): 0.5', () => {
    expect(heatT(3, 3, 3)).toBe(0.5)
    expect(heatT(7, 7, 7)).toBe(0.5)
  })

  it('clamps out-of-range inputs', () => {
    expect(heatT(500, 1, 100)).toBe(1)
    expect(heatT(0, 1, 100)).toBe(0)
  })
})

describe('core ramp (amber, deeper = hotter)', () => {
  it('goes from a muted amber to a saturated deep orange', () => {
    const lo = hexToHsl(coreHeatColor(0)), hi = hexToHsl(coreHeatColor(1))
    expect(hi.s).toBeGreaterThan(lo.s + 0.3)
    expect(hi.h).toBeLessThan(lo.h)            // 往橘紅走
  })

  it('never gets lighter than the outer index nodes: floor lightness <= every non-core hub color', () => {
    // 對應 RelationshipUniverse 的 NON_CORE_COLOR（人／案／物／概念／方法）
    const outer = ['#aab4c4', '#8f8f88', '#74839a', '#7fa6dc', '#86c4a0']
    for (const c of outer) expect(CORE_FLOOR.l).toBeLessThanOrEqual(hexToHsl(c).l)
    expect(CORE_PEAK.l).toBeLessThanOrEqual(0.55)   // 最深也要在深色背景上看得清楚，不能是近黑
    expect(CORE_FLOOR.l).toBeGreaterThanOrEqual(0.35)
  })
})

describe('outer ramp', () => {
  it('starts at the original color and ends deeper (more saturated, not lighter), same hue', () => {
    for (const base of ['#aab4c4', '#8f8f88', '#74839a', '#7fa6dc', '#86c4a0']) {
      const start = hexToHsl(outerHeatColor(base, 0)), end = hexToHsl(outerHeatColor(base, 1))
      const b = hexToHsl(base)
      expect(Math.abs(start.l - b.l)).toBeLessThan(0.01)
      expect(end.l).toBeLessThanOrEqual(b.l + 0.001)
      expect(end.s).toBeGreaterThanOrEqual(b.s)
      expect(outerPeak(base).h).toBeCloseTo(b.h, 5)
    }
  })

  it('stays visible: the deepest outer color is not darker than 0.32 lightness', () => {
    expect(outerPeak('#5d6472').l).toBeGreaterThanOrEqual(0.32)
  })
})
