// insightIslands 純函式的測試（3.15.0）：排序、島嶼版面、鏡頭縮放、時間軸排列、置中捲動、月份分箱。
import { describe, expect, it } from 'vitest'
import type { Insight, InsightRelation } from './insightTree'
import {
  ISLAND, TIMELINE, centerScroll, fitCamera, islandCamera, islandOrder, layoutIslands, layoutTimeline, monthBins, threadOrder, worldToScreen, zoomAt, zoomLevel,
  type Island,
} from './insightIslands'

/** 台北 2026-11-20（UTC 04:00 已是當天中午） */
const NOW = new Date('2026-11-20T04:00:00Z')

function mk(id: string, date: string, cluster: string, thread: string, relation: InsightRelation = 'new', parent: string | null = null): Insight {
  return { id, date, time: null, text: `心得 ${id}`, provenance: 'quote', cluster, thread, relation, parent, links: { people: [], ideas: [], topics: [] } }
}

describe('threadOrder', () => {
  it('子心得緊接親代、depth 正確、親代不在清單時當根', () => {
    const items = [
      mk('r2', '2026-02-01', 'K', 'T1'),
      mk('c1', '2026-01-10', 'K', 'T1', 'reinforce', 'r1'),
      mk('r1', '2026-01-01', 'K', 'T1'),
      mk('c1a', '2026-01-20', 'K', 'T1', 'refine', 'c1'),
      mk('c2', '2026-01-15', 'K', 'T1', 'refine', 'r1'),
      mk('d0', '2026-02-01', 'K', 'T2'),
      mk('orphan', '2026-01-05', 'K', 'T3', 'reinforce', 'missing'),
    ]
    const out = threadOrder(items)
    // 根依 date 升冪（同 d0/r2 同日依 id）；子依 date 升冪且緊接親代
    expect(out.map((x) => `${x.id}:${x.depth}`)).toEqual(['r1:0', 'c1:1', 'c1a:2', 'c2:1', 'orphan:0', 'd0:0', 'r2:0'])
  })
})

describe('islandOrder', () => {
  it('依 thread 分組、組間依最新日期降冪（同值依 thread）、組內保持 threadOrder', () => {
    const items = [
      mk('a1', '2026-01-01', 'K', 'TA'),
      mk('a2', '2026-05-01', 'K', 'TA'),
      mk('b1', '2026-03-01', 'K', 'TB'),
      mk('c1', '2026-05-01', 'K', 'TC'),
    ]
    expect(islandOrder(items).map((x) => x.id)).toEqual(['a1', 'a2', 'c1', 'b1'])
  })
})

