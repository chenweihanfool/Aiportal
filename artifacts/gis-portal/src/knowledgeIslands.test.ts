import { describe, expect, it } from 'vitest'
import {
  aiBridgesAt, analyzeTopic, bridgesAt, buildIslandModel, buildStations, cardMark, cardRect, computeBridges, fitView, islandSize, islandStats, isSeed, kbLinksFor,
  layoutSea, resolveStepBridges, chipGroups, defaultSelection, indexScale, orphanSteps, groupBullets, isValidSelection, nodeOrder, stationForNode, shelf, shortLabel, stationCoverage, zoomAt,
  islandView, latestTopicId, MAX_K, MIN_K, UNASSIGNED_ID, type Box, type Placed,
} from './knowledgeIslands'
import { buildTree, parseBodyWithMarkers, type Topic, type TopicClaim } from './knowledgeView'
import type { FlowDiagram } from './knowledgeView'
import type { TopicStep } from './knowledgeSteps'
import type { KbLink, KbStep, StepBridge } from './insightWeave'

function topic(over: Partial<Topic> & { id: string }): Topic {
  return {
    name: `題${over.id}`, kind: 'method', why: '', firstSeen: '2026-01-01', lastSeen: null, updated: null, revision: 1, docs: 1, newDocs: 0,
    monthsSpan: 1, firstMonth: null, lastMonth: null, body: null, growth: [], sources: [], related: [], branch: null, path: [], monthCounts: [], diagram: null,
    ...over,
  }
}

const METHOD_BODY = [
  '## 開工前準備', '- 備妥甲資料⟦1⟧',
  '## 步驟', '- 先做甲，再做乙⟦1⟧', '- 第二件事要做完這個很長很長很長很長的動作才算數⟦1⟧',
  '## 判斷點', '- 如果：甲成立 → 就：走乙⟦1⟧',
  '## 踩過的坑', '- 漏填：補上',
  '## 還不知道', '- 某事來源沒有說清楚',
].join('\n')
const CONCEPT_BODY = ['## 為什麼存在', '- 因為有需要⟦1⟧', '## 常見誤解', '- 以為：甲 → 其實：乙⟦1⟧', '## 實例', '- 某例⟦1⟧'].join('\n')

const claim = (id: string, text: string, section = '步驟'): TopicClaim => ({ id, section, status: 'active', origin: 'model', pinned: false, firstSeen: '2026-01-01', lastChanged: '2026-01-01', text })
const step = (id: string, claimId: string, over: Partial<TopicStep['why']> = {}, docs: TopicStep['docs'] = []): TopicStep => ({
  id, title: 't', claim: claimId, node: null, docs, why: { rules: [], insights: [], pitfalls: [], ...over }, cases: [],
})
const ins = (n: number) => ({ insightId: `INS-2026-01-0${n}-0000000${n}`, quote: `假心得${n}`, date: '2026-01-01' })
const rule = (article: string, claimId = 'c002') => ({ text: '假條文', article, claim: claimId, src: 1 })
const doc = (n: number, family: string) => ({ templateId: `tpl_000000000${n}`, family, docType: '函' as const, role: '公文' as const, score: 0.9, others: 0, evidence: [] })

function methodTopic(id: string, steps: TopicStep[]): Topic {
  return topic({
    id, body: METHOD_BODY, steps,
    claims: [claim('c001', '- 先做甲，再做乙⟦1⟧'), claim('c002', '- 第二件事要做完這個很長很長很長很長的動作才算數⟦1⟧')],
  })
}

