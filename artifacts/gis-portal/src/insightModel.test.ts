import { describe, expect, it } from 'vitest'
import {
  insightIdFromHash, insightStats, parseInsightDetail, parseInsightLinks, parseInsights, taipeiDay, threadDots,
  type InsightData, type InsightRelation,
} from './insightModel'

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

describe('insightStats / 日期 / 其他', () => {
  const data = sample()
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
  it('insightStats 多了脈絡條數與最常被印證的那一句（前 20 字）', () => {
    const st = insightStats(data, NOW)
    expect(st.threads).toBe(new Set(data.insights.map((i) => i.thread)).size)
    expect(st.topReinforced?.count).toBe(4)
    expect(st.topReinforced?.text.startsWith('虛構心得 a1')).toBe(true)
  })
})

describe('心得 links 與 day（卷宗）', () => {
  it('parseInsightLinks：缺鍵、非物件回空陣列，壞的單筆略過', () => {
    const empty = { people: [], ideas: [], topics: [] }
    expect(parseInsightLinks(undefined)).toEqual(empty)
    expect(parseInsightLinks('x')).toEqual(empty)
    expect(parseInsightLinks({})).toEqual(empty)
    const l = parseInsightLinks({
      people: [{ id: 'p1', name: '測試甲', dossier: '測試甲', sameSegment: true }, { id: '', name: '壞' }, 5, { id: 'p2', name: '測試乙', dossier: null, sameSegment: false }],
      ideas: [{ id: 'IDEA-0001', title: '虛構想法', mentioned: true }, { id: 'IDEA-0002' }],
      topics: [{ id: 'T1', name: '虛構主題' }, null],
    })
    expect(l.people.map((p) => [p.id, p.dossier, p.sameSegment])).toEqual([['p1', '測試甲', true], ['p2', null, false]])
    expect(l.ideas).toEqual([{ id: 'IDEA-0001', title: '虛構想法', mentioned: true }])
    expect(l.topics).toEqual([{ id: 'T1', name: '虛構主題' }])
  })

  it('舊回應沒有 links／day：解析成空', () => {
    const it = mk('a1', '2026-01-05', 'K01', 'TH-a', 'new')
    const d = parseInsightDetail({ ...it, cluster: { id: 'K01', name: '測量作業' }, evidence: '', source: '', threadItems: [it] })!
    expect(d.links).toEqual({ people: [], ideas: [], topics: [] })
    expect(d.day).toEqual({ headings: [] })
    expect(d.threadItems[0]!.links).toEqual({ people: [], ideas: [], topics: [] })
  })

  it('day.headings 只收非空字串', () => {
    const it = mk('a1', '2026-01-05', 'K01', 'TH-a', 'new')
    const d = parseInsightDetail({ ...it, cluster: { id: 'K01', name: '測量作業' }, day: { headings: ['甲', 3, '', '乙'] }, links: { people: [{ id: 'p', name: '測試甲', dossier: null, sameSegment: false }] }, threadItems: [] })!
    expect(d.day.headings).toEqual(['甲', '乙'])
    expect(d.links.people).toHaveLength(1)
  })
})
