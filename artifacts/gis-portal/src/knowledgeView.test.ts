import { describe, expect, it } from 'vitest'
import { parseDiagram, bulletId, bulletsCiting, buildTree, checkKey, loadChecks, relatedByKind, saveChecks, caseTimeline, commonTitlePrefix, groupSourcesByCase, highlightRanges, markerOrdinals, parseBodyWithMarkers, stageOf, filterTopics, groupTopics, isStale, kindLabel, layoutTidyTree, monthSeries, parseBody, parseTopics, STALE_MIN, treeToLayoutInput, type Topic, type TreeInput } from './knowledgeView'

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
    diagram: null,
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
    expect(parseBody('')).toEqual({ format: 'legacy', summary: null, what: [], how: [], caution: [], unknown: [], why: [], myths: [], examples: [], prep: [], steps: [], decisions: [], pitfalls: [], other: '' })
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

describe('來源可追溯（2.77.0）', () => {
  const feedWith = (sources: unknown) => parseTopics(feed({
    computedAt: '2026-11-05T10:00:00+08:00',
    topics: [{ id: 'T1', name: 'x', kind: 'concept', firstSeen: '2026-01-02', revision: 1, docs: 1, newDocs: 0, monthsSpan: 1, sources }],
  }))!.topics[0]!.sources

  it('parseTopics：新欄位合法時帶入，不合法當 undefined，舊 payload 照常', () => {
    const [a, b, c] = feedWith([
      { id: 'a', title: 'A', month: '2026-01', type: 'pdf', case: '案甲', date: '2026-01-05' },
      { id: 'b', title: 'B', type: 'docx', case: 5, date: '2026/01/05' },
      { id: 'c', title: 'C', month: '2026-02' },
    ])!
    expect(a).toEqual({ id: 'a', title: 'A', month: '2026-01', type: 'pdf', case: '案甲', date: '2026-01-05' })
    expect(b).toEqual({ id: 'b', title: 'B', month: null })
    expect(c).toEqual({ id: 'c', title: 'C', month: '2026-02' })
  })

  it('commonTitlePrefix', () => {
    expect(commonTitlePrefix(['縣有地租約-契約書', '縣有地租約-付款單'])).toBe('縣有地租約-')
    expect(commonTitlePrefix(['甲乙丙', '甲乙丁'])).toBe('')
    expect(commonTitlePrefix(['完全相同的標題', '完全相同的標題'])).toBe('')
    expect(commonTitlePrefix(['縣有地租約', '縣有地租約書'])).toBe('')
    expect(commonTitlePrefix(['只有一條標題'])).toBe('')
    expect(commonTitlePrefix([])).toBe('')
  })

  it('groupSourcesByCase：依案件、其他放最後、保留原序號', () => {
    const g = groupSourcesByCase([
      { id: '1', title: 'a', month: null },
      { id: '2', title: 'b', month: null, case: '乙案' },
      { id: '3', title: 'c', month: null, case: '甲案' },
      { id: '4', title: 'd', month: null, case: '乙案' },
    ])
    expect(g.map((x) => x.label)).toEqual(['乙案', '甲案', '其他'])
    expect(g[0]!.items.map((i) => i.n)).toEqual([2, 4])
    expect(g[2]!.items.map((i) => i.n)).toEqual([1])
    expect(g[2]!.case).toBeNull()
  })

  it('stageOf：照順序比對', () => {
    expect(stageOf('招標公告')).toBe('招標')
    expect(stageOf('開標紀錄')).toBe('開標')
    expect(stageOf('評審委員名單')).toBe('評選')
    expect(stageOf('議價紀錄')).toBe('決標')
    expect(stageOf('簽約通知')).toBe('簽約')
    expect(stageOf('進度報告')).toBe('履約')
    expect(stageOf('驗收單')).toBe('驗收')
    expect(stageOf('請款單')).toBe('付款')
    expect(stageOf('終止契約通知')).toBe('爭議')
    expect(stageOf('決標公告')).toBe('決標')
    expect(stageOf('評選委員確認優勝廠商表')).toBe('評選')
    expect(stageOf('契約變更')).toBe('簽約')
    expect(stageOf('爭議處理')).toBe('爭議')
    expect(stageOf('隨手筆記')).toBeNull()
  })

  it('markerOrdinals 與 parseBodyWithMarkers 的 k0', () => {
    expect(markerOrdinals('a⟦3⟧b⟦1⟧⟦2⟧c')).toEqual([{ k: 0, ref: 3 }, { k: 1, ref: 1 }, { k: 2, ref: 2 }])
    expect(markerOrdinals('沒有')).toEqual([])
    const p = parseBodyWithMarkers(['## 這件事到底在幹嘛', '- 一句⟦1⟧⟦2⟧', '- 補充⟦3⟧', '## 怎麼做', '- 來源沒有提到⟦4⟧', '- 步驟⟦5⟧'].join('\n'))
    expect(p.summary!.k0).toBe(0)
    expect(p.what[0]!.k0).toBe(2)
    expect(p.how[0]!.k0).toBe(4)
    expect(p.how[0]!.refs).toEqual([5])
  })

  it('bulletsCiting', () => {
    const p = parseBodyWithMarkers(['## 這件事到底在幹嘛', '- 一句⟦1⟧', '- 補充⟦1⟧⟦2⟧', '## 怎麼做', '- 步驟⟦2⟧', '- 另一步⟦1⟧'].join('\n'))
    expect(bulletsCiting(p, 1)).toEqual([bulletId('summary'), 'what:0', 'how:1'])
    expect(bulletsCiting(p, 2)).toEqual(['what:0', 'how:0'])
    expect(bulletsCiting(p, 9)).toEqual([])
  })

  it('caseTimeline：組內舊到新、無日期排組尾', () => {
    const t = caseTimeline([
      { id: '1', title: '驗收單', month: null, case: '甲', date: '2026-03-01' },
      { id: '2', title: '無日期', month: null, case: '甲' },
      { id: '3', title: '招標公告', month: null, case: '甲', date: '2026-01-01' },
      { id: '4', title: '別案', month: null },
    ])
    expect(t[0]!.items.map((i) => i.n)).toEqual([3, 1, 2])
    expect(t[0]!.items.map((i) => i.stage)).toEqual(['招標', '驗收', null])
    expect(t[1]!.label).toBe('其他')
  })

  it('highlightRanges：不分大小寫、特殊字元當字面', () => {
    expect(highlightRanges('Abc abC', 'abc')).toEqual([[0, 3], [4, 7]])
    expect(highlightRanges('a.b axb', 'a.b')).toEqual([[0, 3]])
    expect(highlightRanges('abc', '  ')).toEqual([])
    expect(highlightRanges('abc', 'z')).toEqual([])
  })
})