describe('島模型', () => {
  it('tree 轉群島／島／卡，空枝略過，未歸類另成群島，種子判定', () => {
    const topics = [topic({ id: 'a', body: CONCEPT_BODY }), topic({ id: 'b', revision: 0 }), topic({ id: 'c' })]
    const built = buildTree({
      topics,
      tree: { domains: [
        { id: 'd1', name: '領域一', branches: [{ id: 'b1', name: '枝一', topics: ['a', 'b'] }, { id: 'b2', name: '空枝', topics: [] }] },
        { id: 'd2', name: '空領域', branches: [{ id: 'b3', name: '枝三', topics: [] }] },
      ] },
    })
    const m = buildIslandModel(built)
    expect(m.map((d) => d.id)).toEqual(['d1', UNASSIGNED_ID])
    expect(m[0]!.islands).toHaveLength(1)
    expect(m[0]!.islands[0]!.topics.map((t) => t.id)).toEqual(['a', 'b'])
    expect(m[1]!.islands[0]!.topics.map((t) => t.id)).toEqual(['c'])
    expect(m.map((d) => d.slot)).toEqual([0, 1])
    expect(isSeed(topics[1]!)).toBe(true)
    expect(isSeed(topics[0]!)).toBe(false)
    expect(isSeed(topic({ id: 'x', revision: 2, body: null }))).toBe(true)
  })
})

describe('站切分', () => {
  it('方法題：準備→步驟→判斷點→坑→還不知道', () => {
    const st = buildStations(parseBodyWithMarkers(METHOD_BODY))
    expect(st.map((s) => s.kind)).toEqual(['prep', 'step', 'step', 'decision', 'pitfall', 'unknown'])
    expect(st[1]!.stepNo).toBe(1)
    expect(st[2]!.stepNo).toBe(2)
    expect(st[1]!.label).toBe('先做甲')
  })
  it('概念題：為什麼→誤解→實例', () => {
    expect(buildStations(parseBodyWithMarkers(CONCEPT_BODY)).map((s) => s.kind)).toEqual(['why', 'myth', 'example'])
  })
  it('缺段落就沒有那一站；沒有本文＝空', () => {
    const st = buildStations(parseBodyWithMarkers(['## 步驟', '- 只有一步⟦1⟧'].join('\n')))
    expect(st.map((s) => s.kind)).toEqual(['step'])
    expect(buildStations(null)).toEqual([])
  })
  it('站名截斷：取第一個子句、最多 15 字', () => {
    expect(shortLabel('先做甲，再做乙')).toBe('先做甲')
    expect(shortLabel('一二三四五六七八九十一二三四五')).toBe('一二三四五六七八九十一二三四五')
    const long = shortLabel('一二三四五六七八九十一二三四五六七八')
    expect([...long]).toHaveLength(15)
    expect(long.endsWith('…')).toBe(true)
    expect(shortLabel('，只有標點開頭')).toBe('，只有標點開頭')
  })
})

describe('心得對應到站', () => {
  it('以 step.claim 對到該站，對不到略過，心得去重', () => {
    const t = methodTopic('m1', [
      step('s1', 'c001', { insights: [ins(1)] }),
      step('s2', 'c002', { insights: [ins(1), ins(2)] }),
      step('s3', 'c999', { insights: [ins(3)] }),
    ])
    const a = analyzeTopic(t)
    expect(a.links.get('step:0')!.insights.map((i) => i.quote)).toEqual(['假心得1'])
    expect(a.links.get('step:1')!.insights).toHaveLength(2)
    expect([...a.links.keys()].sort()).toEqual(['step:0', 'step:1'])
    expect(a.insightIds.size).toBe(3)
  })
  it('沒有帳本或沒有步驟＝不掛任何站', () => {
    expect(analyzeTopic(topic({ id: 'x', body: METHOD_BODY, steps: [step('s1', 'c001', { insights: [ins(1)] })] })).links.size).toBe(0)
    expect(analyzeTopic(topic({ id: 'y', body: CONCEPT_BODY })).links.size).toBe(0)
  })
})