describe('layoutIslands', () => {
  const sizes = [46, 1, 8, 15, 22, 29, 36, 43, 4, 11, 18, 25]

  function fixture(): Map<string, Insight[]> {
    const groups = new Map<string, Insight[]>()
    sizes.forEach((n, g) => {
      const cid = `K${String(g + 1).padStart(2, '0')}`
      const arr: Insight[] = []
      for (let i = 0; i < n; i++) {
        const day = new Date(Date.UTC(2023, 5, 1) + (g * 60 + i * 5) * 86_400_000).toISOString().slice(0, 10)
        const thread = `T${g}-${i % 3}`
        const parent = i >= 3 ? arr[i - 3]!.id : null
        arr.push(mk(`${cid}-${i}`, day, cid, thread, parent === null ? 'new' : 'reinforce', parent))
      }
      groups.set(cid, arr)
    })
    return groups
  }

  it('12 群 1～46 則：島與島（含標籤區）不重疊、cell 都在島內、島大小依公式', () => {
    const groups = fixture()
    const world = layoutIslands(groups, NOW)
    expect(world.islands).toHaveLength(12)
    const total = sizes.reduce((s, n) => s + n, 0)
    expect(world.islands.reduce((s, is) => s + is.cells.length, 0)).toBe(total)

    const rects = world.islands.map((s) => ({ x: s.x, y: s.y - ISLAND.label, w: s.w, h: s.h + ISLAND.label }))
    for (let i = 0; i < rects.length; i++) {
      for (let j = i + 1; j < rects.length; j++) {
        const a = rects[i]!
        const b = rects[j]!
        const hit = a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h
        expect(hit, `${world.islands[i]!.id} 與 ${world.islands[j]!.id} 重疊`).toBe(false)
      }
    }

    for (const s of world.islands) {
      const n = s.cells.length
      expect(s.cols).toBe(Math.max(1, Math.min(n, Math.round(Math.sqrt((n * ISLAND.cellH) / ISLAND.cellW) * 1.25))))
      expect(s.rows).toBe(Math.ceil(n / s.cols))
      expect(s.w).toBeCloseTo(s.cols * ISLAND.cellW + ISLAND.pad * 2 - ISLAND.gap, 9)
      expect(s.h).toBeCloseTo(s.rows * ISLAND.cellH + ISLAND.pad * 2 - ISLAND.gap, 9)
      for (const c of s.cells) {
        expect(c.x).toBeGreaterThanOrEqual(s.x)
        expect(c.y).toBeGreaterThanOrEqual(s.y)
        expect(c.x + ISLAND.cellW - ISLAND.gap).toBeLessThanOrEqual(s.x + s.w + 1e-9)
        expect(c.y + ISLAND.cellH - ISLAND.gap).toBeLessThanOrEqual(s.y + s.h + 1e-9)
      }
      expect(s.x).toBeGreaterThanOrEqual(world.bounds.x)
      expect(s.y - ISLAND.label).toBeGreaterThanOrEqual(world.bounds.y)
      expect(s.x + s.w).toBeLessThanOrEqual(world.bounds.x + world.bounds.w + 1e-9)
      expect(s.y + s.h).toBeLessThanOrEqual(world.bounds.y + world.bounds.h + 1e-9)
    }
    // 輸出依 last 降冪
    for (let i = 1; i < world.islands.length; i++) expect(world.islands[i - 1]!.last >= world.islands[i]!.last).toBe(true)
  })

  it('同一輸入兩次輸出 JSON 相同', () => {
    const groups = fixture()
    expect(JSON.stringify(layoutIslands(groups, NOW))).toBe(JSON.stringify(layoutIslands(groups, NOW)))
  })

  it('fresh 計數（含當天、第 30 天；31 天前不算）與空輸入', () => {
    const groups = new Map<string, Insight[]>([
      ['K1', [mk('f1', '2026-11-20', 'K1', 'T1'), mk('f2', '2026-10-21', 'K1', 'T2'), mk('f3', '2026-10-20', 'K1', 'T3'), mk('f4', '2026-11-01', 'K1', 'T4')]],
      ['K2', [mk('o1', '2024-01-01', 'K2', 'T5')]],
    ])
    const world = layoutIslands(groups, NOW)
    const k1 = world.islands.find((s) => s.id === 'K1')!
    expect(k1.fresh).toBe(3)
    expect(k1.last).toBe('2026-11-20')
    expect(world.islands.find((s) => s.id === 'K2')!.fresh).toBe(0)
    expect(world.islands[0]!.id).toBe('K1')

    expect(layoutIslands(new Map(), NOW)).toEqual({ islands: [], bounds: { x: 0, y: 0, w: 0, h: 0 } })
  })
})

