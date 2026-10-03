import { describe, it, expect } from 'vitest'
import { galaxyLayout, positionAt, type LayoutNode, type Motion, type Vec3 } from './galaxyLayout'

// 測資：兩個圈子（A、B 各 6 人）各自一起出現在很多事件裡，只有一個事件跨圈；外加一個沒有任何共同事件的人（落單）。
function twoCircles() {
  const nodes: LayoutNode[] = []
  const neighbors = new Map<string, Set<string>>()
  const link = (a: string, b: string) => {
    if (!neighbors.has(a)) neighbors.set(a, new Set())
    if (!neighbors.has(b)) neighbors.set(b, new Set())
    neighbors.get(a)!.add(b); neighbors.get(b)!.add(a)
  }
  const people = [...['A0', 'A1', 'A2', 'A3', 'A4', 'A5'], ...['B0', 'B1', 'B2', 'B3', 'B4', 'B5'], 'L0']
  for (const p of people) nodes.push({ id: `p:${p}`, kind: 'person' })
  let e = 0
  const ev = (...ps: string[]) => {
    const id = `e:${e++}`
    nodes.push({ id, kind: 'event' })
    for (const p of ps) link(`p:${p}`, id)
    return id
  }
  for (const c of ['A', 'B']) {
    for (let i = 0; i < 6; i++) for (let j = i + 1; j < 6; j++) ev(`${c}${i}`, `${c}${j}`)
  }
  ev('A0', 'B0')         // 唯一的跨圈事件
  ev('L0')               // 落單的人自己的事件
  // 物件只經由事件才連到人（間接衛星）
  nodes.push({ id: 'o:x', kind: 'object' })
  link('o:x', 'e:0')
  return { nodes, neighbors }
}

const galaxyOf = (m: Motion | undefined) => (m && m.type === 'disk' ? m.g : null)

describe('galaxyLayout', () => {
  it('falls back (null) when events are the core, or there are too few cores', () => {
    const { nodes, neighbors } = twoCircles()
    expect(galaxyLayout(nodes, neighbors, 'event')).toBeNull()
    expect(galaxyLayout(nodes.filter(n => n.kind !== 'person' || n.id < 'p:A3'), neighbors, 'person')).toBeNull()
  })

  it('puts each circle in its own galaxy, and a person with no shared events outside both', () => {
    const { nodes, neighbors } = twoCircles()
    const lay = galaxyLayout(nodes, neighbors, 'person')
    expect(lay).not.toBeNull()
    const m = lay!.motions
    expect(lay!.galaxies.length).toBe(2)
    const gA = galaxyOf(m.get('p:A1')), gB = galaxyOf(m.get('p:B1'))
    expect(gA).not.toBeNull()
    expect(gB).not.toBeNull()
    expect(gA).not.toBe(gB)
    for (let i = 0; i < 6; i++) {
      expect(galaxyOf(m.get(`p:A${i}`))).toBe(gA)
      expect(galaxyOf(m.get(`p:B${i}`))).toBe(gB)
    }
    expect(m.get('p:L0')?.type).toBe('fixed') // 野星
  })

  it('gives every node a motion; satellites orbit a core, indirect ones further out', () => {
    const { nodes, neighbors } = twoCircles()
    const lay = galaxyLayout(nodes, neighbors, 'person')!
    for (const n of nodes) expect(lay.motions.has(n.id)).toBe(true)
    const ev0 = lay.motions.get('e:0')!
    const obj = lay.motions.get('o:x')!
    expect(ev0.type).toBe('orbit')
    expect(obj.type).toBe('orbit')
    if (ev0.type === 'orbit' && obj.type === 'orbit') {
      expect(ev0.anchor.startsWith('p:')).toBe(true)
      expect(obj.anchor).toBe(ev0.anchor) // 物件跟著它所屬事件的恆星
      expect(obj.r).toBeGreaterThan(ev0.r)
    }
  })

  it('anchors a shared event to the participant who appears in fewer events', () => {
    const { nodes, neighbors } = twoCircles()
    // L0 只有 1 個事件；讓 A0 跟 L0 共同出現一次 → 那個事件歸 L0（關聯較少的一方）
    nodes.push({ id: 'e:shared', kind: 'event' })
    neighbors.set('e:shared', new Set(['p:A0', 'p:L0']))
    neighbors.get('p:A0')!.add('e:shared'); neighbors.get('p:L0')!.add('e:shared')
    const m = galaxyLayout(nodes, neighbors, 'person')!.motions.get('e:shared')!
    expect(m.type === 'orbit' && m.anchor).toBe('p:L0')
  })

  it('is deterministic', () => {
    const a = twoCircles(), b = twoCircles()
    const la = galaxyLayout(a.nodes, a.neighbors, 'person')!, lb = galaxyLayout(b.nodes, b.neighbors, 'person')!
    expect(JSON.stringify([...la.motions])).toBe(JSON.stringify([...lb.motions]))
    expect(la.worldRadius).toBe(lb.worldRadius)
  })

  it('falls back when everyone is in one blob (no galaxy structure)', () => {
    const nodes: LayoutNode[] = []
    const neighbors = new Map<string, Set<string>>()
    const ps = Array.from({ length: 10 }, (_, i) => `p:${i}`)
    for (const p of ps) { nodes.push({ id: p, kind: 'person' }); neighbors.set(p, new Set()) }
    let e = 0
    for (let i = 0; i < 10; i++) for (let j = i + 1; j < 10; j++) {
      const id = `e:${e++}`
      nodes.push({ id, kind: 'event' })
      neighbors.set(id, new Set([ps[i], ps[j]]))
      neighbors.get(ps[i])!.add(id); neighbors.get(ps[j])!.add(id)
    }
    expect(galaxyLayout(nodes, neighbors, 'person')).toBeNull()
  })
})

