import { describe, it, expect } from 'vitest'
import { EDGE_LEVELS, IDLE_EDGE_ALPHA_MAX, edgeLevel, hubDamp, idleEdgeAlpha, nearFade } from './universeStyle'

describe('idleEdgeAlpha', () => {
  it('keeps the readable 0.3 for small graphs and thins out as links grow', () => {
    expect(idleEdgeAlpha(10)).toBe(IDLE_EDGE_ALPHA_MAX)
    expect(idleEdgeAlpha(733)).toBe(IDLE_EDGE_ALPHA_MAX) // 220/733 ≈ 0.3，剛好還沒開始變淡
    expect(idleEdgeAlpha(1100)).toBeCloseTo(0.2, 6)
    expect(idleEdgeAlpha(4000)).toBeCloseTo(0.055, 6)
    expect(idleEdgeAlpha(4000)).toBeLessThan(idleEdgeAlpha(1000))
  })
  it('does not divide by zero', () => {
    expect(idleEdgeAlpha(0)).toBe(IDLE_EDGE_ALPHA_MAX)
  })
})

describe('hubDamp', () => {
  it('does not damp ordinary nodes and damps hubs by 1/sqrt(degree)', () => {
    expect(hubDamp(1)).toBe(1)
    expect(hubDamp(64)).toBe(1)
    expect(hubDamp(400)).toBeCloseTo(0.4, 6)
  })
})

describe('edgeLevel', () => {
  const a = 0.0555
  it('quantises into 1..EDGE_LEVELS and the front-most undamped edge gets the top level', () => {
    expect(edgeLevel(1, a, 1)).toBe(EDGE_LEVELS)
    expect(edgeLevel(0.5, a, 1)).toBe(EDGE_LEVELS / 2)
  })
  it('never exceeds the top level and never goes below 0', () => {
    expect(edgeLevel(5, a, 1)).toBe(EDGE_LEVELS)
    expect(edgeLevel(0, a, 1)).toBe(0)
    expect(edgeLevel(-1, a, 1)).toBe(0)
  })
  it('a damped hub edge lands in a lower level than the same edge undamped', () => {
    expect(edgeLevel(1, a, hubDamp(400))).toBeLessThan(edgeLevel(1, a, 1))
  })
  it('a zero alpha means nothing is drawn', () => {
    expect(edgeLevel(1, 0, 1)).toBe(0)
  })
})

describe('nearFade', () => {
  it('is 1 up to the cap, then falls off but never below 0.2', () => {
    expect(nearFade(1.5, 2)).toBe(1)
    expect(nearFade(2, 2)).toBe(1)
    expect(nearFade(4, 2)).toBeCloseTo(0.5, 6)
    expect(nearFade(100, 2)).toBe(0.2)
  })
})
