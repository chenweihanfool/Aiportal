import { describe, expect, it } from 'vitest'
import {
  forecastTracks, layoutFlow, layoutMap, layoutTimeline, medianDays, quoteQueryFor, rectsOverlap, strengthOf, weakerStrength, taipeiToday,
  type Rect,
} from './knowledgeDiagramLayout'
import type { FlowDiagram, MapDiagram, TimelineDiagram } from './knowledgeView'

const NOW = new Date('2026-11-08T12:00:00+08:00')

const noOverlap = (rects: Rect[]) => {
  for (let i = 0; i < rects.length; i++) for (let j = i + 1; j < rects.length; j++) expect(rectsOverlap(rects[i]!, rects[j]!), `${i} vs ${j}`).toBe(false)
}

const flow: FlowDiagram = {
  type: 'flow', version: 1, lanes: ['甲', '乙', '丙'], phases: ['一', '二', '三', '四'],
  nodes: [
    { id: 'a', label: '送件', src: [1], lane: 0, phase: 0, shape: 'step' },
    { id: 'b', label: '收件', src: [1, 2], lane: 1, phase: 0, shape: 'step' },
    { id: 'c', label: '可補正？', src: [2], lane: 1, phase: 1, shape: 'decision' },
    { id: 'd', label: '補正', src: [3], lane: 2, phase: 2, shape: 'step' },
    { id: 'e', label: '結案', src: [3], lane: 1, phase: 3, shape: 'step' },
    { id: 'f', label: '通知', src: [1], lane: 0, phase: 3, shape: 'step' },
  ],
  edges: [
    { from: 'a', to: 'b' }, { from: 'b', to: 'c' }, { from: 'c', to: 'd', label: '否' }, { from: 'c', to: 'e', label: '是' },
    { from: 'd', to: 'c', back: true, label: '重排' }, { from: 'e', to: 'f' },
  ],
}

describe('layoutFlow', () => {
  const lay = layoutFlow(flow)
  it('節點方框互不相交，且都在畫布內', () => {
    noOverlap(lay.nodes.map((n) => n.rect))
    for (const n of lay.nodes) {
      expect(n.rect.x).toBeGreaterThanOrEqual(0)
      expect(n.rect.y).toBeGreaterThanOrEqual(0)
      expect(n.rect.x + n.rect.w).toBeLessThanOrEqual(lay.width)
      expect(n.rect.y + n.rect.h).toBeLessThanOrEqual(lay.height)
    }
  })
  it('每條邊兩端都存在，數量與輸入相同，back 保留', () => {
    const ids = new Set(lay.nodes.map((n) => n.id))
    expect(lay.edges).toHaveLength(flow.edges.length)
    for (const e of lay.edges) {
      expect(ids.has(e.from)).toBe(true)
      expect(ids.has(e.to)).toBe(true)
      expect(e.d.startsWith('M')).toBe(true)
    }
    expect(lay.edges.filter((e) => e.back)).toHaveLength(1)
  })
  it('泳道與階段數量對得上，座標隨索引遞增', () => {
    expect(lay.lanes).toHaveLength(3)
    expect(lay.phases).toHaveLength(4)
    const a = lay.nodes.find((n) => n.id === 'a')!
    const e = lay.nodes.find((n) => n.id === 'e')!
    expect(e.cx).toBeGreaterThan(a.cx)
    expect(lay.nodes.find((n) => n.id === 'b')!.cy).toBeGreaterThan(a.cy)
  })
})

const timeline: TimelineDiagram = {
  type: 'timeline', version: 1,
  tracks: [{ id: 'v', label: '回診' }, { id: 'm', label: '服藥' }, { id: 'n', label: '新軌' }],
  items: [
    { track: 'v', date: '2026-08-20', label: '回診', src: [1] },
    { track: 'v', date: '2026-09-17', label: '回診', src: [1, 2] },
    { track: 'v', date: '2026-10-15', label: '回診', src: [2] },
    { track: 'v', date: '2026-11-12', label: '預約', src: [2] },
    { track: 'm', date: '2026-09-17', end: '2026-10-15', label: '第一輪', src: [3] },
    { track: 'm', date: '2026-09-18', label: '同天附近', src: [3] },
    { track: 'm', date: '2026-10-15', end: '2026-11-12', label: '第二輪', src: [3], ai: true },
    { track: 'n', date: '2026-10-01', label: '只有一次', src: [1] },
  ],
  metrics: [{ label: '數值', unit: 'mg', points: [{ date: '2026-08-20', value: 9.1, src: [1] }, { date: '2026-10-15', value: 10.2, src: [2] }] }],
}

