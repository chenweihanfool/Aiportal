import { describe, expect, it } from 'vitest'
import { buildTree, filterTopics, groupTopics, isStale, kindLabel, layoutTidyTree, monthSeries, parseBody, parseTopics, STALE_MIN, treeToLayoutInput, type Topic, type TreeInput } from './knowledgeView'

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
    branch: null,
    path: [],
    monthCounts: [],
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
    expect(t.sources).toEqual([{ id: 'a', title: 'A', month: null }])
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


describe('parseTopics 新欄位', () => {
  const base = { id: 'T1', name: 'n', kind: 'concept', firstSeen: '2026-03-01', revision: 1, docs: 2, newDocs: 0, monthsSpan: 1 }
  const wrap = (topics: unknown[], tree?: unknown) => feed({ computedAt: '2026-11-06T10:00:00+08:00', total: topics.length, published: 0, topics, ...(tree === undefined ? {} : { tree }) })

  it('缺欄位時給預設：tree null、branch null、path []、monthCounts []、sources.month null', () => {
    const d = parseTopics(wrap([{ ...base, sources: [{ id: 'a', title: 'A' }] }]))!
    expect(d.tree).toBeNull()
    const t = d.topics[0]!
    expect(t.branch).toBeNull()
    expect(t.path).toEqual([])
    expect(t.monthCounts).toEqual([])
    expect(t.sources[0]!.month).toBeNull()
  })

  it('解析 tree、branch、path（最多 2 筆）、monthCounts、sources.month', () => {
    const d = parseTopics(wrap(
      [{ ...base, branch: 'B1', path: ['領域', '枝', '多的'], monthCounts: [{ month: '2026-01', count: 2 }, { month: 'bad', count: 1 }, { month: '2026-02', count: -1 }], sources: [{ id: 'a', title: 'A', month: '2026-02' }, { id: 'b', title: 'B', month: '二月' }] }],
      { domains: [{ id: 'D1', name: '領域', branches: [{ id: 'B1', name: '枝', topics: ['T1', 5] }, { id: 'x' }] }, { name: 'no id' }] },
    ))!
    const t = d.topics[0]!
    expect(t.branch).toBe('B1')
    expect(t.path).toEqual(['領域', '枝'])
    expect(t.monthCounts).toEqual([{ month: '2026-01', count: 2 }])
    expect(t.sources.map((s) => s.month)).toEqual(['2026-02', null])
    expect(d.tree).toEqual({ domains: [{ id: 'D1', name: '領域', branches: [{ id: 'B1', name: '枝', topics: ['T1'] }] }] })
  })

  it('tree 形狀不對時為 null', () => {
    expect(parseTopics(wrap([base], 'x'))!.tree).toBeNull()
    expect(parseTopics(wrap([base], { domains: 'x' }))!.tree).toBeNull()
  })
})

describe('buildTree', () => {
  const A = topic({ id: 'A' })
  const B = topic({ id: 'B' })
  const C = topic({ id: 'C' })
  const tree = { domains: [{ id: 'D1', name: '工作', branches: [{ id: 'B1', name: '測量', topics: ['A', 'GHOST'] }, { id: 'B2', name: '空枝', topics: [] }] }, { id: 'D2', name: '生活', branches: [{ id: 'B3', name: '健身', topics: ['B'] }] }] }

  it('count＝底下題數；指到不存在的題目略過', () => {
    const t = buildTree({ topics: [A, B, C], tree })
    expect(t.domains.map((d) => [d.id, d.count])).toEqual([['D1', 1], ['D2', 1]])
    expect(t.domains[0]!.branches.map((b) => [b.id, b.count])).toEqual([['B1', 1], ['B2', 0]])
    expect(t.domains[0]!.branches[0]!.topics.map((x) => x.id)).toEqual(['A'])
  })

  it('沒在樹裡的題目進 unassigned（維持原順序）', () => {
    expect(buildTree({ topics: [C, A, B], tree }).unassigned.map((x) => x.id)).toEqual(['C'])
  })

  it('tree 為 null 時全部進 unassigned', () => {
    const t = buildTree({ topics: [A, B], tree: null })
    expect(t.domains).toEqual([])
    expect(t.unassigned.map((x) => x.id)).toEqual(['A', 'B'])
  })

  it('同一題出現在兩處只算第一次', () => {
    const t = buildTree({ topics: [A], tree: { domains: [{ id: 'D', name: 'd', branches: [{ id: 'B1', name: 'b', topics: ['A'] }, { id: 'B2', name: 'b2', topics: ['A'] }] }] } })
    expect(t.domains[0]!.count).toBe(1)
    expect(t.domains[0]!.branches[1]!.topics).toEqual([])
  })
})

