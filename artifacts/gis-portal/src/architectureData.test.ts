import { describe, expect, it } from 'vitest'
import { BANDS, EDGES, NODES, nodeById, neighbors, nodesInBand, relationTo } from './architectureData'

describe('架構拓撲資料', () => {
  it('節點 id 不重複，且每個節點都屬於已宣告的分層', () => {
    expect(new Set(NODES.map((n) => n.id)).size).toBe(NODES.length)
    const bands = new Set(BANDS.map((b) => b.id))
    for (const n of NODES) expect(bands.has(n.band), n.id).toBe(true)
  })
  it('每個分層至少有一個節點', () => {
    for (const b of BANDS) expect(nodesInBand(b.id).length, b.id).toBeGreaterThan(0)
  })
  it('連線的兩端都存在，沒有自己連自己，也沒有重複連線', () => {
    const seen = new Set<string>()
    for (const e of EDGES) {
      expect(nodeById(e.from), e.from).toBeDefined()
      expect(nodeById(e.to), e.to).toBeDefined()
      expect(e.from).not.toBe(e.to)
      const k = `${e.from}>${e.to}`
      expect(seen.has(k), k).toBe(false)
      seen.add(k)
    }
  })
  it('每個節點至少有一條連線（沒有孤立節點）', () => {
    for (const n of NODES) {
      const { up, down } = neighbors(n.id)
      expect(up.length + down.length, n.id).toBeGreaterThan(0)
    }
  })
  it('L1～L5 都有對應節點，且 layer 欄位與 id 一致', () => {
    for (const k of ['L1', 'L2', 'L3', 'L4', 'L5'] as const) expect(nodeById(k)?.layer).toBe(k)
  })
  it('試驗中的節點不連到入口網（目前沒有任何下游）', () => {
    for (const n of NODES.filter((x) => x.role === 'experimental')) {
      const down = neighbors(n.id).down.map((d) => d.id)
      expect(down.includes('portal') || down.includes('pushers'), n.id).toBe(false)
    }
  })
  it('只有 L3 與 L5 與確定性萃取器會寫進 vault（權威來源的寫入者清楚）', () => {
    expect(neighbors('vault').up.map((n) => n.id).sort()).toEqual(['L3', 'L5', 'sidecar'])
  })
})

describe('neighbors／relationTo', () => {
  it('L2 的上游是 L1、L4、任務系統，下游是 L3', () => {
    const { up, down } = neighbors('L2')
    expect(up.map((n) => n.id).sort()).toEqual(['L1', 'L4', 'tasks'])
    expect(down.map((n) => n.id)).toEqual(['L3'])
  })
  it('vault ↔ L5 雙向時，同一個節點可以同時是上游與下游', () => {
    const { up, down } = neighbors('L5')
    expect(up.map((n) => n.id)).toContain('vault')
    expect(down.map((n) => n.id)).toContain('vault')
  })
  it('relationTo：沒選＝idle；選了之後分成 self／up／down／none', () => {
    expect(relationTo(null, 'L1')).toBe('idle')
    expect(relationTo('L2', 'L2')).toBe('self')
    expect(relationTo('L2', 'L1')).toBe('up')
    expect(relationTo('L2', 'L3')).toBe('down')
    expect(relationTo('L2', 'neo4j')).toBe('none')
  })
})