describe('parseBody 新格式（概念／方法）', () => {
  const concept = [
    '## 一句話',
    '- 界址點是界線的轉折位置 ⟦1⟧',
    '',
    '## 為什麼存在',
    '- 沒有它界線無法落地 ⟦2⟧',
    '',
    '## 常見誤解',
    '- 以為：界址點就是界標 → 其實：界標只是標示物 ⟦3⟧',
    '- 以為: 越新越準 -> 其實: 要看測量方法（僅一例） ⟦4⟧',
    '- 這條沒有箭頭 ⟦5⟧',
    '- 來源沒有提到',
    '',
    '## 實例',
    '- 某案例 ⟦6⟧',
    '',
    '## 還不知道',
    '- 適用範圍 ⟦7⟧',
  ].join('\n')
  const method = [
    '## 一句話',
    '- 用 RTK 量測 ⟦1⟧',
    '## 開工前準備',
    '- 電池充飽 ⟦2⟧',
    '- 來源沒有提到',
    '## 步驟',
    '1. 架設基站 ⟦3⟧',
    '2. 開機 ⟦4⟧',
    '## 判斷點',
    '- 如果：沒有固定解 ⇒ 就：換位置 ⟦5⟧',
    '- 不是這個格式 ⟦6⟧',
    '## 踩過的坑',
    '- 電量不足：多帶一顆電池 ⟦7⟧',
    '- 沒有冒號的坑',
    '## 還不知道',
    '- 其他 ⟦8⟧',
  ].join('\n')

  it('概念範例：format 與各節條目數、不落到 other', () => {
    const p = parseBodyWithMarkers(concept)
    expect(p.format).toBe('concept')
    expect(p.summary?.text).toBe('界址點是界線的轉折位置')
    expect(p.why).toHaveLength(1)
    expect(p.myths).toHaveLength(3)
    expect(p.examples).toHaveLength(1)
    expect(p.unknown).toHaveLength(1)
    expect(p.steps).toHaveLength(0)
    expect(p.other).toBe('')
  })

  it('myth 拆欄（全形／半形冒號、各種箭頭）與拆不開', () => {
    const { myths } = parseBody(concept)
    expect(myths[0]).toMatchObject({ myth: '界址點就是界標', truth: '界標只是標示物', refs: [3] })
    expect(myths[1]).toMatchObject({ myth: '越新越準', truth: '要看測量方法', single: true })
    expect(myths[2]!.myth).toBeUndefined()
    expect(myths[2]!.truth).toBeUndefined()
    expect(myths[2]!.text).toBe('這條沒有箭頭')
  })

  it('方法範例：format、各節條目數、來源沒有提到略過、不落到 other', () => {
    const p = parseBody(method)
    expect(p.format).toBe('method')
    expect(p.summary?.text).toBe('用 RTK 量測')
    expect(p.prep.map((b) => b.text)).toEqual(['電池充飽'])
    expect(p.steps).toHaveLength(2)
    expect(p.decisions).toHaveLength(2)
    expect(p.pitfalls).toHaveLength(2)
    expect(p.unknown).toHaveLength(1)
    expect(p.other).toBe('')
  })

  it('decision／pitfall 拆欄與拆不開', () => {
    const p = parseBody(method)
    expect(p.decisions[0]).toMatchObject({ when: '沒有固定解', then: '換位置' })
    expect(p.decisions[1]!.when).toBeUndefined()
    expect(p.pitfalls[0]).toMatchObject({ trap: '電量不足', avoid: '多帶一顆電池' })
    expect(p.pitfalls[1]!.trap).toBeUndefined()
    expect(p.pitfalls[1]!.text).toBe('沒有冒號的坑')
  })

  it('bulletsCiting 找得到新格式各節條目', () => {
    const c = parseBodyWithMarkers(concept)
    expect(bulletsCiting(c, 1)).toEqual(['summary'])
    expect(bulletsCiting(c, 2)).toEqual([bulletId('why', 0)])
    expect(bulletsCiting(c, 3)).toEqual([bulletId('myths', 0)])
    expect(bulletsCiting(c, 6)).toEqual([bulletId('examples', 0)])
    const m = parseBodyWithMarkers(method)
    expect(bulletsCiting(m, 2)).toEqual([bulletId('prep', 0)])
    expect(bulletsCiting(m, 4)).toEqual([bulletId('steps', 1)])
    expect(bulletsCiting(m, 5)).toEqual([bulletId('decisions', 0)])
    expect(bulletsCiting(m, 7)).toEqual([bulletId('pitfalls', 0)])
  })

  it('legacy 範例 format=legacy', () => {
    const p = parseBody('## 這件事到底在幹嘛\n- 甲 ⟦1⟧\n- 乙\n## 怎麼做\n1. 做\n## 要注意\n- 慎')
    expect(p.format).toBe('legacy')
    expect(p.summary?.text).toBe('甲')
    expect(p.what).toHaveLength(1)
    expect(p.how).toHaveLength(1)
    expect(p.caution).toHaveLength(1)
    expect(p.myths).toEqual([])
  })
})

