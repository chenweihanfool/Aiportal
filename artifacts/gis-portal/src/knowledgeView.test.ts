import { describe, expect, it } from 'vitest'
import { filterTopics, groupTopics, isStale, kindLabel, layoutGraph, parseTopics, STALE_MIN, type Topic } from './knowledgeView'

const feed = (payload: unknown, available = true) => ({ available, payload })

function topic(over: Partial<Topic> & { id: string }): Topic {
  return {
    name: `題目 ${over.id}`,
    kind: 'concept',
    why: '',
    firstSeen: '2026-01-01',
    lastSeen: null,
    updated: null,
    revision: 0,
    docs: 3,
    newDocs: 0,
    monthsSpan: 1,
    firstMonth: null,
    lastMonth: null,
    body: null,
    growth: [],
    sources: [],
    related: [],
    ...over,
  }
}

const NOW = new Date('2026-11-05T12:00:00+08:00')

describe('parseTopics', () => {
  it('available=false 或形狀不對回 null', () => {
    expect(parseTopics(feed(null, false))).toBeNull()
    expect(parseTopics(feed({ computedAt: 'x' }))).toBeNull()
    expect(parseTopics(null)).toBeNull()
  })

  it('壞掉的單題略過，好的題目保留', () => {
    const d = parseTopics(feed({
      computedAt: '2026-11-05T10:00:00+08:00',
      total: 3,
      published: 1,
      topics: [
        { id: 'T1', name: '好題', kind: 'method', why: '', firstSeen: '2026-01-02', revision: 1, docs: 5, newDocs: 0, monthsSpan: 2, body: '## x', growth: [], sources: [], related: [] },
        { id: 'T2', name: '壞 kind', kind: 'other', firstSeen: '2026-01-02', revision: 0, docs: 1, newDocs: 0, monthsSpan: 1 },
        { id: '', name: '沒 id', kind: 'concept', firstSeen: '2026-01-02', revision: 0, docs: 1, newDocs: 0, monthsSpan: 1 },
        'not an object',
      ],
    }))!
    expect(d.topics.map((t) => t.id)).toEqual(['T1'])
    expect(d.topics[0]!.kind).toBe('method')
    expect(d.topics[0]!.body).toBe('## x')
    expect(d.total).toBe(3)
  })

  it('選填欄位缺席時給預設值，壞的成長與來源項目被丟掉', () => {
    const d = parseTopics(feed({
      computedAt: '2026-11-05T10:00:00+08:00',
      total: 1,
      published: 0,
      topics: [{
        id: 'T9', name: 'n', kind: 'concept', firstSeen: '2026-03-01', revision: 0, docs: 2, newDocs: 1, monthsSpan: 1,
        growth: [{ date: '2026-11-05', text: 'ok' }, { date: 1 }],
        sources: [{ id: 'a', title: 'A' }, { id: 'b' }],
        related: [{ id: 'T8', name: 'm' }],
      }],
    }))!
    const t = d.topics[0]!
    expect(t.why).toBe('')
    expect(t.updated).toBeNull()
    expect(t.body).toBeNull()
    expect(t.growth).toHaveLength(1)
    expect(t.sources).toEqual([{ id: 'a', title: 'A' }])
    expect(t.related).toEqual([{ id: 'T8', name: 'm', sharedDocs: 0, sharedCases: 0 }])
  })
})

describe('isStale', () => {
  it('超過 STALE_MIN 分鐘才算過期，壞時間也算過期', () => {
    expect(STALE_MIN).toBe(60)
    expect(isStale('2026-11-05T11:00:00+08:00', NOW)).toBe(false)
    expect(isStale('2026-11-05T10:59:00+08:00', NOW)).toBe(true)
    expect(isStale('not a date', NOW)).toBe(true)
  })
})

describe('groupTopics', () => {
  it('本週長大：updated 在 7 天內（剛好 7 天也算）；更早的有頁面的進已有頁面', () => {
    const topics = [
      topic({ id: 'A', updated: '2026-11-05', revision: 2 }),
      topic({ id: 'B', updated: '2026-10-29', revision: 1 }),
      topic({ id: 'C', updated: '2026-10-28', revision: 1 }),
      topic({ id: 'D', updated: null, revision: 0 }),
    ]
    const g = groupTopics(topics, NOW)
    expect(g.recent.map((t) => t.id)).toEqual(['A', 'B'])
    expect(g.page.map((t) => t.id)).toEqual(['C'])
    expect(g.growing.map((t) => t.id)).toEqual(['D'])
  })

  it('組內維持輸入順序', () => {
    const topics = [topic({ id: 'X', revision: 0 }), topic({ id: 'Y', revision: 0 }), topic({ id: 'Z', revision: 0 })]
    expect(groupTopics(topics, NOW).growing.map((t) => t.id)).toEqual(['X', 'Y', 'Z'])
  })

  it('台北日期換日：台北 00:30（UTC 前一天 16:30）仍以台北日期判斷', () => {
    const late = new Date('2026-11-05T00:30:00+08:00')
    const g = groupTopics([topic({ id: 'E', updated: '2026-10-29', revision: 1 })], late)
    expect(g.recent.map((t) => t.id)).toEqual(['E'])
  })
})