describe('鏡頭', () => {
  it('worldToScreen 把世界座標換成螢幕座標', () => {
    expect(worldToScreen({ x: 10, y: 20, k: 2 }, 15, 23, 800, 600)).toEqual([410, 306])
  })

  it('zoomAt 游標下的世界點不動，k 被夾住', () => {
    const cam = { x: 120, y: -80, k: 1.7 }
    const viewW = 1000
    const viewH = 700
    const mx = 300
    const my = 220
    const before = [cam.x + (mx - viewW / 2) / cam.k, cam.y + (my - viewH / 2) / cam.k]
    const next = zoomAt(cam, mx, my, 1.4, viewW, viewH, 0.5, 3)
    const after = [next.x + (mx - viewW / 2) / next.k, next.y + (my - viewH / 2) / next.k]
    expect(Math.abs(after[0]! - before[0]!)).toBeLessThan(1e-9)
    expect(Math.abs(after[1]! - before[1]!)).toBeLessThan(1e-9)
    expect(next.k).toBeCloseTo(2.38, 12)
    expect(zoomAt(cam, mx, my, 100, viewW, viewH, 0.5, 3).k).toBe(3)
    expect(zoomAt(cam, mx, my, 1e-6, viewW, viewH, 0.5, 3).k).toBeCloseTo(0.5, 12)
  })

  it('fitCamera 中心與 k 依 frac', () => {
    expect(fitCamera({ x: 10, y: 20, w: 100, h: 50 }, 1000, 700)).toEqual({ x: 60, y: 45, k: 9 })
    expect(fitCamera({ x: 0, y: 0, w: 100, h: 50 }, 1000, 700, 0.5).k).toBe(5)
  })

  it('islandCamera 的 k 範圍與中心', () => {
    const is: Island = { id: 'K', x: 0, y: 0, w: 300, h: 200, cols: 3, rows: 2, cells: [], last: '2026-01-01', fresh: 0 }
    const cam = islandCamera(is, 1000, 700, 0.4, 3.4)
    expect(cam.k).toBeGreaterThanOrEqual(1.35)
    expect(cam.k).toBeLessThanOrEqual(2.6)
    expect(cam.x).toBe(150)
    expect(cam.y).toBe(88)
    expect(islandCamera({ ...is, w: 4000 }, 1000, 700, 0.4, 3.4).k).toBe(1.35)
    expect(islandCamera(is, 1000, 700, 2.2, 3.4).k).toBeGreaterThanOrEqual(2.2)
    expect(islandCamera(is, 1000, 700, 0.4, 1.5).k).toBe(1.5)
  })

  it('zoomLevel 分界值', () => {
    expect(zoomLevel(0.74)).toBe('overview')
    expect(zoomLevel(0.75)).toBe('short')
    expect(zoomLevel(1.29)).toBe('short')
    expect(zoomLevel(1.3)).toBe('full')
    expect(zoomLevel(2.19)).toBe('full')
    expect(zoomLevel(2.2)).toBe('read')
  })
})

/** n 則、每 3 則同一天、每 7 天一批；parent 指向前一則，用來檢查 arcs */
function timelineItems(n: number): Insight[] {
  const out: Insight[] = []
  const start = Date.UTC(2025, 0, 5)
  for (let i = 0; i < n; i++) {
    const day = new Date(start + Math.floor(i / 3) * 7 * 86_400_000).toISOString().slice(0, 10)
    const relation: InsightRelation = i % 4 === 0 ? 'new' : i % 4 === 1 ? 'reinforce' : i % 4 === 2 ? 'refine' : 'overturn'
    const parent = i > 0 && i % 4 !== 0 ? `L${i - 1}` : null
    out.push(mk(`L${i}`, day, 'K', `TH${i % 5}`, relation, parent))
  }
  return out
}