describe('relatedByKind', () => {
  const a = topic({ id: 'a', kind: 'concept' })
  const b = topic({ id: 'b', kind: 'method' })
  const c = topic({ id: 'c', kind: 'concept' })
  const rel = (id: string) => ({ id, name: id, sharedDocs: 1, sharedCases: 0 })
  it('依 kind 分組、略過不存在與自己、保留順序', () => {
    const t = topic({ id: 't', kind: 'concept', related: [rel('b'), rel('zzz'), rel('a'), rel('t'), rel('c'), rel('b')] })
    const r = relatedByKind(t, [a, b, c, t])
    expect(r.methods.map((x) => x.id)).toEqual(['b'])
    expect(r.concepts.map((x) => x.id)).toEqual(['a', 'c'])
  })
  it('沒有 related 回兩個空陣列', () => {
    expect(relatedByKind(topic({ id: 't' }), [a])).toEqual({ concepts: [], methods: [] })
  })
})

describe('勾選狀態讀寫', () => {
  const mem = () => {
    const m = new Map<string, string>()
    return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v) }
  }
  it('鍵格式', () => {
    expect(checkKey('t1', 3)).toBe('kn-check:t1:3')
  })
  it('存了再讀得回來', () => {
    const s = mem()
    expect(saveChecks(s, 'k', new Set(['steps:0', 'prep:1']))).toBe(true)
    expect([...loadChecks(s, 'k')].sort()).toEqual(['prep:1', 'steps:0'])
  })
  it('沒有值、壞 JSON、非陣列、混雜型別', () => {
    const s = mem()
    expect(loadChecks(s, 'k').size).toBe(0)
    s.setItem('k', '{壞')
    expect(loadChecks(s, 'k').size).toBe(0)
    s.setItem('k', '{"a":1}')
    expect(loadChecks(s, 'k').size).toBe(0)
    s.setItem('k', '["a", 1, null, "b"]')
    expect([...loadChecks(s, 'k')]).toEqual(['a', 'b'])
  })
  it('store 丟例外或沒有 store 都回空集合、寫入回 false', () => {
    const bad = { getItem: () => { throw new Error('denied') }, setItem: () => { throw new Error('quota') } }
    expect(loadChecks(bad, 'k').size).toBe(0)
    expect(saveChecks(bad, 'k', new Set(['a']))).toBe(false)
    expect(loadChecks(null, 'k').size).toBe(0)
    expect(saveChecks(undefined, 'k', new Set())).toBe(false)
  })
})

