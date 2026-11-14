import { describe, expect, it } from 'vitest'
import {
  clusterSummaries, focusViewBox, leafAge, insightIdFromHash, insightStats, layoutInsightTree, leafShape, monthSeries, OVERVIEW_ELEMENT_CAP, suggestTreeHeight, parseInsightDetail, parseInsights, taipeiDay, threadDots, threadWidth,
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


describe('小東西', () => {
  const data = sample()
  it('葉形依 relation 各不相同', () => {
    const shapes = (['new', 'reinforce', 'refine', 'overturn'] as const).map((r) => leafShape(r))
    expect(new Set(shapes.map((x) => x.d)).size).toBe(4)
    expect(shapes.map((x) => x.kind)).toEqual(['bud', 'leaf', 'fork', 'dead'])
  })
  it('suggestTreeHeight：桌機約 min(78vh, 900)、手機依寬度', () => {
    expect(suggestTreeHeight(1200, 1000)).toBe(780)
    expect(suggestTreeHeight(1200, 2000)).toBe(900)
    expect(suggestTreeHeight(360, 800)).toBeGreaterThanOrEqual(420)
    expect(suggestTreeHeight(360, 800)).toBeLessThanOrEqual(620)
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
})

const W = 1200
const H = 780
const dateOf = new Map<string, string>()

/** n 則、k 群的合成資料；每群的心得跨多年（含跨年新葉） */
function synth(n: number, k: number, years = 5): InsightData {
  const out: unknown[] = []
  for (let i = 0; i < n; i++) {
    const c = i % k
    const th = `TH-${c}-${Math.floor(i / k) % 7}`
    const ago = Math.floor(((n - 1 - i) * years * 365) / Math.max(1, n)) + (c % 3) * 3
    const d = new Date(NOW.getTime() - ago * 86_400_000).toISOString().slice(0, 10)
    out.push({ id: `S${i}`, date: d, time: null, text: `合成 ${i}`, provenance: 'quote', cluster: `K${String(c + 1).padStart(2, '0')}`, thread: th, relation: 'new', parent: null })
  }
  const d = parseInsights({ clusters: Array.from({ length: k }, (_, i) => ({ id: `K${String(i + 1).padStart(2, '0')}`, name: `領域${i + 1}`, count: 1 })), insights: out })
  if (!d) throw new Error('synth 解析失敗')
  for (const i of d.insights) dateOf.set(i.id, i.date)
  return d
}

describe('人生樹排版（3.0.0）', () => {
  const data = sample()
  const l = layoutInsightTree(data, { width: W, height: H, now: NOW })
  const lAll = layoutInsightTree(data, { width: W, height: H, now: NOW, focus: 'K01' })

  it('同輸入同輸出', () => {
    expect(JSON.stringify(layoutInsightTree(data, { width: W, height: H, now: NOW }))).toBe(JSON.stringify(l))
  })
  it('主枝接點順序＝主題第一次出現的順序，且等距（不帶時間刻度），左右交錯', () => {
    const firsts = l.clusters.map((c) => c.firstDate)
    expect(firsts).toEqual([...firsts].sort())
    expect(l.clusters.map((c) => c.id)).toEqual(['K01', 'K02', 'K03', 'K04'])
    const ys = l.clusters.map((c) => c.ay)
    for (let i = 1; i < ys.length; i++) expect(ys[i]).toBeLessThan(ys[i - 1]!)
    const gaps = ys.slice(1).map((y, i) => ys[i]! - y)
    for (const g of gaps) expect(Math.abs(g - gaps[0]!)).toBeLessThan(0.3)
    expect(l.clusters.map((c) => c.side)).toEqual([1, -1, 1, -1])
  })
  it('樹幹高度固定、與主枝數無關', () => {
    const a = layoutInsightTree(synth(40, 3), { width: W, height: H, now: NOW })
    const b = layoutInsightTree(synth(40, 12), { width: W, height: H, now: NOW })
    expect(b.axis.ground).toBe(a.axis.ground)
    expect(b.height).toBe(a.height)
    expect(b.axis.trunkTop).toBeLessThan(b.axis.ground - 100)
    expect(a.axis.trunkTop).toBeLessThan(a.axis.ground - 100)
  })
  it('同主題的葉沿主枝由內往外日期單調遞增（含跨年新葉在最外側）', () => {
    const d = synth(120, 6, 6)
    const ly = layoutInsightTree(d, { width: W, height: H, now: NOW, focus: 'K01' })
    for (let k = 0; k < ly.clusters.length; k++) {
      const mine = ly.leaves.filter((x) => x.clusterIndex === k).sort((a, b) => a.bt - b.bt)
      expect(mine.length).toBeGreaterThan(1)
      for (let i = 1; i < mine.length; i++) expect(dateOf.get(mine[i]!.id)! >= dateOf.get(mine[i - 1]!.id)!).toBe(true)
    }
    const k1 = lAll.leaves.filter((x) => x.clusterIndex === 0).sort((a, b) => a.bt - b.bt)
    expect(k1[k1.length - 1]!.id).toBe('x3')
    const more = parseInsights({ clusters: [{ id: 'K01', name: '測量作業', count: 3 }], insights: [mk('o1', '2020-01-05', 'K01', 'T1', 'new'), mk('o2', '2022-03-05', 'K01', 'T1', 'reinforce', 'o1'), mk('o3', '2026-03-05', 'K01', 'T2', 'new')] })!
    const lm = layoutInsightTree(more, { width: W, height: H, now: NOW })
    const bts = ['o1', 'o2', 'o3'].map((id) => lm.leaves.find((x) => x.id === id)!.bt)
    expect(bts[0]!).toBeLessThan(bts[1]!)
    expect(bts[1]!).toBeLessThan(bts[2]!)
    const dist = ['o1', 'o2', 'o3'].map((id) => Math.abs(lm.leaves.find((x) => x.id === id)!.x - lm.axis.cx))
    expect(dist[2]!).toBeGreaterThan(dist[0]!)
  })
  it('脈絡細枝分出位置隨脈絡第一則日期單調', () => {
    const first = new Map<string, { date: string; bt: number }>()
    for (const lf of lAll.leaves.filter((x) => x.clusterIndex === 0)) {
      const ins = data.insights.find((i) => i.id === lf.id)!
      const cur = first.get(ins.thread)
      if (!cur || ins.date < cur.date) first.set(ins.thread, { date: ins.date, bt: lf.bt })
    }
    const arr = [...first.values()].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0))
    expect(arr.length).toBeGreaterThanOrEqual(3)
    for (let i = 1; i < arr.length; i++) expect(arr[i]!.bt).toBeGreaterThanOrEqual(arr[i - 1]!.bt)
    const forks = lAll.limbs.filter((x) => x.level === 'thread' && x.clusterIndex === 0 && /#0$/.test(x.id))
    expect(forks.length).toBeGreaterThanOrEqual(3)
  })
  it('沒有葉子落在樹幹上、座標都在畫布內（含手機 360）', () => {
    for (const [w, h] of [[W, H], [360, 560]] as const) {
      for (const d of [data, synth(300, 12), synth(1, 1)]) {
        const ly = layoutInsightTree(d, { width: w, height: h, now: NOW })
        const trunkHalf = ly.trunk.width / 2
        for (const lf of [...ly.leaves, ...ly.clumps]) {
          expect(Math.abs(lf.x - ly.axis.cx)).toBeGreaterThan(trunkHalf)
          expect(lf.x).toBeGreaterThanOrEqual(0); expect(lf.x).toBeLessThanOrEqual(w)
          expect(lf.y).toBeGreaterThanOrEqual(0); expect(lf.y).toBeLessThanOrEqual(h)
        }
      }
    }
  })
  it('總覽元素數 ≤ 上限：1、13（9 群）、300、5000 則', () => {
    const cases: Array<[string, InsightData]> = [['1', synth(1, 1)], ['13/9群', synth(13, 9)], ['300', synth(300, 12)], ['5000', synth(5000, 12)]]
    for (const [name, d] of cases) {
      const ly = layoutInsightTree(d, { width: W, height: H, now: NOW })
      expect(ly.elementCount, name).toBeLessThanOrEqual(OVERVIEW_ELEMENT_CAP)
      expect(ly.limbs.length + ly.leaves.length + ly.clumps.length + 1, name).toBe(ly.elementCount)
    }
    const big = layoutInsightTree(synth(5000, 12), { width: W, height: H, now: NOW })
    expect(big.clumps.length).toBeGreaterThan(0)
    for (let k = 0; k < 12; k++) expect(big.leaves.filter((x) => x.clusterIndex === k).length).toBeLessThanOrEqual(24)
    expect(big.clumps.reduce((s, c) => s + c.count, 0) + big.leaves.length).toBe(5000)
  })
  it('聚焦一群：畫出該群全部的葉，不聚合', () => {
    const ly = layoutInsightTree(synth(500, 5), { width: W, height: H, now: NOW, focus: 'K02' })
    const k = ly.clusters.findIndex((c) => c.id === 'K02')
    expect(ly.leaves.filter((x) => x.clusterIndex === k).length).toBe(100)
    expect(ly.clumps.filter((c) => c.clusterIndex === k).length).toBe(0)
  })
  it('12 主題時膠囊互不重疊，放不下的縮成色點', () => {
    for (const [w, h] of [[W, H], [360, 560], [800, 600]] as const) {
      const ly = layoutInsightTree(synth(300, 12), { width: w, height: h, now: NOW })
      const shown = ly.clusters.filter((c) => c.labelShown)
      for (let i = 0; i < shown.length; i++) {
        const a = shown[i]!
        expect(a.lx - a.lw / 2).toBeGreaterThanOrEqual(0); expect(a.lx + a.lw / 2).toBeLessThanOrEqual(w)
        for (let j = i + 1; j < shown.length; j++) {
          const b = shown[j]!
          expect(Math.abs(a.lx - b.lx) < (a.lw + b.lw) / 2 && Math.abs(a.ly - b.ly) < (a.lh + b.lh) / 2).toBe(false)
        }
      }
    }
    expect(layoutInsightTree(synth(300, 12), { width: 360, height: 200, now: NOW }).clusters.some((c) => !c.labelShown)).toBe(true)
  })
  it('聚焦時沿主枝的時間標籤單調、在可視範圍內；不到一年標月份', () => {
    const ly = layoutInsightTree(synth(120, 3, 6), { width: W, height: H, now: NOW, focus: 'K01' })
    const c = ly.clusters[0]!
    expect(c.ticks.length).toBeGreaterThanOrEqual(4)
    for (let i = 1; i < c.ticks.length; i++) expect(c.ticks[i]!.t).toBeGreaterThan(c.ticks[i - 1]!.t)
    const vb = focusViewBox(ly, 0)
    for (const t of c.ticks) {
      expect(/^\d{4}$/.test(t.label)).toBe(true)
      expect(t.x).toBeGreaterThanOrEqual(vb.x - 1); expect(t.x).toBeLessThanOrEqual(vb.x + vb.w + 1)
      expect(t.y).toBeGreaterThanOrEqual(vb.y - 1); expect(t.y).toBeLessThanOrEqual(vb.y + vb.h + 1)
    }
    const short = layoutInsightTree(data, { width: W, height: H, now: NOW, focus: 'K04' })
    expect(short.clusters.find((x) => x.id === 'K04')!.ticks.every((t) => /^\d{4}-\d{2}$/.test(t.label))).toBe(true)
    expect(l.clusters.every((x) => x.ticks.length === 0)).toBe(true)
  })
  it('新舊葉色分級：30 天內發光、一年內、1～3 年、3 年以上', () => {
    expect([0, 30, 31, 365, 366, 1095, 1096, 4000].map(leafAge)).toEqual([0, 0, 1, 1, 2, 2, 3, 3])
    const d = parseInsights({ clusters: [{ id: 'K01', name: 'x', count: 4 }], insights: [mk('n1', '2026-11-01', 'K01', 'T', 'new'), mk('n2', '2026-01-01', 'K01', 'T2', 'new'), mk('n3', '2024-06-01', 'K01', 'T3', 'new'), mk('n4', '2021-06-01', 'K01', 'T4', 'new')] })!
    const ly = layoutInsightTree(d, { width: W, height: H, now: NOW })
    const age = (id: string) => ly.leaves.find((x) => x.id === id)!
    expect([age('n1').age, age('n2').age, age('n3').age, age('n4').age]).toEqual([0, 1, 2, 3])
    expect(age('n1').glow).toBe(true)
    expect(age('n2').glow).toBe(false)
  })
  it('refine 從 parent 葉分岔、overturn 讓 parent 葉與那段枝枯萎（聚焦時逐段）', () => {
    const a5 = lAll.leaves.find((x) => x.id === 'a5')!
    const a4 = lAll.leaves.find((x) => x.id === 'a4')!
    expect(a5.relation).toBe('refine')
    expect(a5.path.slice(0, -1).every((p) => a4.path.includes(p))).toBe(true)
    const lc = layoutInsightTree(data, { width: W, height: H, now: NOW, focus: 'K03' })
    expect(lc.leaves.find((x) => x.id === 'c1')!.withered).toBe(true)
    expect(lc.limbs.some((x) => x.withered)).toBe(true)
  })
  it('upto 只輸出該月底以前的枝葉，且不改變位置', () => {
    const part = layoutInsightTree(data, { width: W, height: H, now: NOW, upto: '2026-04' })
    for (const lf of part.leaves) { const f = l.leaves.find((x) => x.id === lf.id)!; expect([lf.x, lf.y]).toEqual([f.x, f.y]) }
    expect(part.leaves.length).toBeLessThan(l.leaves.length)
    expect(part.leaves.every((x) => data.insights.find((i) => i.id === x.id)!.date.slice(0, 7) <= '2026-04')).toBe(true)
  })
  it('沒有心得時只有樹幹；滑過葉子的路徑從樹幹出發', () => {
    const empty = layoutInsightTree({ total: 0, thisMonth: 0, clusters: [], insights: [] }, { width: W, height: H, now: NOW })
    expect(empty.leaves).toHaveLength(0)
    expect(empty.limbs).toHaveLength(0)
    for (const lf of l.leaves) expect(lf.path[0]).toBe('trunk')
  })
  it('focusViewBox：包住那一群、維持長寬比、不超出畫布；null＝全樹', () => {
    expect(focusViewBox(l, null)).toEqual({ x: 0, y: 0, w: W, h: H })
    const v = focusViewBox(lAll, 0)
    expect(v.w / v.h).toBeCloseTo(W / H, 1)
    expect(v.x).toBeGreaterThanOrEqual(0); expect(v.x + v.w).toBeLessThanOrEqual(W + 0.1)
    expect(v.y).toBeGreaterThanOrEqual(0); expect(v.y + v.h).toBeLessThanOrEqual(H + 0.1)
  })
  it('5000 則排版夠快', () => {
    const d = synth(5000, 12)
    const t0 = Date.now()
    layoutInsightTree(d, { width: W, height: H, now: NOW })
    expect(Date.now() - t0).toBeLessThan(3000)
  })
})
