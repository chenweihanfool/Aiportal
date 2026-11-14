import { describe, expect, it } from 'vitest'
import {
  insightIdFromHash, insightStats, layoutInsightTree, monthSeries, parseInsightDetail, parseInsights, taipeiDay, threadDots, threadWidth,
  type InsightData, type InsightRelation,
} from './insightTree'

const NOW = new Date('2026-11-14T04:00:00Z')

const mk = (id: string, date: string, cluster: string, thread: string, relation: InsightRelation, parent: string | null = null) => ({
  id, date, time: '09:30', text: `虛構心得 ${id}`, provenance: 'quote', cluster, thread, relation, parent,
})

/** 4 群、22 則：TH-a 有 3 次印證、TH-b 一次 refine、TH-c 一次 overturn、近 30 天 2 則 */
function sample(): InsightData {
  const raw = {
    total: 22,
    thisMonth: 2,
    clusters: [{ id: 'K01', name: '測量作業', count: 9 }, { id: 'K02', name: '工作習慣', count: 6 }, { id: 'K03', name: '人際', count: 4 }, { id: 'K04', name: '健康與運動的長長名稱', count: 3 }],
    insights: [
      mk('a1', '2026-01-05', 'K01', 'TH-a', 'new'),
      mk('a2', '2026-02-05', 'K01', 'TH-a', 'reinforce', 'a1'),
      mk('a3', '2026-03-05', 'K01', 'TH-a', 'reinforce', 'a2'),
      mk('a4', '2026-04-05', 'K01', 'TH-a', 'reinforce', 'a3'),
      mk('a5', '2026-05-05', 'K01', 'TH-a', 'refine', 'a4'),
      mk('a6', '2026-06-05', 'K01', 'TH-a', 'reinforce', 'a5'),
      mk('x1', '2026-02-10', 'K01', 'TH-x', 'new'),
      mk('x2', '2026-07-10', 'K01', 'TH-x', 'new'),
      mk('x3', '2026-08-10', 'K01', 'TH-y', 'new'),
      mk('b1', '2026-02-20', 'K02', 'TH-b', 'new'),
      mk('b2', '2026-04-20', 'K02', 'TH-b', 'refine', 'b1'),
      mk('b3', '2026-08-20', 'K02', 'TH-z', 'new'),
      mk('b4', '2026-09-20', 'K02', 'TH-w', 'new'),
      mk('b5', '2026-10-01', 'K02', 'TH-v', 'new'),
      mk('b6', '2026-10-02', 'K02', 'TH-u', 'new'),
      mk('c1', '2026-03-15', 'K03', 'TH-c', 'new'),
      mk('c2', '2026-05-15', 'K03', 'TH-c', 'overturn', 'c1'),
      mk('c3', '2026-07-15', 'K03', 'TH-t', 'new'),
      mk('c4', '2026-09-15', 'K03', 'TH-s', 'new'),
      mk('d1', '2026-06-01', 'K04', 'TH-r', 'new'),
      mk('d2', '2026-10-25', 'K04', 'TH-q', 'new'),
      mk('d3', '2026-11-10', 'K04', 'TH-p', 'new'),
    ],
  }
  const d = parseInsights(raw)
  if (!d) throw new Error('sample 解析失敗')
  return d
}

describe('parseInsights', () => {
  it('髒資料略過、整體壞掉回 null', () => {
    expect(parseInsights(null)).toBeNull()
    expect(parseInsights({ insights: 'x' })).toBeNull()
    const d = parseInsights({
      clusters: [{ id: 'K01', name: 'x', count: 1 }, { id: 5 }, null],
      insights: [mk('ok', '2026-01-01', 'K01', 'T', 'new'), { ...mk('bad1', '2026-01-01', 'K01', 'T', 'new'), relation: 'weird' }, { ...mk('bad2', '2026/01/01', 'K01', 'T', 'new') },
        { ...mk('bad3', '2026-01-01', 'K01', 'T', 'new'), text: '' }, 'str', { ...mk('bad4', '2026-01-01', 'K01', 'T', 'new'), parent: 5 }, { ...mk('ok', '2026-01-02', 'K01', 'T', 'new') }],
    })
    expect(d?.insights.map((i) => i.id)).toEqual(['ok'])
    expect(d?.clusters).toHaveLength(1)
    expect(d?.total).toBe(1)
  })
  it('依日期由舊到新排序', () => {
    const d = parseInsights({ insights: [mk('n', '2026-02-01', 'K', 'T', 'new'), mk('o', '2026-01-01', 'K', 'T', 'new')] })
    expect(d?.insights.map((i) => i.id)).toEqual(['o', 'n'])
  })
  it('parseInsightDetail：缺欄位回 null、threadItems 壞項略過', () => {
    expect(parseInsightDetail({})).toBeNull()
    const base = { ...mk('a', '2026-01-01', 'K01', 'T', 'new'), cluster: { id: 'K01', name: '群' }, evidence: '原文', source: '日記', threadItems: [mk('a', '2026-01-01', 'K01', 'T', 'new'), { x: 1 }] }
    const d = parseInsightDetail(base)
    expect(d?.cluster.name).toBe('群')
    expect(d?.threadItems).toHaveLength(1)
    expect(d?.evidence).toBe('原文')
  })
})