// ───────── 圖解 diagram（2.81.0） ─────────

const baseTopic = { id: 'T1', name: '題目', kind: 'method', firstSeen: '2026-01-01', revision: 1, docs: 3, newDocs: 0, monthsSpan: 1, sources: [{ id: 's1', title: '甲' }, { id: 's2', title: '乙' }, { id: 's3', title: '丙' }] }

const flowOk = () => ({
  type: 'flow', version: 1, lanes: ['甲方', '乙方'], phases: ['收件', '處理', '結案'],
  nodes: [
    { id: 'a', label: '送件', src: [1], lane: 0, phase: 0, shape: 'step' },
    { id: 'b', label: '能補正？', src: [1, 2], lane: 1, phase: 1, shape: 'decision', pitfall: true },
    { id: 'c', label: '結案', src: [3], lane: 1, phase: 2, shape: 'step', unknown: true, note: '說明', sub: '副標' },
  ],
  edges: [{ from: 'a', to: 'b' }, { from: 'b', to: 'c', label: '是' }, { from: 'c', to: 'a', back: true }],
})
const timelineOk = () => ({
  type: 'timeline', version: 1, tracks: [{ id: 't1', label: '回診' }],
  items: [{ track: 't1', date: '2026-08-01', label: '回診', src: [1] }, { track: 't1', date: '2026-09-01', end: '2026-09-03', label: '回診', src: [1, 2], ai: true }],
  metrics: [{ label: '數值', unit: 'mg', points: [{ date: '2026-08-01', value: 9.1, src: [1] }, { date: '2026-09-01', value: 9.6, src: [2] }] }],
})
const mapOk = () => ({
  type: 'map', version: 1, core: '共同核心',
  observations: [{ id: 'o1', label: '觀察甲', src: [1] }, { id: 'o2', label: '觀察乙', src: [2, 3] }],
  frameworks: [{ id: 'f1', label: '框架甲', src: [1, 2], unknown: true }],
  judgments: [{ id: 'j1', label: '判斷甲', src: [3], ai: true }],
  links: [{ from: 'o1', to: 'f1' }, { from: 'o2', to: 'f1' }, { from: 'f1', to: 'j1' }],
})
const withDiagram = (diagram: unknown) => parseTopics(feed({ computedAt: '2026-11-05T21:30:00+08:00', topics: [{ ...baseTopic, diagram }, { ...baseTopic, id: 'T2' }] }))!