describe('timeline 推估', () => {
  it('medianDays：奇數取正中間、偶數取中間兩個平均並四捨五入、空陣列 null', () => {
    expect(medianDays([28, 28, 27])).toBe(28)
    expect(medianDays([30, 10, 20])).toBe(20)
    expect(medianDays([10, 20])).toBe(15)
    expect(medianDays([10, 21])).toBe(16)
    expect(medianDays([1, 2, 100, 200])).toBe(51)
    expect(medianDays([])).toBeNull()
  })

  it('每軌依過去事件間隔的中位數推估；今天以後的事件不算過去；少於 2 個過去事件不推估', () => {
    const fc = forecastTracks(timeline, NOW)
    // v：過去 8/20、9/17、10/15，間隔 28、28 → 中位數 28 → 10/15 + 28 = 11/12
    expect(fc.map((f) => f.trackId)).toEqual(['m', 'v']) // 依預計日期排序
    const v = fc.find((f) => f.trackId === 'v')!
    expect(v).toMatchObject({ date: '2026-11-12', intervalDays: 28, basedOn: 3, inDays: 4, overdue: false })
    // m：過去 9/17、9/18、10/15（11/12 以前都在今天之前，10/15 開始的第二輪起點也是過去）→ 間隔 1、27 → 偶數中位 14
    const m = fc.find((f) => f.trackId === 'm')!
    expect(m).toMatchObject({ date: '2026-10-29', intervalDays: 14, basedOn: 3, overdue: true })
    expect(fc.some((f) => f.trackId === 'n')).toBe(false)
  })

  it('奇數個間隔：4 個過去事件 → 3 個間隔取中間那個', () => {
    const d: TimelineDiagram = {
      type: 'timeline', version: 1, tracks: [{ id: 'x', label: 'X' }], metrics: [],
      items: ['2026-01-01', '2026-01-11', '2026-02-10', '2026-02-20'].map((date) => ({ track: 'x', date, label: 'x', src: [1] })),
    }
    // 間隔 10、30、10 → 中位數 10 → 2/20 + 10 = 3/2
    expect(forecastTracks(d, NOW)[0]).toMatchObject({ date: '2026-03-02', intervalDays: 10 })
  })

  it('同一天重複的事件只算一次；今天當天算過去', () => {
    const d: TimelineDiagram = {
      type: 'timeline', version: 1, tracks: [{ id: 'x', label: 'X' }], metrics: [],
      items: ['2026-10-25', '2026-10-25', '2026-11-08'].map((date) => ({ track: 'x', date, label: 'x', src: [1] })),
    }
    expect(forecastTracks(d, NOW)[0]).toMatchObject({ date: '2026-11-22', intervalDays: 14, basedOn: 2 })
  })

  it('taipeiToday 用台北日期（UTC 傍晚已是隔天）', () => {
    expect(taipeiToday(new Date('2026-11-07T17:00:00Z'))).toBe('2026-11-08')
  })
})

describe('layoutTimeline', () => {
  const lay = layoutTimeline(timeline, NOW)
  it('同一軌內事件外框互不相交；推估也畫出來', () => {
    for (const tr of lay.tracks) noOverlap(lay.marks.filter((m) => timeline.tracks[m.trackIndex]!.id === tr.id).map((m) => m.rect))
    expect(lay.marks.filter((m) => m.kind === 'forecast')).toHaveLength(2)
    expect(lay.marks.filter((m) => m.kind === 'item')).toHaveLength(timeline.items.length)
  })
  it('標記落在自己那一軌的垂直範圍內；軌與軌不重疊', () => {
    noOverlap(lay.tracks.map((t) => ({ x: 0, y: t.y, w: lay.width, h: t.h })))
    for (const m of lay.marks) {
      const tr = lay.tracks[m.trackIndex]!
      expect(m.rect.y).toBeGreaterThanOrEqual(tr.y)
      expect(m.rect.y + m.rect.h).toBeLessThanOrEqual(tr.y + tr.h + 1)
    }
  })
  it('今天線在 8/20 之後、預約 11/12 之前；日期越晚 x 越大', () => {
    const first = lay.marks.find((m) => m.key === 'i0')!
    const last = lay.marks.find((m) => m.key === 'i3')!
    expect(lay.todayX).toBeGreaterThan(first.x)
    expect(lay.todayX).toBeLessThan(last.x)
    expect(lay.todayLabel).toBe('今天 11/8')
  })
  it('有 metrics 時多一列折線，點數與輸入相同', () => {
    expect(lay.metrics).toHaveLength(1)
    expect(lay.metrics[0]!.points).toHaveLength(2)
    expect(lay.metrics[0]!.path.startsWith('M')).toBe(true)
    expect(lay.height).toBeGreaterThan(lay.metrics[0]!.y + lay.metrics[0]!.h)
  })
})

