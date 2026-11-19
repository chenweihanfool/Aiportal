import { describe, expect, it } from 'vitest'
import { decorFade, decorLayout, leafJitter, rootFlarePath, soilBand, soilPlate } from './insightTreeArt'

describe('insightTreeArt', () => {
  it('根基外擴是封閉路徑，左右對稱', () => {
    const d = rootFlarePath(100, 300, 20)
    expect(d.startsWith('M')).toBe(true)
    expect(d.endsWith('Z')).toBe(true)
    const nums = d.match(/-?\d+(\.\d+)?/g)!.map(Number)
    expect(nums[0]! + nums[nums.length - 2]!).toBeCloseTo(200, 0)
  })
  it('土壤帶高度被畫布下緣限制', () => {
    expect(soilBand(600, 300, 305).h).toBeCloseTo(3.6, 1)
    expect(soilBand(600, 300, 400).h).toBe(16)
    expect(soilBand(600, 300, 290).h).toBe(0)
    expect(soilBand(600, 300, 400).w).toBe(588)
  })

  it('decorFade：≤5 為 1、≥20 為 0、中間單調下降', () => {
    expect(decorFade(0)).toBe(1)
    expect(decorFade(5)).toBe(1)
    expect(decorFade(20)).toBe(0)
    expect(decorFade(300)).toBe(0)
    let prev = 1
    for (let n = 6; n < 20; n++) { const f = decorFade(n); expect(f).toBeGreaterThan(0); expect(f).toBeLessThan(prev); prev = f }
  })
  it('decorLayout：決定性、數量、避開樹幹、在畫布內', () => {
    const a = decorLayout(640, 300, 320, 18, 3)
    expect(decorLayout(640, 300, 320, 18, 3)).toEqual(a)
    expect(decorLayout(640, 300, 320, 18, 4)).not.toEqual(a)
    expect(a.hills.length).toBe(2)
    expect(a.grass.length).toBeGreaterThanOrEqual(4)
    expect(a.motes.length).toBeGreaterThanOrEqual(3)
    for (const g of a.grass) { expect(Math.abs(g.x - 320)).toBeGreaterThanOrEqual(36); expect(g.x).toBeGreaterThan(0); expect(g.x).toBeLessThan(640) }
    for (const m of a.motes) { expect(m.x).toBeGreaterThanOrEqual(0); expect(m.x).toBeLessThanOrEqual(640); expect(m.y).toBeGreaterThan(0); expect(m.y).toBeLessThan(300); expect(m.r).toBeGreaterThanOrEqual(1); expect(m.r).toBeLessThanOrEqual(2) }
    for (const d of a.hills) {
      expect(d.endsWith('Z')).toBe(true)
      const ys = (d.match(/-?\d+(\.\d+)?,-?\d+(\.\d+)?/g) ?? []).map((p) => Number(p.split(',')[1]))
      expect(Math.max(...ys)).toBeLessThanOrEqual(300)
      expect(Math.min(...ys)).toBeGreaterThan(0)
    }
    const small = decorLayout(320, 200, 160, 12, 1)
    for (const g of small.grass) expect(g.x).toBeLessThan(320)
  })
  it('motes 左右平衡：seed 0..50 兩側都 ≥ 3，且決定性', () => {
    for (let s = 0; s <= 50; s++) {
      const a = decorLayout(800, 320, 400, 20, s)
      expect(decorLayout(800, 320, 400, 20, s).motes).toEqual(a.motes)
      const left = a.motes.filter((m) => m.x < 400).length
      const right = a.motes.filter((m) => m.x > 400).length
      expect(left).toBeGreaterThanOrEqual(3)
      expect(right).toBeGreaterThanOrEqual(3)
    }
  })
  it('soilPlate：單一節點、多節點、靠邊夾住、窄於舞台', () => {
    const one = soilPlate([{ x: 300, half: 9 }], 300, 640)
    expect(one).toEqual({ x: 277, w: 46 })
    const multi = soilPlate([{ x: 200, half: 50 }, { x: 420, half: 9 }], 300, 640)
    expect(multi.x).toBe(136)
    expect(multi.x + multi.w).toBe(443)
    expect(multi.w).toBeLessThan(640)
    const edge = soilPlate([{ x: 10, half: 9 }, { x: 630, half: 12 }], 320, 640)
    expect(edge.x).toBe(0.5)
    expect(edge.x + edge.w).toBeCloseTo(639.5, 1)
  })
  it('leafJitter：決定性且在 ±6° 內，且不是全部同值', () => {
    expect(leafJitter('I-01')).toBe(leafJitter('I-01'))
    const vals = Array.from({ length: 50 }, (_, i) => leafJitter(`I-${i}`))
    for (const v of vals) { expect(v).toBeGreaterThanOrEqual(-6); expect(v).toBeLessThanOrEqual(6) }
    expect(new Set(vals).size).toBeGreaterThan(10)
  })
})