describe('盲點與統計', () => {
  const t1 = methodTopic('m1', [step('s1', 'c001', { insights: [ins(1)] })])
  const t2 = methodTopic('m2', [])
  const t3 = topic({ id: 'm3', revision: 0, name: '種子題' })
  const an = new Map([t1, t2, t3].map((t) => [t.id, analyzeTopic(t)]))
  it('站覆蓋', () => {
    expect(stationCoverage(an.get('m1')!)).toEqual({ covered: 1, total: 2 })
    expect(stationCoverage(an.get('m3')!)).toEqual({ covered: 0, total: 0 })
  })
  it('卡片角標：有心得、盲點、種子等待、無', () => {
    const kb: KbLink[] = [{ id: 'k1', confidence: 'mid', status: 'proposed', since: '', kind: 'seed', topic: '種子題', insights: [], text: '假' }]
    expect(cardMark(t1, an.get('m1')!, kb)).toEqual({ type: 'insights', n: 1 })
    expect(cardMark(t2, an.get('m2')!, kb)).toEqual({ type: 'blind' })
    expect(cardMark(t3, an.get('m3')!, kb)).toEqual({ type: 'waiting' })
    expect(cardMark(t3, an.get('m3')!, null)).toBeNull()
    expect(kbLinksFor(kb, t3)).toHaveLength(1)
    expect(kbLinksFor(undefined, t3)).toEqual([])
  })
  it('島統計：心得、盲點／已發布', () => {
    const s = islandStats({ topics: [t1, t2, t3] }, an, [])
    expect(s).toEqual({ insights: 1, bridges: 0, blind: 1, published: 2 })
  })
})

describe('橋', () => {
  const a = analyzeTopic(methodTopic('a', [step('s1', 'c001', { rules: [rule('第221條', 'c001')] }, [doc(1, '申請函')])]))
  const b = analyzeTopic(methodTopic('b', [step('s2', 'c002', { rules: [rule('第221條')] }, [doc(1, '申請函'), doc(2, '別的函')])]))
  const c = analyzeTopic(methodTopic('c', [step('s3', 'c001', { rules: [rule('第999條', 'c001')] })]))
  it('不同題目共用同一法條或範本才算橋；單一題不算', () => {
    const br = computeBridges([a, b, c])
    expect(br.map((x) => x.key)).toEqual(['doc:tpl_0000000001', 'rule:第221條'])
    expect(br.find((x) => x.kind === 'doc')!.name).toBe('申請函')
    expect(br.find((x) => x.kind === 'rule')!.name).toBe('第221條')
    expect(br[0]!.ends).toHaveLength(2)
  })
  it('同一題內重複不算橋', () => {
    const t = analyzeTopic(methodTopic('z', [step('s1', 'c001', { rules: [rule('第5條', 'c001')] }), step('s2', 'c002', { rules: [rule('第5條')] })]))
    expect(computeBridges([t])).toEqual([])
  })
  it('bridgesAt 回別題的另一端；島統計算橋數', () => {
    const br = computeBridges([a, b, c])
    const at = bridgesAt(br, 'a', 'step:0')
    expect(at).toHaveLength(2)
    expect(at[0]!.others.every((e) => e.topicId === 'b')).toBe(true)
    expect(bridgesAt(br, 'c', 'step:0')).toEqual([])
    const an = new Map([a, b, c].map((x) => [x.topicId, x]))
    expect(islandStats({ topics: [topic({ id: 'a' })] }, an, br).bridges).toBe(2)
    expect(islandStats({ topics: [topic({ id: 'c' })] }, an, br).bridges).toBe(0)
  })
})