describe('parseDiagram（feed 每題的選用欄位 diagram）', () => {
  it('舊資料沒有 diagram 欄位 → null，其餘欄位照常', () => {
    const d = withDiagram(undefined)
    expect(d.topics[0]!.diagram).toBeNull()
    expect(d.topics[1]!.diagram).toBeNull()
    expect(d.topics).toHaveLength(2)
  })

  it('三種合法 diagram 都解析成功', () => {
    expect(withDiagram(flowOk()).topics[0]!.diagram).toMatchObject({ type: 'flow', lanes: ['甲方', '乙方'] })
    const f = withDiagram(flowOk()).topics[0]!.diagram
    expect(f && f.type === 'flow' && f.nodes[2]).toMatchObject({ unknown: true, note: '說明', sub: '副標' })
    expect(f && f.type === 'flow' && f.edges[2]).toMatchObject({ back: true })
    const t = withDiagram(timelineOk()).topics[0]!.diagram
    expect(t).toMatchObject({ type: 'timeline', tracks: [{ id: 't1' }] })
    expect(t && t.type === 'timeline' && t.items[1]).toMatchObject({ end: '2026-09-03', ai: true, src: [1, 2] })
    expect(t && t.type === 'timeline' && t.metrics[0]!.points).toHaveLength(2)
    expect(withDiagram(mapOk()).topics[0]!.diagram).toMatchObject({ type: 'map', core: '共同核心' })
  })

  it('不合法 → 該題 diagram 為 null，其餘欄位與整份資料照常', () => {
    const bad = (mutate: (d: Record<string, any>) => void, make: () => Record<string, any> = flowOk) => {
      const d = make()
      mutate(d)
      const out = withDiagram(d)
      expect(out.topics).toHaveLength(2)
      expect(out.topics[0]!.name).toBe('題目')
      expect(out.topics[0]!.diagram).toBeNull()
    }
    bad((d) => { d.nodes[0].src = [4] }) // src 超出 sources 範圍
    bad((d) => { d.nodes[0].src = [] }) // src 為空
    bad((d) => { d.nodes[0].id = 'Bad-Id' }) // id 格式
    bad((d) => { d.nodes[1].id = 'a' }) // id 重複
    bad((d) => { d.nodes[0].label = '' }) // label 太短
    bad((d) => { d.nodes[0].label = '一二三四五六七八九十一二三四五' }) // label 15 字
    bad((d) => { d.edges[0].to = 'zz' }) // edge 指向不存在的 id
    bad((d) => { d.edges[0] = { from: 'b', to: 'a' } }) // 非 back 邊往回走
    bad((d) => { d.nodes[0].lane = 2 }) // lane 超出
    bad((d) => { d.nodes[0].phase = 3 }) // phase 超出
    bad((d) => { d.nodes[1].lane = 0; d.nodes[1].phase = 0 }) // 同一格兩個節點
    bad((d) => { d.nodes[0].shape = 'circle' }) // shape 不認得
    bad((d) => { d.lanes = ['只有一個'] }) // lanes 太少
    bad((d) => { d.nodes.pop() }) // nodes 少於 3
    bad((d) => { d.type = 'chart' }) // type 不認得
    bad((d) => { d.version = 2 }) // version 不對
    bad((d) => { d.items[0].track = 'nope' }, timelineOk) // track 不存在
    bad((d) => { d.items[0].date = '2026-13-40' }, timelineOk) // 日期不存在
    bad((d) => { d.items[1].end = '2026-08-01' }, timelineOk) // end 早於 date
    bad((d) => { d.metrics[0].points.pop() }, timelineOk) // points 少於 2
    bad((d) => { d.metrics[0].points[0].value = 'x' }, timelineOk) // value 不是數字
    bad((d) => { d.links.push({ from: 'o1', to: 'j1' }) }, mapOk) // link 方向不允許
    bad((d) => { d.links[0].to = 'zz' }, mapOk) // link 指向不存在
    bad((d) => { d.observations = [] }, mapOk) // 觀察至少 1 個
    bad((d) => { d.core = '一二三四五六七八九十一二三四五六七八九十一二三四五' }, mapOk) // core 25 字
    bad((d) => { d.judgments[0].id = 'o1' }, mapOk) // 跨欄 id 重複
  })

  it('src 接受單一整數，並包成陣列；null／非物件回 null', () => {
    const t = timelineOk()
    ;(t.items[0] as { src: unknown }).src = 2
    const out = parseDiagram(t, 3)
    expect(out && out.type === 'timeline' && out.items[0]!.src).toEqual([2])
    expect(parseDiagram(null, 3)).toBeNull()
    expect(parseDiagram('flow', 3)).toBeNull()
  })

  it('沒有 metrics 欄位也合法（視為 0 個）', () => {
    const t = timelineOk() as Record<string, unknown>
    delete t.metrics
    const out = parseDiagram(t, 3)
    expect(out && out.type === 'timeline' && out.metrics).toEqual([])
  })
})