describe('positionAt', () => {
  it('keeps an orbiting satellite at its orbit radius from the anchor at any time', () => {
    const { nodes, neighbors } = twoCircles()
    const lay = galaxyLayout(nodes, neighbors, 'person')!
    const m = lay.motions.get('e:3')!
    expect(m.type).toBe('orbit')
    if (m.type !== 'orbit') return
    const anchorAt = (t: number): Vec3 => { const o: Vec3 = [0, 0, 0]; positionAt(lay.motions.get(m.anchor)!, t, lay.galaxies, () => undefined, o); return o }
    for (const t of [0, 7.3, 120]) {
      const a = anchorAt(t)
      const o: Vec3 = [0, 0, 0]
      positionAt(m, t, lay.galaxies, () => a, o)
      expect(Math.hypot(o[0] - a[0], o[1] - a[1], o[2] - a[2])).toBeCloseTo(m.r, 6)
    }
  })

  it('moves over time (orbits and galaxy spin) and returns after a full galaxy period', () => {
    const { nodes, neighbors } = twoCircles()
    const lay = galaxyLayout(nodes, neighbors, 'person')!
    const id = [...lay.motions].find(([, mm]) => mm.type === 'disk' && mm.r > 0)![0]
    const m = lay.motions.get(id)!
    if (m.type !== 'disk') return
    const g = lay.galaxies[m.g]
    const at = (t: number): Vec3 => { const o: Vec3 = [0, 0, 0]; positionAt(m, t, lay.galaxies, () => undefined, o); return o }
    const p0 = at(0), p1 = at(10), pPeriod = at((2 * Math.PI) / Math.abs(g.omega))
    expect(Math.hypot(p1[0] - p0[0], p1[1] - p0[1], p1[2] - p0[2])).toBeGreaterThan(0.01)
    expect(pPeriod[0]).toBeCloseTo(p0[0], 4)
    expect(pPeriod[1]).toBeCloseTo(p0[1], 4)
    expect(pPeriod[2]).toBeCloseTo(p0[2], 4)
  })
})