describe('AI 步驟對應與 AI 橋', () => {
  const t1 = methodTopic('m1', [])
  const t2 = methodTopic('m2', [])
  const aiStep = (id: string, topicId: string, claimId: string, insightId: string): KbStep => ({
    id, insight: insightId, topic: topicId, claim: claimId, relation: 'support', text: '假對應', confidence: 'mid', status: 'proposed', since: '2026-11-22',
  })
  const stepBridge = (id: string, ends: StepBridge['ends']): StepBridge => ({
    id, title: '同一步', text: '兩題同一步', ends, confidence: 'mid', status: 'proposed', since: '2026-11-22',
  })
  const ka = aiStep('S-00000001', 'm1', 'c001', 'INS-2026-11-01-00000051')
  const kb2 = aiStep('S-00000002', 'm2', 'c002', 'INS-2026-11-01-00000052')

  it('AI 對應掛到 claim 對到的站，同站同心得去重', () => {
    const a = analyzeTopic(t1, [ka, { ...ka, id: 'S-0000000f' }])
    expect(a.ai.get('step:0')!.map((s) => s.insight)).toEqual([ka.insight])
    expect(a.ai.has('step:1')).toBe(false)
    expect(a.insightIds.has(ka.insight)).toBe(true)
  })
  it('claim 對不到站的不掛，但心得仍算進 insightIds', () => {
    const a = analyzeTopic(t1, [aiStep('S-00000003', 'm1', 'c999', 'INS-2026-11-01-00000053')])
    expect(a.ai.size).toBe(0)
    expect(a.insightIds.has('INS-2026-11-01-00000053')).toBe(true)
  })
  it('hidden 的 AI 對應不掛也不算心得；別題的不掛', () => {
    const a = analyzeTopic(t1, [ka], new Set([ka.id]))
    expect(a.ai.size).toBe(0)
    expect(a.insightIds.has(ka.insight)).toBe(false)
    expect(analyzeTopic(t1, [kb2]).ai.size).toBe(0)
  })
  it('站覆蓋把 AI 對應算進去', () => {
    expect(stationCoverage(analyzeTopic(t1, [ka]))).toEqual({ covered: 1, total: 2 })
  })
  it('resolveStepBridges：對不到的端丟掉、不同題不到 2 題丟整座、hidden 丟整座', () => {
    const an = new Map([t1, t2].map((t) => [t.id, analyzeTopic(t, [ka, kb2])]))
    const good = stepBridge('J-00000001', [{ topic: 'm1', claim: 'c001' }, { topic: 'm2', claim: 'c002' }])
    const mixed = stepBridge('J-00000002', [{ topic: 'm1', claim: 'c001' }, { topic: 'm2', claim: 'c999' }])
    const sameTopic = stepBridge('J-00000003', [{ topic: 'm1', claim: 'c001' }, { topic: 'm1', claim: 'c002' }])
    const res = resolveStepBridges([good, mixed, sameTopic], an)
    expect(res.map((b) => b.id)).toEqual(['J-00000001'])
    expect(res[0]!.ends).toEqual([{ topicId: 'm1', stationId: 'step:0' }, { topicId: 'm2', stationId: 'step:1' }])
    expect(resolveStepBridges([good], an, new Set(['J-00000001']))).toEqual([])
  })
  it('aiBridgesAt 回別題的另一端', () => {
    const an = new Map([t1, t2].map((t) => [t.id, analyzeTopic(t)]))
    const b = resolveStepBridges([stepBridge('J-00000001', [{ topic: 'm1', claim: 'c001' }, { topic: 'm2', claim: 'c002' }])], an)
    const at = aiBridgesAt(b, 'm1', 'step:0')
    expect(at).toHaveLength(1)
    expect(at[0]!.others).toEqual([{ topicId: 'm2', stationId: 'step:1' }])
    expect(aiBridgesAt(b, 'm1', 'step:1')).toEqual([])
  })
  it('islandStats 的橋數含 AI 橋', () => {
    const an = new Map([t1, t2].map((t) => [t.id, analyzeTopic(t)]))
    const b = resolveStepBridges([stepBridge('J-00000001', [{ topic: 'm1', claim: 'c001' }, { topic: 'm2', claim: 'c002' }])], an)
    expect(islandStats({ topics: [t1] }, an, [], b).bridges).toBe(1)
    expect(islandStats({ topics: [topic({ id: 'zzz' })] }, an, [], b).bridges).toBe(0)
    expect(islandStats({ topics: [t1] }, an, []).bridges).toBe(0)
  })
})

