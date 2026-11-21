import { describe, expect, it } from 'vitest'
import {
  analyzeTopic, bridgesAt, buildIslandModel, buildStations, cardMark, cardRect, computeBridges, fitView, islandSize, islandStats, isSeed, kbLinksFor,
  layoutSea, shelf, shortLabel, stationCoverage, zoomAt, UNASSIGNED_ID, type Box, type Placed,
} from './knowledgeIslands'
import { buildTree, parseBodyWithMarkers, type Topic, type TopicClaim } from './knowledgeView'
import type { TopicStep } from './knowledgeSteps'
import type { KbLink } from './insightWeave'

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
