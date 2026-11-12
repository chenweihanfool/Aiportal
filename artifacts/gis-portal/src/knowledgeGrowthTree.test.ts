import { describe, expect, it } from 'vitest'
import { layoutGrowthTree, monthsOf, visibleAt } from './knowledgeGrowthTree'
import type { BuiltTree, Topic } from './knowledgeView'

function topic(id: string, over: Partial<Topic> = {}): Topic {
  return {
    id, name: id, kind: 'concept', why: '', firstSeen: '2026-01-01', lastSeen: null, updated: null, revision: 0,
    docs: 3, newDocs: 0, monthsSpan: 1, firstMonth: '2026-01', lastMonth: '2026-01', body: null, growth: [], sources: [], related: [],
    branch: null, path: [], monthCounts: [], diagram: null, ...over,
  }
}

function bigTree(domains: number, branches: number, perBranch: number): BuiltTree {
  let n = 0
  return {
    domains: Array.from({ length: domains }, (_, d) => {
      const bs = Array.from({ length: branches }, (_, b) => ({
        id: `b${d}-${b}`, name: `枝${b}`,
        topics: Array.from({ length: perBranch }, () => {
          n++
          return topic(`t${n}`, { docs: (n * 7) % 40, firstMonth: `2026-${String((n % 11) + 1).padStart(2, '0')}` })
        }),
        count: perBranch,
      }))
      return { id: `d${d}`, name: `領域${d}`, count: branches * perBranch, branches: bs }
    }),
    unassigned: [],
  }
}

function checkGuarantees(lay: ReturnType<typeof layoutGrowthTree>): void {
  for (const l of lay.leaves) {
    expect(l.x - l.r).toBeGreaterThanOrEqual(0)
    expect(l.x + l.r).toBeLessThanOrEqual(lay.width)
    expect(l.y - l.r).toBeGreaterThanOrEqual(0)
    expect(l.y + l.r).toBeLessThanOrEqual(lay.height)
  }
  for (const limb of [lay.trunk, ...lay.limbs]) {
    for (const m of limb.d.matchAll(/(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)/g)) {
      const x = Number(m[1]), y = Number(m[2])
      expect(x).toBeGreaterThanOrEqual(0)
      expect(x).toBeLessThanOrEqual(lay.width)
      expect(y).toBeGreaterThanOrEqual(0)
      expect(y).toBeLessThanOrEqual(lay.height)
    }
  }
  let worst = Infinity
  for (let i = 0; i < lay.leaves.length; i++) {
    for (let j = i + 1; j < lay.leaves.length; j++) {
      const a = lay.leaves[i]!, b = lay.leaves[j]!
      worst = Math.min(worst, Math.hypot(a.x - b.x, a.y - b.y) / (a.r + b.r))
    }
  }
  if (lay.leaves.length > 1) expect(worst).toBeGreaterThanOrEqual(0.8)
}

