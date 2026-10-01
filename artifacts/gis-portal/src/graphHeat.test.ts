import { describe, expect, it } from 'vitest'
import { CORE_FLOOR, CORE_MID, CORE_PEAK, coreHeatColor, makeHeatScale, hexToHsl, hslToHex, outerHeatColor, outerPeak } from './graphHeat'

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

describe('makeHeatScale', () => {
  // 長尾：400 個關聯數 1、200 個 2~3、60 個 4~9、10 個 10~40、1 個 150（接近實際資料的形狀）
  const counts = [
    ...Array(400).fill(1),
    ...Array.from({ length: 200 }, (_, i) => 2 + (i % 2)),
    ...Array.from({ length: 60 }, (_, i) => 4 + (i % 6)),
    ...Array.from({ length: 10 }, (_, i) => 10 + i * 3),
    150,
  ]
  const scale = makeHeatScale(counts)

  it('is monotonic, bounded to [0,1], and ties share one value', () => {
    const vals = [1, 2, 3, 5, 9, 10, 25, 37, 150].map(scale)
    expect([...vals].sort((a, b) => a - b)).toEqual(vals)
    for (const v of vals) { expect(v).toBeGreaterThanOrEqual(0); expect(v).toBeLessThanOrEqual(1) }
    expect(scale(2)).toBe(scale(2))
    expect(scale(150)).toBeGreaterThan(0.95)
    expect(scale(1)).toBeLessThan(0.3)
  })

  it('actually spreads a heavy long tail across the gradient (regression: 2.14.0 showed only two colors)', () => {
    // 2.14.0 用平方根正規化：同一份資料裡，關聯數 2 到 40 的節點熱度幾乎全擠在 0.05~0.25，肉眼只有兩種顏色。
    // 新算法下，常見的幾個關聯數之間每一步都要有看得出來的差距（≥ 0.05），並且用到大部分色階。
    const steps = [1, 2, 3, 5, 9, 25, 150].map(scale)
    for (let k = 1; k < steps.length; k++) expect(steps[k] - steps[k - 1]).toBeGreaterThanOrEqual(0.05)
    const distinct = new Set(Array.from(new Set(counts)).map(c => Math.round(scale(c) * 11)))
    expect(distinct.size).toBeGreaterThanOrEqual(6)
    expect(Math.min(...steps)).toBe(0)       // 最冷門的一群就是最淺色
  })

  it('also spreads a power-law distribution like real per-person counts, using most of the 10 bands', () => {
    const pl = Array.from({ length: 130 }, (_, i) => Math.max(1, Math.round(150 / (i + 1) ** 1.1)))
    const s2 = makeHeatScale(pl)
    const bands = new Set(pl.map(c => Math.min(9, Math.floor(s2(c) * 10))))
    expect(bands.size).toBeGreaterThanOrEqual(6)
  })

  it('still lets the hottest few stand clearly apart from the rest', () => {
    expect(scale(150) - scale(40)).toBeGreaterThan(0.05)
  })

  it('has no meaningful ordering when all counts are equal, empty, or a single node: 0.5', () => {
    expect(makeHeatScale([3, 3, 3])(3)).toBe(0.5)
    expect(makeHeatScale([])(7)).toBe(0.5)
    expect(makeHeatScale([7])(7)).toBe(0.5)
  })

  it('handles a count it has not seen by interpolating, within bounds', () => {
    const v = makeHeatScale([1, 5, 10])(7)
    expect(v).toBeGreaterThan(0.3)
    expect(v).toBeLessThan(1)
  })

  it('handles two distinct values: lowest near 0, highest near 1', () => {
    const s2 = makeHeatScale([1, 1, 1, 9])
    expect(s2(1)).toBeLessThan(0.2)
    expect(s2(9)).toBeGreaterThan(0.95)
  })
})

describe('core ramp (amber, deeper = hotter)', () => {
  it('goes from a muted amber through amber to a saturated deep orange-red, smoothly', () => {
    const lo = hexToHsl(coreHeatColor(0)), hi = hexToHsl(coreHeatColor(1))
    expect(hi.s).toBeGreaterThan(lo.s + 0.3)
    expect(hi.h).toBeLessThan(lo.h)            // 往橘紅走
    // 色相沿色帶單調往紅走、沒有跳變
    const hues = [0, 0.25, 0.5, 0.75, 1].map(t => hexToHsl(coreHeatColor(t)).h)
    expect([...hues].sort((a, b) => b - a)).toEqual(hues)
    expect(CORE_MID.h).toBeLessThan(CORE_FLOOR.h)
    expect(CORE_MID.h).toBeGreaterThan(CORE_PEAK.h)
    // 相鄰色階（1/12 步）的色差要夠大看得出來（至少一個 RGB 通道差 ≥ 6），同時不能有跳變（< 90）
    for (let k = 0; k < 12; k++) {
      const a = parseInt(coreHeatColor(k / 12).slice(1), 16), b = parseInt(coreHeatColor((k + 1) / 12).slice(1), 16)
      const d = Math.max(...[16, 8, 0].map(sh => Math.abs(((a >> sh) & 255) - ((b >> sh) & 255))))
      expect(d).toBeGreaterThanOrEqual(6)
      expect(d).toBeLessThan(90)
    }
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