describe('parseBody', () => {
  const body = [
    '## 這件事到底在幹嘛',
    '- 用 RTK 量測界址點 ⟦1⟧⟦2⟧',
    '- 補充說明一 ⟦3⟧',
    '- 來源沒有提到適用範圍',
    '',
    '## 怎麼做',
    '1. 架設基站 ⟦1⟧',
    '2. 開機等固定解（僅一例） ⟦2⟧',
    '   續行文字',
    '',
    '## 要注意',
    '- 訊號遮蔽時不可用 ⟦4⟧',
    '',
    '## 還不知道',
    '- 不同廠牌差異 ⟦5⟧',
    '',
    '## 其他怪標題',
    '雜項內容',
  ].join('\n')

  it('summary＝第一條；其餘進 what；來源沒有提到的略過', () => {
    const p = parseBody(body)
    expect(p.summary).toEqual({ text: '用 RTK 量測界址點', refs: [1, 2], single: false })
    expect(p.what).toEqual([{ text: '補充說明一', refs: [3], single: false }])
  })

  it('怎麼做：refs、單例標記與續行', () => {
    const p = parseBody(body)
    expect(p.how).toHaveLength(2)
    expect(p.how[0]).toEqual({ text: '架設基站', refs: [1], single: false })
    expect(p.how[1]).toEqual({ text: '開機等固定解 續行文字', refs: [2], single: true })
  })

  it('要注意、還不知道各自歸位', () => {
    const p = parseBody(body)
    expect(p.caution.map((b) => b.text)).toEqual(['訊號遮蔽時不可用'])
    expect(p.unknown.map((b) => b.text)).toEqual(['不同廠牌差異'])
    expect(p.unknown[0]!.refs).toEqual([5])
  })

  it('認不出的段落原文放 other', () => {
    expect(parseBody(body).other).toBe('## 其他怪標題\n雜項內容')
  })

  it('空字串或沒有標題的文字', () => {
    expect(parseBody('')).toEqual({ summary: null, what: [], how: [], caution: [], unknown: [], other: '' })
    expect(parseBody('只有一段話').other).toBe('只有一段話')
  })

  it('多餘空白被收乾淨', () => {
    expect(parseBody('## 這件事到底在幹嘛\n- A   ⟦1⟧  B').summary!.text).toBe('A B')
  })
})

describe('layoutTidyTree', () => {
  const tree: TreeInput = {
    id: 'R', label: '根', kind: 'root',
    children: [
      { id: 'D1', label: '領域', kind: 'domain', children: [
        { id: 'B1', label: '枝', kind: 'branch', children: [
          { id: 'T1', label: '一', kind: 'topic', docs: 0 },
          { id: 'T2', label: '二', kind: 'topic', docs: 100 },
        ] },
      ] },
      { id: 'T3', label: '三', kind: 'topic', docs: 8 },
    ],
  }
  const at = (l: ReturnType<typeof layoutTidyTree>, id: string) => l.nodes.find((n) => n.id === id)!

  it('根在左、葉在右：x 依深度遞增', () => {
    const l = layoutTidyTree(tree)
    expect(at(l, 'R').x).toBeLessThan(at(l, 'D1').x)
    expect(at(l, 'D1').x).toBeLessThan(at(l, 'B1').x)
    expect(at(l, 'B1').x).toBeLessThan(at(l, 'T1').x)
    expect(at(l, 'R').depth).toBe(0)
    expect(at(l, 'T1').depth).toBe(3)
  })

  it('葉節點依序等距，父節點 y＝子節點 y 平均', () => {
    const l = layoutTidyTree(tree, { dy: 30, pad: 10 })
    expect(at(l, 'T1').y).toBe(10)
    expect(at(l, 'T2').y).toBe(40)
    expect(at(l, 'T3').y).toBe(70)
    expect(at(l, 'B1').y).toBe(25)
    expect(at(l, 'D1').y).toBe(25)
    expect(at(l, 'R').y).toBe((25 + 70) / 2)
  })

  it('邊：每個非根節點一條，from 是父', () => {
    const l = layoutTidyTree(tree)
    expect(l.edges).toHaveLength(l.nodes.length - 1)
    expect(l.edges).toContainEqual({ from: 'B1', to: 'T2' })
  })

  it('題目的 r 依 docs 在 5～14 之間', () => {
    const l = layoutTidyTree(tree)
    expect(at(l, 'T1').r).toBe(5)
    expect(at(l, 'T2').r).toBe(14)
    expect(at(l, 'T3').r).toBe(9)
  })

  it('收合：collapsed 節點的子孫不出現，本身變成葉', () => {
    const l = layoutTidyTree(tree, { collapsed: new Set(['D1']), dy: 30, pad: 10 })
    expect(l.nodes.map((n) => n.id)).toEqual(['R', 'D1', 'T3'])
    expect(at(l, 'D1').y).toBe(10)
    expect(at(l, 'T3').y).toBe(40)
  })

  it('確定性：同輸入同輸出；kind 與 label 帶出', () => {
    expect(layoutTidyTree(tree)).toEqual(layoutTidyTree(tree))
    expect(at(layoutTidyTree(tree), 'B1')).toMatchObject({ kind: 'branch', label: '枝' })
  })

  it('只有根時不報錯', () => {
    const l = layoutTidyTree({ id: 'R', label: 'r', kind: 'root' })
    expect(l.nodes).toHaveLength(1)
    expect(l.edges).toEqual([])
  })
})