const overlap = (p: Placed, q: Placed): boolean => p.x < q.x + q.w && q.x < p.x + p.w && p.y < q.y + q.h && q.y < p.y + p.h

describe('版面', () => {
  it('shelf：超寬換行、不重疊、每列置中', () => {
    const boxes: Box[] = [{ w: 100, h: 50 }, { w: 100, h: 80 }, { w: 100, h: 40 }, { w: 60, h: 30 }]
    const r = shelf(boxes, 230, 10, 10)
    for (let i = 0; i < boxes.length; i++) for (let j = i + 1; j < boxes.length; j++) expect(overlap(r.pos[i]!, r.pos[j]!)).toBe(false)
    expect(r.w).toBeGreaterThanOrEqual(230)
    expect(r.pos[2]!.y).toBeGreaterThan(r.pos[0]!.y)
    expect(shelf([], 100, 5, 5)).toEqual({ pos: [], w: 100, h: 0 })
  })
  it('layoutSea：各種數量下島與領域都不重疊，島在領域框內', () => {
    for (const counts of [[1], [3, 5], [12, 1, 4, 7, 2], [2, 2, 2, 2, 2, 2, 2]]) {
      const doms = counts.map((n) => ({ islands: Array.from({ length: n }, (_, i) => islandSize((i % 9) + 1)) }))
      const lay = layoutSea(doms, 16 / 9)
      const islands = lay.domains.flatMap((d) => d.islands)
      for (let i = 0; i < lay.domains.length; i++) {
        for (let j = i + 1; j < lay.domains.length; j++) expect(overlap(lay.domains[i]!, lay.domains[j]!)).toBe(false)
        for (const q of lay.domains[i]!.islands) {
          expect(q.x).toBeGreaterThanOrEqual(lay.domains[i]!.x)
          expect(q.x + q.w).toBeLessThanOrEqual(lay.domains[i]!.x + lay.domains[i]!.w + 0.001)
          expect(q.y + q.h).toBeLessThanOrEqual(lay.domains[i]!.y + lay.domains[i]!.h + 0.001)
        }
      }
      for (let i = 0; i < islands.length; i++) for (let j = i + 1; j < islands.length; j++) expect(overlap(islands[i]!, islands[j]!)).toBe(false)
      expect(islands).toHaveLength(counts.reduce((s, n) => s + n, 0))
    }
    expect(layoutSea([], 1.5)).toEqual({ domains: [], width: 0, height: 0 })
  })
  it('卡片位置在島內且彼此不重疊', () => {
    for (const n of [1, 2, 5, 9, 23]) {
      const sz = islandSize(n)
      const rs = Array.from({ length: n }, (_, i) => cardRect(i, n))
      for (const r of rs) { expect(r.x + r.w).toBeLessThanOrEqual(sz.w); expect(r.y + r.h).toBeLessThanOrEqual(sz.h) }
      for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) expect(overlap(rs[i]!, rs[j]!)).toBe(false)
    }
  })
  it('fitView／zoomAt：置中縮放、限制範圍、縮放點不動', () => {
    const v = fitView(2000, 1000, 800, 600)
    expect(v.k).toBeLessThan(1)
    expect(v.x + 1000 * v.k).toBeCloseTo(400)
    expect(fitView(0, 0, 800, 600)).toEqual({ x: 0, y: 0, k: 1 })
    const z = zoomAt({ x: 10, y: 20, k: 1 }, 2, 100, 100)
    expect(z.k).toBe(2)
    expect((100 - z.x) / z.k).toBeCloseTo((100 - 10) / 1)
    expect(zoomAt({ x: 0, y: 0, k: 2.5 }, 5, 0, 0).k).toBe(2.6)
  })
})

