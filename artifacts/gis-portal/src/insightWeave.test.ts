import { describe, expect, it } from 'vitest'
import { foldVerdicts, parseWeave, verdictOf, weaveIndex } from './insightWeave'

// 全部虛構資料
const lh = (id: string, cluster: string, evidence: string[], extra: Record<string, unknown> = {}) => ({ id, cluster, text: `原則 ${id}`, evidence, confidence: 'high', status: 'proposed', since: '2026-11-01', ...extra })
const RAW = {
  generatedAt: '2026-11-19',
  basis: { insights: 5, lastInsightDate: '2026-11-18' },
  lighthouses: [lh('L-00000001', 'K01', ['a', 'b']), lh('L-00000002', 'K02', ['c', 'zzz']), lh('L-00000003', 'K02', ['zzz', 'yyy'])],
  insufficient: [{ cluster: 'K03', evidence: ['d'], note: '只有 1 則' }],
  bridges: [{ id: 'B-00000001', title: '先講清楚', text: '兩島呼應', ends: [{ cluster: 'K01', evidence: ['a'] }, { cluster: 'K02', evidence: ['c'] }], confidence: 'mid', status: 'proposed', note: '', since: '2026-11-01' }],
  tensions: [
    { id: 'T-00000001', text: '拉扯一', members: ['a', 'c'], clusters: ['K01', 'K02'], confidence: 'low', status: 'confirmed', since: '2026-11-01' },
    { id: 'T-00000002', text: '單島拉扯', members: ['b', 'a'], clusters: ['K01'], confidence: 'low', status: 'proposed', since: '2026-11-01' },
  ],
  kbLinks: [{ id: 'K-00000001', kind: 'apply', topic: '某主題', insights: ['a', 'd'], text: '可用在某處', confidence: 'high', status: 'proposed', since: '2026-11-01' }],
}
const INS = [{ id: 'a', cluster: 'K01' }, { id: 'b', cluster: 'K01' }, { id: 'c', cluster: 'K02' }, { id: 'd', cluster: 'K03' }]

describe('parseWeave', () => {
  it('合格資料完整解析', () => {
    const p = parseWeave(RAW)!
    expect(p.lighthouses).toHaveLength(3)
    expect(p.bridges[0]!.ends).toHaveLength(2)
    expect(p.tensions[0]!.status).toBe('confirmed')
    expect(p.kbLinks[0]!.kind).toBe('apply')
  })
  it('不合格的單項丟掉，其餘保留', () => {
    const p = parseWeave({ ...RAW, lighthouses: [lh('L-1', 'K01', ['a']), { id: 'x' }, null, lh('L-2', 'K01', ['a'], { confidence: 'zzz' }), lh('L-3', 'K01', [])], bridges: [{ id: 'B-1', title: 't', text: 'x', ends: [{ cluster: 'K01' }], confidence: 'low' }] })!
    expect(p.lighthouses.map((l) => l.id)).toEqual(['L-1'])
    expect(p.bridges).toHaveLength(0)
    expect(p.tensions).toHaveLength(2)
  })
  it('整份壞回 null', () => {
    for (const bad of [null, undefined, 'x', 5, [], {}, { lighthouses: 'no' }]) expect(parseWeave(bad)).toBeNull()
  })
})

describe('foldVerdicts', () => {
  it('每項只留最後一筆，undo＝沒判', () => {
    const m = foldVerdicts([
      { id: 1, itemId: 'A', verdict: 'ok' }, { id: 2, itemId: 'B', verdict: 'no' }, { id: 3, itemId: 'A', verdict: 'no' },
      { id: 4, itemId: 'B', verdict: 'undo' }, { id: 5, itemId: 'C', verdict: 'ok' }, { id: 6, itemId: 'C', verdict: 'undo' }, { id: 7, itemId: 'C', verdict: 'ok' },
    ])
    expect([...m.entries()]).toEqual([['A', 'no'], ['C', 'ok']])
  })
  it('verdictOf：人工判定優先，沒有時 confirmed 算已確認', () => {
    const m = foldVerdicts([{ itemId: 'X', verdict: 'no' }])
    expect(verdictOf(m, { id: 'X', status: 'confirmed' })).toBe('no')
    expect(verdictOf(m, { id: 'Y', status: 'confirmed' })).toBe('ok')
    expect(verdictOf(m, { id: 'Z', status: 'proposed' })).toBeNull()
  })
})

describe('weaveIndex', () => {
  const idx = weaveIndex(parseWeave(RAW)!, INS)
  it('依據 id 不在心得清單的不列入；剩下沒依據的項目丟掉', () => {
    expect(idx.cluster('K02').lighthouses).toHaveLength(1)
    expect(idx.cluster('K02').lighthouses[0]!.evidence).toEqual(['c'])
    expect(idx.cluster('K01').lighthouses.map((l) => l.id)).toEqual(['L-00000001'])
    expect(idx.payload.lighthouses.map((l) => l.id)).toEqual(['L-00000001', 'L-00000002'])
  })
  it('依群查燈塔、證據不足、橋、張力、知識庫', () => {
    const k1 = idx.cluster('K01')
    expect(k1.bridges.map((b) => b.id)).toEqual(['B-00000001'])
    expect(k1.tensions.map((t) => t.id)).toEqual(['T-00000001', 'T-00000002'])
    expect(k1.kb).toHaveLength(1)
    expect(idx.cluster('K03').insufficient?.note).toBe('只有 1 則')
    expect(idx.cluster('K03').kb).toHaveLength(1)
    expect(idx.cluster('K09').lighthouses).toEqual([])
    expect(idx.total('K01')).toBe(1 + 1 + 2 + 1)
  })
  it('依心得 id 查它出現在哪些項目', () => {
    const a = idx.insight('a')
    expect(a.lighthouses).toHaveLength(1)
    expect(a.bridges).toHaveLength(1)
    expect(a.tensions).toHaveLength(2)
    expect(a.kb).toHaveLength(1)
    expect(idx.insight('c').lighthouses).toHaveLength(1)
    expect(idx.insight('d').insufficient?.cluster).toBe('K03')
    expect(idx.insight('nope').bridges).toEqual([])
  })
  it('related：橋與跨島張力相連的島', () => {
    expect([...idx.related('K01')].sort()).toEqual(['K01', 'K02'])
    expect([...idx.related('K03')]).toEqual(['K03'])
  })
  it('全空時 hasAny 為 false', () => {
    expect(weaveIndex(parseWeave({ lighthouses: [] })!, INS).hasAny).toBe(false)
  })
})