describe('layoutTimeline', () => {
  it('n=0：width=viewW、其他陣列空', () => {
    expect(layoutTimeline([], 1000)).toEqual({ xs: [], lanes: [], laneCount: 0, width: 1000, axisY: 24, height: 94, months: [], arcs: [] })
  })

  it('n=1：置中、一排', () => {
    const viewW = 1000
    const l = layoutTimeline(timelineItems(1), viewW)
    expect(l.xs).toEqual([500])
    expect(l.lanes).toEqual([0])
    expect(l.laneCount).toBe(1)
    expect(l.width).toBe(1000)
    expect(l.axisY).toBe(TIMELINE.cardH + TIMELINE.laneGap + TIMELINE.axisPad)
    expect(l.height).toBe(l.axisY + 70)
    expect(l.months).toHaveLength(1)
    expect(l.months[0]).toEqual({ x: 500 - 10, label: '2025/01', year: true })
    expect(l.arcs).toEqual([])
  })

  for (const n of [2, 8, 46]) {
    it(`n=${n}：xs 單調且間距 ≥ ${TIMELINE.minGap}、同排不重疊、排數 ≤ ${TIMELINE.maxLanes}、公式與 arcs`, () => {
      const items = timelineItems(n)
      const viewW = 1000
      const l = layoutTimeline(items, viewW)
      expect(l.xs).toHaveLength(n)
      expect(l.lanes).toHaveLength(n)
      for (let i = 1; i < n; i++) expect(l.xs[i]! - l.xs[i - 1]!).toBeGreaterThanOrEqual(TIMELINE.minGap - 1e-9)
      expect(l.width).toBeCloseTo(l.xs[n - 1]! + viewW / 2, 9)
      expect(l.laneCount).toBe(Math.max(...l.lanes) + 1)
      expect(l.laneCount).toBeLessThanOrEqual(TIMELINE.maxLanes)
      expect(l.axisY).toBe(l.laneCount * (TIMELINE.cardH + TIMELINE.laneGap) + TIMELINE.axisPad)
      expect(l.height).toBe(l.axisY + 70)

      for (let lane = 0; lane < l.laneCount; lane++) {
        const pos = l.xs.filter((_, i) => l.lanes[i] === lane)
        for (let j = 1; j < pos.length; j++) expect(pos[j]! - pos[j - 1]!).toBeGreaterThanOrEqual(TIMELINE.cardW + TIMELINE.laneGap - 1e-9)
      }

      const starts = items.map((it, i) => (i === 0 || it.date.slice(0, 7) !== items[i - 1]!.date.slice(0, 7) ? i : -1)).filter((i) => i >= 0)
      expect(l.months).toHaveLength(starts.length)
      starts.forEach((i, k) => {
        const m = items[i]!.date.slice(0, 7)
        const prevYear = i === 0 ? null : items[i - 1]!.date.slice(0, 7).slice(0, 4)
        const year = prevYear === null || prevYear !== m.slice(0, 4)
        expect(l.months[k]).toEqual({ x: l.xs[i]! - 10, label: year ? `${m.slice(0, 4)}/${m.slice(5)}` : `${m.slice(5)}月`, year })
      })

      const indexOf = new Map(items.map((it, i) => [it.id, i]))
      const expected = items.flatMap((it, i) => (it.parent === null || !indexOf.has(it.parent) ? [] : [{ from: indexOf.get(it.parent), to: i, relation: it.relation, thread: it.thread }]))
      expect(l.arcs).toEqual(expected)
    })
  }

  it('months 換年顯示 YYYY/MM、同年只換月顯示 MM月', () => {
    const items = [mk('m1', '2025-12-20', 'K', 'T'), mk('m2', '2025-12-28', 'K', 'T'), mk('m3', '2026-01-05', 'K', 'T'), mk('m4', '2026-02-05', 'K', 'T')]
    const l = layoutTimeline(items, 600)
    expect(l.months).toEqual([
      { x: l.xs[0]! - 10, label: '2025/12', year: true },
      { x: l.xs[2]! - 10, label: '2026/01', year: true },
      { x: l.xs[3]! - 10, label: '02月', year: false },
    ])
  })
})

describe('centerScroll', () => {
  it('x 置中所需 scrollLeft，不夾值', () => {
    expect(centerScroll(400, 1000)).toBe(-100)
    expect(centerScroll(800, 1000)).toBe(300)
  })
})

describe('monthBins', () => {
  it('24 個月分箱、舊→新、跨年', () => {
    const items = [
      mk('b1', '2026-11-02', 'K', 'T'),
      mk('b2', '2026-10-15', 'K', 'T'),
      mk('b3', '2025-12-01', 'K', 'T'),
      mk('b4', '2024-12-31', 'K', 'T'),
      mk('b5', '2024-11-30', 'K', 'T'),
      mk('b6', '2027-01-01', 'K', 'T'),
    ]
    const bins = monthBins(items, NOW)
    expect(bins).toHaveLength(24)
    expect(bins[23]).toBe(1)
    expect(bins[22]).toBe(1)
    expect(bins[12]).toBe(1)
    expect(bins[0]).toBe(1)
    expect(bins.reduce((s, v) => s + v, 0)).toBe(4)
  })

  it('months 參數', () => {
    expect(monthBins([mk('c1', '2026-11-01', 'K', 'T')], NOW, 3)).toEqual([0, 0, 1])
  })
})