describe('filterTopics', () => {
  const topics = [
    topic({ id: 'A', name: 'Ceph 叢集', why: '儲存規劃', kind: 'concept' }),
    topic({ id: 'B', name: '鑑界流程', why: '現場用', kind: 'method' }),
    topic({ id: 'C', name: 'RTK 設定', why: '', kind: 'method' }),
  ]

  it('種類篩選；all 或未給不篩', () => {
    expect(filterTopics(topics, { kind: 'method' }).map((t) => t.id)).toEqual(['B', 'C'])
    expect(filterTopics(topics, { kind: 'all' })).toHaveLength(3)
    expect(filterTopics(topics, {})).toHaveLength(3)
  })

  it('搜尋比對名稱與 why，不分大小寫、忽略前後空白', () => {
    expect(filterTopics(topics, { q: '  rtk ' }).map((t) => t.id)).toEqual(['C'])
    expect(filterTopics(topics, { q: '儲存' }).map((t) => t.id)).toEqual(['A'])
    expect(filterTopics(topics, { q: '不存在' })).toEqual([])
  })

  it('種類與搜尋可以併用', () => {
    expect(filterTopics(topics, { kind: 'concept', q: '現場' })).toEqual([])
  })
})

describe('kindLabel', () => {
  it('concept→概念、method→方法', () => {
    expect(kindLabel('concept')).toBe('概念')
    expect(kindLabel('method')).toBe('方法')
  })
})

describe('layoutGraph', () => {
  const A = topic({ id: 'A', docs: 4, related: [{ id: 'B', name: 'B', sharedDocs: 2, sharedCases: 1 }] })
  const B = topic({ id: 'B', docs: 40, related: [{ id: 'A', name: 'A', sharedDocs: 2, sharedCases: 1 }] })
  const C = topic({ id: 'C', docs: 1, related: [{ id: 'B', name: 'B', sharedDocs: 1, sharedCases: 0 }] })
  const lone = topic({ id: 'Z', docs: 2 })

  it('無向去重：A↔B 兩邊都寫只產生一條邊', () => {
    const g = layoutGraph([A, B, C, lone], 400, 300)
    const ab = g.edges.filter((e) => (e.a === 'A' && e.b === 'B') || (e.a === 'B' && e.b === 'A'))
    expect(ab).toHaveLength(1)
    expect(g.edges).toHaveLength(2)
  })

  it('權重＝sharedDocs＋0.5×sharedCases', () => {
    const g = layoutGraph([A, B, C], 400, 300)
    expect(g.edges.find((e) => e.a === 'A' && e.b === 'B')!.w).toBe(2.5)
    expect(g.edges.find((e) => e.a === 'B' && e.b === 'C')!.w).toBe(1)
  })

  it('節點只含有關係的題目；孤立題目不進圖', () => {
    const g = layoutGraph([A, B, C, lone], 400, 300)
    expect(g.nodes.map((n) => n.id).sort()).toEqual(['A', 'B', 'C'])
    expect(g.nodes.find((n) => n.id === 'B')!.name).toBe('題目 B')
  })

  it('r 依 docs 在 6～18 之間', () => {
    const g = layoutGraph([A, B, C], 400, 300)
    for (const n of g.nodes) {
      expect(n.r).toBeGreaterThanOrEqual(6)
      expect(n.r).toBeLessThanOrEqual(18)
    }
    expect(g.nodes.find((n) => n.id === 'B')!.r).toBe(18)
    expect(g.nodes.find((n) => n.id === 'C')!.r).toBe(6.5)
  })

  it('座標都在畫布內（含半徑）', () => {
    const g = layoutGraph([A, B, C], 400, 300)
    for (const n of g.nodes) {
      expect(n.x - n.r).toBeGreaterThanOrEqual(0)
      expect(n.x + n.r).toBeLessThanOrEqual(400)
      expect(n.y - n.r).toBeGreaterThanOrEqual(0)
      expect(n.y + n.r).toBeLessThanOrEqual(300)
    }
  })

  it('確定性：同輸入同輸出，與輸入順序無關', () => {
    const g1 = layoutGraph([A, B, C], 400, 300)
    const g2 = layoutGraph([C, B, A], 400, 300)
    expect(g1).toEqual(g2)
    expect(layoutGraph([A, B, C], 400, 300)).toEqual(g1)
  })

  it('空資料回空；指到不存在的題目的邊略過', () => {
    expect(layoutGraph([], 400, 300)).toEqual({ nodes: [], edges: [] })
    const dangling = topic({ id: 'D', related: [{ id: 'NOPE', name: 'x', sharedDocs: 3, sharedCases: 0 }] })
    expect(layoutGraph([dangling], 400, 300)).toEqual({ nodes: [], edges: [] })
  })
})