describe('島視角與最新（3.24.0）', () => {
  it('islandView：島框置中、縮放到約 70%、k 夾在 MIN_K～MAX_K', () => {
    const box = { x: 100, y: 200, w: 400, h: 200 }
    const v = islandView(box, 1000, 800)
    expect(v.k).toBe(1.75)
    expect(box.x * v.k + v.x + (box.w * v.k) / 2).toBeCloseTo(500)
    expect(box.y * v.k + v.y + (box.h * v.k) / 2).toBeCloseTo(400)
    expect(islandView({ x: 0, y: 0, w: 100000, h: 100000 }, 1000, 800).k).toBe(MIN_K)
    expect(islandView({ x: 0, y: 0, w: 1, h: 1 }, 1000, 800).k).toBe(MAX_K)
  })
  it('islandView：空資料或零尺寸回預設視角', () => {
    expect(islandView({ x: 0, y: 0, w: 0, h: 0 }, 800, 600)).toEqual({ x: 0, y: 0, k: 1 })
    expect(islandView({ x: 0, y: 0, w: 10, h: 10 }, 0, 600)).toEqual({ x: 0, y: 0, k: 1 })
  })
  it('latestTopicId：updated 最大者；沒有 updated 取 recent 第一個；都沒有 null', () => {
    const ts = [topic({ id: 'a', updated: '2026-03-01' }), topic({ id: 'b', updated: '2026-05-02' }), topic({ id: 'c' })]
    expect(latestTopicId(ts, new Map())).toBe('b')
    expect(latestTopicId([topic({ id: 'x' }), topic({ id: 'y' })], new Map([['y', 'revised']]))).toBe('y')
    expect(latestTopicId([topic({ id: 'x' })], new Map())).toBeNull()
  })
})