const map: MapDiagram = {
  type: 'map', version: 1, core: '核心',
  observations: [1, 2, 3, 4, 5].map((i) => ({ id: `o${i}`, label: `觀察${i}`, src: [1] })),
  frameworks: [{ id: 'f1', label: '框架一', src: [1, 2] }, { id: 'f2', label: '框架二', src: [1], ai: true }],
  judgments: [{ id: 'j1', label: '判斷一', src: [1, 2] }, { id: 'j2', label: '判斷二', src: [2] }, { id: 'j3', label: '判斷三', src: [3] }],
  links: [
    { from: 'o1', to: 'f1' }, { from: 'o2', to: 'f1' }, { from: 'o3', to: 'f2' }, { from: 'o4', to: 'f2' }, { from: 'o5', to: 'f1' },
    { from: 'f1', to: 'j1' }, { from: 'f2', to: 'j2' }, { from: 'f2', to: 'j3' },
  ],
}

describe('layoutMap', () => {
  const lay = layoutMap(map)
  it('三欄節點互不相交', () => {
    noOverlap(lay.nodes.map((n) => n.rect))
    expect(lay.nodes).toHaveLength(10)
  })
  it('連線兩端都存在、方向是左→右，強度取較弱的一端', () => {
    const byId = new Map(lay.nodes.map((n) => [n.id, n]))
    expect(lay.links).toHaveLength(map.links.length)
    for (const l of lay.links) {
      expect(byId.has(l.from) && byId.has(l.to)).toBe(true)
      expect(byId.get(l.to)!.rect.x).toBeGreaterThan(byId.get(l.from)!.rect.x)
    }
    // f2 是 ai → o3→f2、f2→j2 都取 ai；o1→f1 兩端都是（1 份 / 2 份）→ 僅一例
    expect(lay.links.find((l) => l.from === 'o3')!.strength).toBe('ai')
    expect(lay.links.find((l) => l.from === 'f2' && l.to === 'j2')!.strength).toBe('ai')
    expect(lay.links.find((l) => l.from === 'o1')!.strength).toBe('one')
    expect(lay.links.find((l) => l.from === 'f1' && l.to === 'j1')!.strength).toBe('multi')
  })
  it('共同核心帶罩住框架欄', () => {
    for (const n of lay.nodes.filter((x) => x.col === 'f')) {
      expect(n.rect.x).toBeGreaterThan(lay.core.x)
      expect(n.rect.x + n.rect.w).toBeLessThan(lay.core.x + lay.core.w)
    }
    expect(lay.core.label).toBe('核心')
  })
})

describe('證據強度與原文句', () => {
  it('strengthOf：ai 優先；src 不重複數 ≥2 → multi；其餘 one', () => {
    expect(strengthOf({ ai: true, src: [1, 2, 3] })).toBe('ai')
    expect(strengthOf({ src: [1, 2] })).toBe('multi')
    expect(strengthOf({ src: [2, 2] })).toBe('one')
    expect(strengthOf({ src: [3] })).toBe('one')
  })
  it('weakerStrength：ai < one < multi', () => {
    expect(weakerStrength('multi', 'one')).toBe('one')
    expect(weakerStrength('ai', 'multi')).toBe('ai')
    expect(weakerStrength('one', 'ai')).toBe('ai')
  })
  it('quoteQueryFor：取 ref 相符、有文字的摘錄，優先「原文且對到」；沒有回空字串', () => {
    const quotes = [
      { k: 0, ref: 1, text: '弱的一句', fromOriginal: true, weak: true },
      { k: 1, ref: 2, text: null, fromOriginal: true, weak: false },
      { k: 2, ref: 1, text: '  好的一句\n第二行', fromOriginal: true, weak: false },
    ]
    expect(quoteQueryFor(quotes, 1)).toBe('好的一句')
    expect(quoteQueryFor(quotes, 2)).toBe('')
    expect(quoteQueryFor(quotes, 9)).toBe('')
    expect(quoteQueryFor(null, 1)).toBe('')
  })
})