describe('layoutInsightTree', () => {
  const data = sample()
  const opts = { width: 720, height: 480, now: NOW }

  it('同輸入同輸出', () => {
    expect(JSON.stringify(layoutInsightTree(data, opts))).toBe(JSON.stringify(layoutInsightTree(sample(), opts)))
  })

  it('座標全落在畫布內（含窄畫布）', () => {
    for (const [w, h] of [[720, 480], [360, 320], [1000, 520]] as const) {
      const l = layoutInsightTree(data, { width: w, height: h, now: NOW })
      expect(l.leaves).toHaveLength(22)
      for (const lf of l.leaves) {
        expect(lf.x - lf.r).toBeGreaterThanOrEqual(0)
        expect(lf.x + lf.r).toBeLessThanOrEqual(w)
        expect(lf.y - lf.r).toBeGreaterThanOrEqual(0)
        expect(lf.y + lf.r).toBeLessThanOrEqual(h)
      }
      for (const c of l.clusters) {
        expect(c.x).toBeGreaterThanOrEqual(0); expect(c.x).toBeLessThanOrEqual(w)
        expect(c.y).toBeGreaterThanOrEqual(0); expect(c.y).toBeLessThanOrEqual(h)
        expect(c.lx).toBeGreaterThanOrEqual(0); expect(c.lx).toBeLessThanOrEqual(w)
      }
      for (const limb of [l.trunk, ...l.limbs]) {
        for (const m of limb.d.matchAll(/(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)/g)) {
          expect(+m[1]!).toBeGreaterThanOrEqual(0); expect(+m[1]!).toBeLessThanOrEqual(w)
          expect(+m[2]!).toBeGreaterThanOrEqual(0); expect(+m[2]!).toBeLessThanOrEqual(h)
        }
      }
    }
  })

  it('群標籤互不重疊（放不下的 labelShown=false）', () => {
    const l = layoutInsightTree(data, { width: 300, height: 320, now: NOW })
    const shown = l.clusters.filter((c) => c.labelShown)
    expect(shown.length).toBeGreaterThan(0)
    for (let i = 0; i < shown.length; i++) {
      for (let j = i + 1; j < shown.length; j++) {
        const a = shown[i]!, b = shown[j]!
        const overlap = Math.abs(a.lx - b.lx) < 20 && Math.abs(a.ly - b.ly) < 10
        expect(overlap).toBe(false)
      }
    }
  })

  it('枝寬隨印證增加且有上限', () => {
    expect(threadWidth(0)).toBeCloseTo(1.5)
    expect(threadWidth(3)).toBeCloseTo(5.1)
    expect(threadWidth(100)).toBe(8)
    const l = layoutInsightTree(data, opts)
    const wOf = (th: string) => l.limbs.find((x) => x.id === `t:${th}#0`)?.width ?? 0
    expect(wOf('TH-a')).toBeCloseTo(1.5 + 1.2 * 4) // a2 a3 a4 a6 之中 a6 在分岔上，主枝 3 次、整條脈絡 4 次
    expect(wOf('TH-a')).toBeGreaterThan(wOf('TH-x'))
    for (const x of l.limbs) expect(x.width).toBeLessThanOrEqual(10)
  })

  it('refine 從 parent 葉分岔出新枝段', () => {
    const l = layoutInsightTree(data, opts)
    const fork = l.limbs.find((x) => x.id === 't:TH-a~a5#0')
    expect(fork).toBeTruthy()
    const parent = l.leaves.find((x) => x.id === 'a4')!
    const m = /^M(-?[\d.]+),(-?[\d.]+)/.exec(fork!.d)!
    expect(Math.abs(+m[1]! - parent.x)).toBeLessThan(0.2)
    expect(Math.abs(+m[2]! - parent.y)).toBeLessThan(0.2)
    expect(l.limbs.some((x) => x.id === 't:TH-b~b2#0')).toBe(true)
  })

  it('overturn 讓 parent 到被推翻點的枝與 parent 葉枯萎', () => {
    const l = layoutInsightTree(data, opts)
    const seg = l.limbs.find((x) => x.id === 't:TH-c#1')!
    expect(seg.withered).toBe(true)
    expect(l.limbs.find((x) => x.id === 't:TH-c#0')!.withered).toBe(false)
    expect(l.leaves.find((x) => x.id === 'c1')!.withered).toBe(true)
    expect(l.leaves.find((x) => x.id === 'c2')!.withered).toBe(false)
    expect(l.leaves.find((x) => x.id === 'a1')!.withered).toBe(false)
  })

  it('近 30 天的葉才發光', () => {
    const l = layoutInsightTree(data, opts)
    expect(l.leaves.filter((x) => x.glow).map((x) => x.id).sort()).toEqual(['d2', 'd3'])
  })

  it('upto 只輸出該月底以前的枝葉', () => {
    const l = layoutInsightTree(data, { ...opts, upto: '2026-03' })
    const ids = l.leaves.map((x) => x.id).sort()
    expect(ids).toEqual(['a1', 'a2', 'a3', 'b1', 'c1', 'x1'])
    expect(l.clusters).toHaveLength(4)
    expect(l.clusters.find((c) => c.id === 'K04')!.count).toBe(0)
    expect(l.clusters.find((c) => c.id === 'K04')!.labelShown).toBe(false)
    expect(l.limbs.some((x) => x.id.startsWith('t:TH-r'))).toBe(false)
    expect(l.limbs.some((x) => x.id.startsWith('t:TH-c#1'))).toBe(false)
    // 同月份的枝與葉只依可見心得
    const all = layoutInsightTree(data, opts)
    expect(l.limbs.length).toBeLessThan(all.limbs.length)
  })

  it('沒有心得時只有樹幹', () => {
    const l = layoutInsightTree({ total: 0, thisMonth: 0, clusters: [], insights: [] }, opts)
    expect(l.leaves).toHaveLength(0)
    expect(l.limbs).toHaveLength(0)
    expect(l.trunk.firstMonth).toBeNull()
  })
})