describe('索引模式（3.23.0）', () => {
  const flow: FlowDiagram = {
    type: 'flow', version: 1, lanes: ['甲', '乙'], phases: ['p0', 'p1'],
    nodes: [
      { id: 'n3', label: '丙', src: [1], lane: 0, phase: 1, shape: 'step' },
      { id: 'n2', label: '乙', src: [1], lane: 1, phase: 0, shape: 'decision' },
      { id: 'n1', label: '甲', src: [1], lane: 0, phase: 0, shape: 'step' },
    ],
    edges: [],
  }
  const t = topic({ id: 'x', body: METHOD_BODY, diagram: flow, claims: [claim('c1', '先做甲，再做乙')], steps: [step('s1', 'c1')] })

  it('nodeOrder：flow 依 phase 再 lane', () => {
    expect(nodeOrder(flow)).toEqual(['n1', 'n2', 'n3'])
    expect(nodeOrder(null)).toEqual([])
  })

  it('nodeOrder：timeline 依日期、map 依三欄', () => {
    expect(nodeOrder({ type: 'timeline', version: 1, tracks: [{ id: 't', label: 't' }], metrics: [], items: [
      { track: 't', date: '2026-02-01', label: 'b', src: [1] }, { track: 't', date: '2026-01-01', label: 'a', src: [1] },
    ] })).toEqual(['i1', 'i0'])
    expect(nodeOrder({ type: 'map', version: 1, core: 'c', links: [],
      observations: [{ id: 'o1', label: 'o', src: [1] }], frameworks: [{ id: 'f1', label: 'f', src: [1] }], judgments: [{ id: 'j1', label: 'j', src: [1] }] })).toEqual(['o1', 'f1', 'j1'])
  })

  it('chipGroups：方法題只列有條目的組並附數量；沒有頁面為空', () => {
    const a = analyzeTopic(t)
    expect(chipGroups(a.parsed).map((g) => [g.key, g.n])).toEqual([['prep', 1], ['decisions', 1], ['pitfalls', 1], ['unknown', 1]])
    expect(chipGroups(null)).toEqual([])
    const c = analyzeTopic(topic({ id: 'c', kind: 'concept', body: CONCEPT_BODY }))
    expect(chipGroups(c.parsed).map((g) => g.key)).toEqual(['why', 'myths', 'examples'])
    expect(groupBullets(a.parsed, 'decisions')).toHaveLength(1)
  })

  it('stationForNode：步驟卡的 node → claim 的站；備援圖的格子就是站；其餘 null', () => {
    const withNode = topic({ id: 'x', body: METHOD_BODY, diagram: flow, claims: [claim('c1', '- 先做甲，再做乙⟦1⟧')], steps: [{ ...step('s1', 'c1'), node: 'n1' }] })
    const a = analyzeTopic(withNode)
    expect(stationForNode(withNode, a, 'n1')).toBe('step:0')
    expect(stationForNode(withNode, a, 'n3')).toBeNull()
    expect(stationForNode(withNode, a, 'step:1')).toBe('step:1')
  })

  it('defaultSelection：有步驟卡的格子優先；沒有則第一格；沒有圖退回第一個 chip', () => {
    const withNode = topic({ id: 'x', body: METHOD_BODY, diagram: flow, steps: [{ ...step('s1', 'c1'), node: 'n3' }] })
    expect(defaultSelection(withNode, analyzeTopic(withNode), flow)).toBe('n3')
    expect(defaultSelection(t, analyzeTopic(t), flow)).toBe('n1')
    expect(defaultSelection(t, analyzeTopic(t), null)).toBe('g:prep')
    const a = analyzeTopic(topic({ id: 'e', body: null }))
    expect(defaultSelection(t, a, null)).toBeNull()
  })

  it('orphanSteps／其他步驟卡 chip：node 為 null 或指向不存在的格子', () => {
    const o = topic({ id: 'o', body: METHOD_BODY, diagram: flow, steps: [
      { ...step('s1', 'c1'), node: 'n1' }, step('s2', 'c2'), { ...step('s3', 'c3'), node: 'gone' },
    ] })
    expect(orphanSteps(o, flow).map((s) => s.id)).toEqual(['s2', 's3'])
    expect(orphanSteps(o, null)).toHaveLength(3)
    const a = analyzeTopic(o)
    expect(chipGroups(a.parsed, 2).at(-1)).toEqual({ key: 'steps', label: '其他步驟卡', n: 2 })
    expect(chipGroups(a.parsed).some((g) => g.key === 'steps')).toBe(false)
    expect(isValidSelection('g:steps', a, flow, o)).toBe(true)
    expect(isValidSelection('g:steps', a, flow)).toBe(false)
    const none = topic({ id: 'n', body: METHOD_BODY, diagram: flow, steps: [{ ...step('s1', 'c1'), node: 'n1' }] })
    expect(isValidSelection('g:steps', analyzeTopic(none), flow, none)).toBe(false)
  })

  it('indexScale：縮到放得進高度上限、不放大、低於下限改用下限並橫捲', () => {
    expect(indexScale({ w: 900, h: 400 }, { w: 1200, maxH: 500 })).toMatchObject({ scale: 1, height: 400, clamped: false, hScroll: false })
    const half = indexScale({ w: 1000, h: 600 }, { w: 1200, maxH: 300 })
    expect(half.scale).toBeCloseTo(0.5)
    expect(half.height).toBeCloseTo(300)
    expect(half.width).toBeCloseTo(500)
    const tiny = indexScale({ w: 1000, h: 1000 }, { w: 400, maxH: 100 })
    expect(tiny).toMatchObject({ scale: 0.45, clamped: true, hScroll: true })
    expect(tiny.height).toBeCloseTo(450)
    expect(indexScale({ w: 0, h: 0 }, { w: 100, maxH: 100 }).scale).toBe(1)
  })

  it('isValidSelection', () => {
    const a = analyzeTopic(t)
    expect(isValidSelection('n2', a, flow)).toBe(true)
    expect(isValidSelection('zz', a, flow)).toBe(false)
    expect(isValidSelection('g:decisions', a, flow)).toBe(true)
    expect(isValidSelection('g:why', a, flow)).toBe(false)
  })
})
