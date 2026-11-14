import { describe, expect, it } from 'vitest'
import {
  clusterSummaries, dateToY, focusViewBox, insightIdFromHash, insightStats, layoutInsightTree, leafShape, monthSeries, suggestTreeHeight, parseInsightDetail, parseInsights, taipeiDay, threadDots, threadWidth,
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

/** 12 群、300 則、跨 18 個月的合成資料（效能與標籤碰撞用） */
function bigData(): InsightData {
  const raw: Array<{ id: string; thread: string }> = []
  const out: unknown[] = []
  for (let i = 0; i < 300; i++) {
    const c = (i * 7) % 12
    const th = `TH-${c}-${Math.floor(i / 12) % 9}`
    const ago = 540 - Math.floor((i * 540) / 300)
    const rel: InsightRelation = i % 11 === 5 ? 'refine' : i % 13 === 7 ? 'overturn' : i % 3 === 1 ? 'reinforce' : 'new'
    const prev = raw.filter((x) => x.thread === th)
    const parent = rel === 'new' || prev.length === 0 ? null : prev[prev.length - 1]!.id
    const d = new Date(NOW.getTime() - ago * 86_400_000).toISOString().slice(0, 10)
    raw.push({ id: `B${i}`, thread: th })
    out.push({ id: `B${i}`, date: d, time: null, text: `合成心得 ${i}`, provenance: 'quote', cluster: `K${String(c + 1).padStart(2, '0')}`, thread: th, relation: parent === null ? 'new' : rel, parent })
  }
  const d = parseInsights({ clusters: Array.from({ length: 12 }, (_, i) => ({ id: `K${String(i + 1).padStart(2, '0')}`, name: `領域${i + 1}`, count: 25 })), insights: out })
  if (!d) throw new Error('big 解析失敗')
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

  it('群標籤不壓葉子、互不重疊（360 與 1200 寬、12 群 300 片葉）', () => {
    for (const [w, h] of [[360, 420], [1200, 640]] as const) {
      for (const d of [data, bigData()]) {
        const l = layoutInsightTree(d, { width: w, height: h, now: NOW })
        const shown = l.clusters.filter((c) => c.labelShown)
        expect(shown.length).toBeGreaterThan(0)
        const rect = (c: (typeof shown)[number]) => ({ x0: c.lx - c.lw / 2, x1: c.lx + c.lw / 2, y0: c.ly - c.lh / 2, y1: c.ly + c.lh / 2 })
        for (const c of shown) {
          const r = rect(c)
          expect(r.x0).toBeGreaterThanOrEqual(0); expect(r.x1).toBeLessThanOrEqual(w); expect(r.y0).toBeGreaterThanOrEqual(0); expect(r.y1).toBeLessThanOrEqual(h)
          for (const lf of l.leaves) {
            const nx = Math.min(r.x1, Math.max(r.x0, lf.x)); const ny = Math.min(r.y1, Math.max(r.y0, lf.y))
            expect(Math.hypot(lf.x - nx, lf.y - ny)).toBeGreaterThanOrEqual(lf.r)
          }
        }
        for (let i = 0; i < shown.length; i++) for (let j = i + 1; j < shown.length; j++) {
          const p = rect(shown[i]!), q = rect(shown[j]!)
          expect(p.x0 < q.x1 && p.x1 > q.x0 && p.y0 < q.y1 && p.y1 > q.y0).toBe(false)
        }
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
    expect(Math.abs(fork!.from[0] - parent.x)).toBeLessThan(0.2)
    expect(Math.abs(fork!.from[1] - parent.y)).toBeLessThan(0.2)
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

describe('視覺化結構（2.99.0 打磨）', () => {
  const data = sample()
  const opts = { width: 720, height: 480, now: NOW }
  const l = layoutInsightTree(data, opts)

  it('枝輪廓由粗到細：樹幹、主枝、脈絡枝的底部都比末端寬', () => {
    expect(l.trunk.widthStart).toBeGreaterThan(l.trunk.widthEnd)
    const c0 = l.limbs.find((x) => x.id === 'c:K01#0')!
    const c4 = l.limbs.find((x) => x.id === 'c:K01#4')!
    expect(c0.widthStart).toBeGreaterThan(c4.widthEnd)
    const t = l.limbs.find((x) => x.id === 't:TH-a#0')!
    const tEnd = l.limbs.find((x) => x.id === 't:TH-a#3')!
    expect(t.widthStart).toBeGreaterThan(tEnd.widthEnd)
    expect(l.limbs.every((x) => x.d.startsWith('M') && x.d.endsWith('Z'))).toBe(true)
  })
  it('時間刻度位置隨日期單調（越晚越高），葉子的高度就是它的日期', () => {
    expect(l.ticks.length).toBeGreaterThanOrEqual(2)
    for (let i = 1; i < l.ticks.length; i++) expect(l.ticks[i]!.y).toBeLessThan(l.ticks[i - 1]!.y)
    expect(l.ticks.some((t) => t.major && /^[0-9]{4}$/.test(t.label))).toBe(true)
    const dates = ['2026-01-01', '2026-03-01', '2026-06-15', '2026-11-14']
    const ys = dates.map((d) => dateToY(l.axis, d))
    for (let i = 1; i < ys.length; i++) expect(ys[i]!).toBeLessThan(ys[i - 1]!)
    const byDate = [...data.insights].sort((a, b) => (a.date < b.date ? -1 : 1))
    const leafY = (id: string) => l.leaves.find((x) => x.id === id)!.y
    for (let i = 1; i < byDate.length; i++) expect(leafY(byDate[i]!.id)).toBeLessThanOrEqual(leafY(byDate[i - 1]!.id) + 0.05)
    expect(Math.abs(leafY('a1') - dateToY(l.axis, '2026-01-05'))).toBeLessThan(0.1)
  })
  it('葉形依 relation 各不相同；推翻是微垂的枯葉', () => {
    const shapes = (['new', 'reinforce', 'refine', 'overturn'] as const).map((r) => leafShape(r))
    expect(new Set(shapes.map((x) => x.d)).size).toBe(4)
    expect(shapes.map((x) => x.kind)).toEqual(['bud', 'leaf', 'fork', 'dead'])
    expect(l.leaves.find((x) => x.id === 'c2')!.relation).toBe('overturn')
    expect(l.leaves.every((x) => Number.isFinite(x.angle))).toBe(true)
  })
  it('滑過葉子的整條路徑：從樹幹出發、經主枝、到它自己的枝段；分岔的葉子也包含 parent 的路徑', () => {
    const a3 = l.leaves.find((x) => x.id === 'a3')!
    expect(a3.path[0]).toBe('trunk')
    expect(a3.path[a3.path.length - 1]).toBe('t:TH-a#2')
    expect(a3.path.filter((x) => x.startsWith('c:K01#')).length).toBe(5)
    const a5 = l.leaves.find((x) => x.id === 'a5')!
    const a4 = l.leaves.find((x) => x.id === 'a4')!
    expect(a5.path.slice(0, a4.path.length)).toEqual(a4.path)
    expect(a5.path[a5.path.length - 1]).toBe('t:TH-a~a5#0')
    const ids = new Set([l.trunk.id, ...l.limbs.map((x) => x.id)])
    for (const lf of l.leaves) for (const p of lf.path) expect(ids.has(p)).toBe(true)
  })
  it('聚焦某群的 viewBox：包住那一群、維持長寬比、不超出畫布；null＝全樹', () => {
    expect(focusViewBox(l, null)).toEqual({ x: 0, y: 0, w: l.width, h: l.height })
    const ci = l.clusters.findIndex((c) => c.id === 'K03')
    const vb = focusViewBox(l, ci)
    expect(vb.w).toBeLessThan(l.width)
    expect(vb.x).toBeGreaterThanOrEqual(0); expect(vb.y).toBeGreaterThanOrEqual(0)
    expect(vb.x + vb.w).toBeLessThanOrEqual(l.width + 0.1); expect(vb.y + vb.h).toBeLessThanOrEqual(l.height + 0.1)
    expect(Math.abs(vb.w / vb.h - l.width / l.height)).toBeLessThan(0.02)
    for (const lf of l.leaves.filter((x) => x.clusterIndex === ci)) {
      expect(lf.x).toBeGreaterThanOrEqual(vb.x); expect(lf.x).toBeLessThanOrEqual(vb.x + vb.w)
      expect(lf.y).toBeGreaterThanOrEqual(vb.y); expect(lf.y).toBeLessThanOrEqual(vb.y + vb.h)
    }
    expect(focusViewBox(l, 99)).toEqual({ x: 0, y: 0, w: l.width, h: l.height })
  })
  it('suggestTreeHeight：資料多樹較高、有上下限', () => {
    expect(suggestTreeHeight(360, 5, 2)).toBeGreaterThanOrEqual(300)
    expect(suggestTreeHeight(600, 300, 18)).toBeGreaterThan(suggestTreeHeight(600, 20, 4))
    expect(suggestTreeHeight(2000, 1000, 60)).toBeLessThanOrEqual(680)
  })
  it('clusterSummaries：則數、最近長葉日期、近 12 個月每月則數', () => {
    const s = clusterSummaries(data, NOW)
    const k4 = s.find((c) => c.id === 'K04')!
    expect(k4.count).toBe(3)
    expect(k4.lastDate).toBe('2026-11-10')
    expect(k4.months).toHaveLength(12)
    expect(k4.months[11]).toBe(1)
    expect(k4.months[10]).toBe(1)
    expect(s.reduce((n, c) => n + c.count, 0)).toBe(22)
  })
  it('insightStats 多了脈絡條數與最常被印證的那一句（前 20 字）', () => {
    const st = insightStats(data, NOW)
    expect(st.threads).toBe(new Set(data.insights.map((i) => i.thread)).size)
    expect(st.topReinforced?.count).toBe(4)
    expect(st.topReinforced?.text.startsWith('虛構心得 a1')).toBe(true)
  })
  it('12 群 300 片葉：同輸入同輸出、座標在畫布內、排版夠快；upto 不改變位置', () => {
    const big = bigData()
    const t0 = Date.now()
    const a = layoutInsightTree(big, { width: 600, height: 640, now: NOW })
    expect(Date.now() - t0).toBeLessThan(1500)
    expect(a.leaves).toHaveLength(300)
    expect(JSON.stringify(a)).toBe(JSON.stringify(layoutInsightTree(bigData(), { width: 600, height: 640, now: NOW })))
    for (const lf of a.leaves) { expect(lf.x - lf.r).toBeGreaterThanOrEqual(0); expect(lf.x + lf.r).toBeLessThanOrEqual(600) }
    const part = layoutInsightTree(big, { width: 600, height: 640, now: NOW, upto: '2026-03' })
    for (const lf of part.leaves) { const f = a.leaves.find((x) => x.id === lf.id)!; expect([f.x, f.y]).toEqual([lf.x, lf.y]) }
  })
})

describe('稀疏資料像一棵小樹（退回第 1 次）', () => {
  const day = '2026-11-14'
  const one = (id: string, cluster: string, thread: string, date = day) => ({ id, date, time: null, text: `稀疏心得 ${id}`, provenance: 'quote', cluster, thread, relation: 'new', parent: null })
  const mkData = (items: unknown[]): InsightData => {
    const d = parseInsights({ clusters: [{ id: 'K01', name: '甲群', count: 9 }, { id: 'K02', name: '乙群', count: 9 }, { id: 'K03', name: '丙群', count: 9 }], insights: items })
    if (!d) throw new Error('解析失敗')
    return d
  }
  const cases: Array<[string, InsightData]> = [
    ['1 則', mkData([one('s1', 'K01', 'T1')])],
    ['2 則（同日兩群）', mkData([one('s1', 'K01', 'T1'), one('s2', 'K02', 'T2')])],
    ['3 則', mkData([one('s1', 'K01', 'T1'), one('s2', 'K02', 'T2'), one('s3', 'K03', 'T3', '2026-11-02')])],
    ['5 則', mkData([one('s1', 'K01', 'T1'), one('s2', 'K02', 'T2'), one('s3', 'K03', 'T3', '2026-11-02'), one('s4', 'K01', 'T4', '2026-10-20'), one('s5', 'K02', 'T5', '2026-10-01')])],
  ]
  for (const [w, h] of [[360, 340], [600, 420], [1000, 520]] as const) {
    for (const [name, d] of cases) {
      it(`${name}（${w} 寬）：樹幹 ≥ 繪圖區 50%、每條枝末端高於起點、整棵樹高度 ≥ 70%`, () => {
        const l = layoutInsightTree(d, { width: w, height: h, now: NOW })
        const area = l.axis.ground - l.axis.top
        expect((l.axis.ground - l.axis.trunkTop) / area).toBeGreaterThanOrEqual(0.5)
        for (const x of l.limbs) {
          expect(x.to[1], x.id).toBeLessThanOrEqual(x.from[1] + 0.05)
          if (x.level === 'cluster') expect(x.to[1], x.id).toBeLessThan(x.from[1])
        }
        for (const th of ['T1', 'T2', 'T3', 'T4', 'T5']) {
          const segs = l.limbs.filter((x) => x.id.startsWith(`t:${th}#`))
          if (segs.length > 0) expect(segs[segs.length - 1]!.to[1]).toBeLessThan(segs[0]!.from[1])
        }
        const topTip = Math.min(...l.clusters.filter((c) => c.count > 0).map((c) => c.y))
        expect((l.axis.ground - topTip) / h).toBeGreaterThanOrEqual(0.7)
        expect(l.leaves.length).toBe(d.insights.length)
        for (const lf of l.leaves) { expect(lf.x - lf.r).toBeGreaterThanOrEqual(0); expect(lf.x + lf.r).toBeLessThanOrEqual(w) }
      })
    }
  }
  it('時間軸最少涵蓋 6 個月；樹寬依群數置中（2 群的樹冠比 12 群窄）；≤5 則葉子較大', () => {
    const l = layoutInsightTree(cases[1]![1], { width: 800, height: 420, now: NOW })
    expect((l.axis.dayMax - l.axis.dayMin) / 30.44).toBeGreaterThanOrEqual(5)
    expect(l.ticks.length).toBeGreaterThanOrEqual(3)
    const xs = l.leaves.map((x) => x.x)
    expect(Math.max(...xs) - Math.min(...xs)).toBeLessThan(400)
    const cx = (l.width + 60) / 2
    expect(Math.abs((Math.max(...xs) + Math.min(...xs)) / 2 - cx)).toBeLessThan(80)
    const big = layoutInsightTree(sample(), { width: 800, height: 420, now: NOW })
    expect(l.leaves[0]!.r).toBeGreaterThan(big.leaves.find((x) => x.relation === 'new')!.r * 1.4)
  })
  it('主枝從樹幹分出的角度離垂直 15°～60°（取枝的第一段起點到第二個取樣點）', () => {
    for (const [, d] of cases) {
      const l = layoutInsightTree(d, { width: 600, height: 420, now: NOW })
      for (const c of l.clusters.filter((x) => x.count > 0)) {
        const first = l.limbs.find((x) => x.id === `c:${c.id}#0`)!
        const nums = [...first.d.matchAll(/(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)/g)].map((m) => [+m[1]!, +m[2]!])
        // 輪廓前半是左側點：取第 1 與第 3 個點的方向（粗略，輪廓與中心線平行）
        const dx = nums[2]![0] - nums[0]![0]
        const dy = nums[0]![1] - nums[2]![1]
        const ang = (Math.atan2(Math.abs(dx), dy) * 180) / Math.PI
        expect(ang).toBeGreaterThanOrEqual(8)
        expect(ang).toBeLessThanOrEqual(75)
      }
    }
  })
})

describe('群標籤不會消失（退回第 1 次）', () => {
  it('12 群 300 則在 1200 與 360 寬：每一群都有標籤（膠囊或縮寫），縮寫最多 4 字，且都在畫布內、互不重疊', () => {
    for (const [w, h] of [[1200, 640], [360, 440], [360, 340]] as const) {
      const l = layoutInsightTree(bigData(), { width: w, height: h, now: NOW })
      const withData = l.clusters.filter((c) => c.count > 0)
      expect(withData).toHaveLength(12)
      for (const c of withData) {
        expect(c.labelShown, `${c.id} @${w}`).toBe(true)
        expect(c.text.length).toBeGreaterThan(0)
        if (c.abbr) expect([...c.text].length).toBeLessThanOrEqual(4)
        expect(c.lx - c.lw / 2).toBeGreaterThanOrEqual(0); expect(c.lx + c.lw / 2).toBeLessThanOrEqual(w)
        expect(c.ly - c.lh / 2).toBeGreaterThanOrEqual(0); expect(c.ly + c.lh / 2).toBeLessThanOrEqual(h)
      }
      const rect = (c: (typeof withData)[number]) => ({ x0: c.lx - c.lw / 2, x1: c.lx + c.lw / 2, y0: c.ly - c.lh / 2, y1: c.ly + c.lh / 2 })
      for (let i = 0; i < withData.length; i++) for (let j = i + 1; j < withData.length; j++) {
        const p = rect(withData[i]!), q = rect(withData[j]!)
        expect(p.x0 < q.x1 && p.x1 > q.x0 && p.y0 < q.y1 && p.y1 > q.y0, `${withData[i]!.id}/${withData[j]!.id} @${w}`).toBe(false)
      }
    }
  })
  it('放不下的膠囊推到外側兩欄並畫引線（leader）', () => {
    const l = layoutInsightTree(bigData(), { width: 360, height: 440, now: NOW })
    expect(l.clusters.some((c) => c.leader)).toBe(true)
  })
})

describe('聚焦時不裁切（退回第 1 次）', () => {
  it('聚焦任一群：viewBox 完整包住該群的葉子與標籤膠囊（含引線端點），且不超出畫布', () => {
    for (const [w, h] of [[360, 440], [1200, 640]] as const) {
      const l = layoutInsightTree(bigData(), { width: w, height: h, now: NOW })
      l.clusters.forEach((c, ci) => {
        if (c.count === 0) return
        const vb = focusViewBox(l, ci)
        expect(vb.x).toBeGreaterThanOrEqual(0); expect(vb.y).toBeGreaterThanOrEqual(0)
        expect(vb.x + vb.w).toBeLessThanOrEqual(w + 0.1); expect(vb.y + vb.h).toBeLessThanOrEqual(h + 0.1)
        expect(c.lx - c.lw / 2).toBeGreaterThanOrEqual(vb.x - 0.1); expect(c.lx + c.lw / 2).toBeLessThanOrEqual(vb.x + vb.w + 0.1)
        expect(c.ly - c.lh / 2).toBeGreaterThanOrEqual(vb.y - 0.1); expect(c.ly + c.lh / 2).toBeLessThanOrEqual(vb.y + vb.h + 0.1)
        expect(c.x).toBeGreaterThanOrEqual(vb.x); expect(c.x).toBeLessThanOrEqual(vb.x + vb.w)
        for (const lf of l.leaves.filter((x) => x.clusterIndex === ci)) {
          expect(lf.x - lf.r).toBeGreaterThanOrEqual(vb.x - 0.1); expect(lf.x + lf.r).toBeLessThanOrEqual(vb.x + vb.w + 0.1)
          expect(lf.y - lf.r).toBeGreaterThanOrEqual(vb.y - 0.1); expect(lf.y + lf.r).toBeLessThanOrEqual(vb.y + vb.h + 0.1)
        }
      })
    }
  })
})