describe('monthSeries / insightStats / 其他', () => {
  const data = sample()
  it('monthSeries 從第一則到 now、不缺月', () => {
    const m = monthSeries(data, NOW)
    expect(m[0]).toBe('2026-01')
    expect(m[m.length - 1]).toBe('2026-11')
    expect(m).toHaveLength(11)
    expect(monthSeries({ insights: [] }, NOW)).toEqual(['2026-11'])
  })
  it('insightStats', () => {
    const s = insightStats(data, NOW)
    expect(s.total).toBe(22)
    expect(s.thisMonth).toBe(1)
    expect(s.topCluster).toEqual({ name: '測量作業', count: 9 })
    expect(insightStats({ total: 0, thisMonth: 0, clusters: [], insights: [] }, NOW).topCluster).toBeNull()
  })
  it('taipeiDay 用台北日期', () => {
    expect(taipeiDay(new Date('2026-11-13T17:00:00Z'))).toBe('2026-11-14')
  })
  it('threadDots 只取同脈絡、依日期排序、標出自己', () => {
    const hits = [
      { id: 'b', date: '2026-02-01', meta: { thread: 'T', relation: 'reinforce' as const } },
      { id: 'a', date: '2026-01-01', meta: { thread: 'T', relation: 'new' as const } },
      { id: 'z', date: '2026-01-01', meta: { thread: 'OTHER', relation: 'new' as const } },
      { id: 'n', date: '2026-01-01' },
    ]
    const d = threadDots('b', 'T', hits)
    expect(d.map((x) => x.id)).toEqual(['a', 'b'])
    expect(d.find((x) => x.self)?.id).toBe('b')
  })
  it('insightIdFromHash', () => {
    expect(insightIdFromHash('#insight/I-1')).toBe('I-1')
    expect(insightIdFromHash('#insight/a%20b')).toBe('a b')
    expect(insightIdFromHash('#insight/')).toBeNull()
    expect(insightIdFromHash('#food')).toBeNull()
  })
})