describe('treeToLayoutInput', () => {
  it('未歸類題目掛在「未歸類」領域下；沒有未歸類時不出現', () => {
    const A = topic({ id: 'A', docs: 2 })
    const withU = treeToLayoutInput(buildTree({ topics: [A], tree: null }))
    expect(withU.children![0]).toMatchObject({ id: '__unassigned', label: '未歸類' })
    expect(withU.children![0]!.children![0]).toMatchObject({ id: 'A', kind: 'topic', docs: 2 })
    const none = treeToLayoutInput(buildTree({ topics: [], tree: null }))
    expect(none.children).toEqual([])
  })
})

describe('monthSeries', () => {
  it('補齊首尾之間缺的月份，跨年也對', () => {
    expect(monthSeries([{ month: '2025-11', count: 2 }, { month: '2026-02', count: 1 }])).toEqual([
      { month: '2025-11', count: 2 }, { month: '2025-12', count: 0 }, { month: '2026-01', count: 0 }, { month: '2026-02', count: 1 },
    ])
  })

  it('亂序輸入排好、同月份加總；空輸入回空', () => {
    expect(monthSeries([{ month: '2026-03', count: 1 }, { month: '2026-02', count: 4 }, { month: '2026-03', count: 2 }])).toEqual([
      { month: '2026-02', count: 4 }, { month: '2026-03', count: 3 },
    ])
    expect(monthSeries([])).toEqual([])
  })
})

describe('parseBody 條目符號', () => {
  it('接受 * 與 + 開頭，標題層級不限', () => {
    const p = parseBody('### 怎麼做\n* 一\n+ 二')
    expect(p.how.map((b) => b.text)).toEqual(['一', '二'])
  })

  it('沒有任何 ⟦n⟧ 時 refs 為空', () => {
    expect(parseBody('## 要注意\n- 小心').caution[0]).toEqual({ text: '小心', refs: [], single: false })
  })
})

describe('parseBody 腳註清理', () => {
  it('多來源以頓號分隔時，拿掉腳註後不留孤立標點', () => {
    const r = parseBody('## 怎麼做\n- 先低溫提香 ⟦1⟧、⟦2⟧\n- 再焙火 ⟦1⟧，⟦3⟧。')
    expect(r.how.map((b) => b.text)).toEqual(['先低溫提香', '再焙火。'])
    expect(r.how[0].refs).toEqual([1, 2])
  })
  it('句號前不留空白', () => {
    const r = parseBody('## 怎麼做\n- A ⟦1⟧，B ⟦2⟧。\n- 先量 ⟦1⟧。')
    expect(r.how.map((b) => b.text)).toEqual(['A，B。', '先量。'])
  })
  it('一般句中的頓號保留', () => {
    const r = parseBody('## 怎麼做\n- 先看閘門、再量流量 ⟦1⟧')
    expect(r.how[0].text).toBe('先看閘門、再量流量')
  })
})
