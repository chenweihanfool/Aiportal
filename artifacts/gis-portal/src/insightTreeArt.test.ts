import { describe, expect, it } from 'vitest'
import { rootFlarePath, soilBand } from './insightTreeArt'

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
})