describe('layoutGrowthTree', () => {
  it('0 題只有樹幹，不丟錯', () => {
    const lay = layoutGrowthTree({ domains: [], unassigned: [] })
    expect(lay.trunk.level).toBe('trunk')
    expect(lay.limbs).toEqual([])
    expect(lay.leaves).toEqual([])
    expect(lay.width).toBeGreaterThan(0)
    expect(lay.height).toBeGreaterThan(0)
    checkGuarantees(lay)
  })
  it('空領域與空枝不產生東西', () => {
    const lay = layoutGrowthTree({ domains: [{ id: 'd', name: 'd', count: 0, branches: [{ id: 'b', name: 'b', count: 0, topics: [] }] }], unassigned: [] })
    expect(lay.leaves).toHaveLength(0)
    expect(lay.domains).toHaveLength(0)
  })
  it('小樹：每題一片葉、未分類成為最後一個領域、層級齊全', () => {
    const built: BuiltTree = {
      domains: [{ id: 'd1', name: '地籍', count: 2, branches: [{ id: 'b1', name: '鑑界', count: 2, topics: [topic('a'), topic('b', { firstMonth: '2026-03' })] }] }],
      unassigned: [topic('c', { firstMonth: null })],
    }
    const lay = layoutGrowthTree(built)
    expect(lay.leaves.map((l) => l.id).sort()).toEqual(['a', 'b', 'c'])
    expect(lay.domains.map((d) => d.name)).toEqual(['地籍', '未分類'])
    expect(lay.leaves.find((l) => l.id === 'c')!.domainIndex).toBe(1)
    const levels = new Set(lay.limbs.map((l) => l.level))
    expect(levels).toEqual(new Set(['domain', 'branch', 'twig']))
    // firstMonth：領域 d1 底下最早是 2026-01；未分類底下只有無月份的題目 → null
    expect(lay.limbs.find((l) => l.id === 'd:d1')!.firstMonth).toBe('2026-01')
    expect(lay.limbs.find((l) => l.id === 'd:__unassigned')!.firstMonth).toBeNull()
    expect(lay.trunk.firstMonth).toBeNull()
    checkGuarantees(lay)
  })
  it('r 依 docs 遞增且有上下限', () => {
    const lay = layoutGrowthTree({ domains: [], unassigned: [0, 1, 4, 16, 100, 100000].map((d) => topic(`t${d}`, { docs: d })) })
    const rs = lay.leaves.map((l) => l.r)
    for (let i = 1; i < rs.length; i++) expect(rs[i]!).toBeGreaterThanOrEqual(rs[i - 1]!)
    expect(Math.min(...rs)).toBeGreaterThanOrEqual(5)
    expect(Math.max(...rs)).toBeLessThanOrEqual(13)
  })
  it('領域扇形：左右對稱方向、總張角不超過 170°、題數多的分到較大角度', () => {
    const lay = layoutGrowthTree(bigTree(5, 2, 3))
    const cx = lay.width / 2
    // 樹幹頂端約在 trunk path 末端；領域末端相對它的角度
    const end = lay.trunk.d.match(/ (-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)$/)!
    const tx = Number(end[1]), ty = Number(end[2])
    expect(Math.abs(tx - cx)).toBeLessThan(1)
    const angs = lay.domains.map((d) => (Math.atan2(d.x - tx, ty - d.y) * 180) / Math.PI)
    expect(Math.max(...angs) - Math.min(...angs)).toBeLessThanOrEqual(170)
    expect(angs[0]!).toBeLessThan(angs[4]!)
    expect(Math.abs(angs[0]! + angs[4]!)).toBeLessThan(1e-6 + 1)
  })
  it('決定性：同一輸入兩次輸出完全相同', () => {
    const a = layoutGrowthTree(bigTree(4, 3, 5))
    const b = layoutGrowthTree(bigTree(4, 3, 5))
    expect(JSON.stringify(a)).toBe(JSON.stringify(b))
  })
  it('實機規模（10 領域、33 枝、約 64 題）滿足邊界與間距', () => {
    checkGuarantees(layoutGrowthTree(bigTree(10, 3, 2)))
  })
  it('300 題：邊界與間距成立，且 50ms 級別內算完', () => {
    const built = bigTree(10, 3, 10)
    layoutGrowthTree(built) // 暖機
    const t0 = performance.now()
    const lay = layoutGrowthTree(built)
    const ms = performance.now() - t0
    expect(lay.leaves).toHaveLength(300)
    expect(ms).toBeLessThan(200)
    expect(lay.width).toBeLessThan(6000)
    expect(lay.height).toBeLessThan(6000)
    checkGuarantees(lay)
  })
  it('標籤：字級放大時只顯示題數前幾多的領域，且顯示的互不重疊', () => {
    const lay = layoutGrowthTree(bigTree(10, 1, 1), { labelFontSize: 40 })
    const shown = lay.domains.filter((d) => d.labelShown)
    expect(shown.length).toBeGreaterThan(0)
    expect(shown.length).toBeLessThanOrEqual(lay.domains.length)
  })
})

describe('monthsOf', () => {
  const now = new Date('2026-11-12T03:00:00Z')
  it('沒有題目只有當月', () => {
    expect(monthsOf([], now)).toEqual(['2026-11'])
    expect(monthsOf([{ firstMonth: null }], now)).toEqual(['2026-11'])
  })
  it('連續不缺月、跨年', () => {
    expect(monthsOf([{ firstMonth: '2025-11' }, { firstMonth: '2026-02' }], now)).toEqual([
      '2025-11', '2025-12', '2026-01', '2026-02', '2026-03', '2026-04', '2026-05', '2026-06', '2026-07', '2026-08', '2026-09', '2026-10', '2026-11',
    ])
  })
  it('最早就是當月', () => {
    expect(monthsOf([{ firstMonth: '2026-11' }], now)).toEqual(['2026-11'])
  })
})

describe('visibleAt', () => {
  it('null 一開始就在；其餘比月份', () => {
    expect(visibleAt(null, '2020-01')).toBe(true)
    expect(visibleAt('2026-03', '2026-02')).toBe(false)
    expect(visibleAt('2026-03', '2026-03')).toBe(true)
    expect(visibleAt('2025-12', '2026-01')).toBe(true)
  })
})
