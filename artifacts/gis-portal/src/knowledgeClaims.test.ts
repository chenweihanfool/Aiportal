import { describe, expect, it } from 'vitest'
import { bulletId, checkIdFor, checkKey, checkKeyFor, displayOf, formatClaimStats, isFresh, matchClaims, parseBodyWithMarkers, parseTopics, stripMarks, type TopicClaim } from './knowledgeView'

const rawTopic = (over: Record<string, unknown> = {}) => ({
  id: 't1', name: '題目', kind: 'method', firstSeen: '2026-01-01', revision: 2, docs: 3, newDocs: 0, monthsSpan: 1, ...over,
})
const feed = (topics: unknown[]) => ({ available: true, payload: { computedAt: '2026-11-12T10:00:00+08:00', topics } })
const claim = (over: Partial<TopicClaim> & { id: string; text: string }): TopicClaim => ({
  section: '步驟', status: 'active', origin: 'model', pinned: false, firstSeen: '2026-11-01', lastChanged: '2026-11-01', ...over,
})

describe('parseTopics：claims／claimStats／appliedCorrections 寬容解析', () => {
  const good = { id: 'c001', section: '步驟', status: 'active', origin: 'model', pinned: false, firstSeen: '2026-11-01', lastChanged: '2026-11-02', text: '- 先量 ⟦1⟧' }

  it('合法的帳本三個欄位都帶進來', () => {
    const d = parseTopics(feed([rawTopic({ claims: [good], claimStats: { active: 3, retired: 1, disputed: 0, user: 2 }, appliedCorrections: [4, 5] })]))!
    expect(d.topics[0]!.claims).toEqual([good])
    expect(d.topics[0]!.claimStats).toEqual({ active: 3, retired: 1, disputed: 0, user: 2 })
    expect(d.topics[0]!.appliedCorrections).toEqual([4, 5])
  })
  it('沒有這三個鍵＝物件上也沒有這些鍵', () => {
    const t = parseTopics(feed([rawTopic()]))!.topics[0]!
    expect('claims' in t).toBe(false)
    expect('claimStats' in t).toBe(false)
    expect('appliedCorrections' in t).toBe(false)
  })
  it('claims 不是陣列：整題仍在、claims 當沒有', () => {
    const d = parseTopics(feed([rawTopic({ claims: 'oops' }), rawTopic({ id: 't2', claims: { a: 1 } })]))!
    expect(d.topics.map((t) => t.id)).toEqual(['t1', 't2'])
    expect(d.topics[0]!.claims).toBeUndefined()
    expect(d.topics[1]!.claims).toBeUndefined()
  })
  it('單筆缺欄位、status／origin 不認得、日期壞掉、pinned 非布林：只略過那一筆', () => {
    const bad = [
      { ...good, id: 'x1', text: undefined },
      { ...good, id: 'x2', status: 'weird' },
      { ...good, id: 'x3', origin: 'robot' },
      { ...good, id: 'x4', firstSeen: '昨天' },
      { ...good, id: 'x5', pinned: 'yes' },
      null, 5, 'str',
    ]
    const d = parseTopics(feed([rawTopic({ claims: [bad[0], good, ...bad.slice(1)] }), rawTopic({ id: 't2' })]))!
    expect(d.topics).toHaveLength(2)
    expect(d.topics[0]!.claims!.map((c) => c.id)).toEqual(['c001'])
  })
  it('claimStats 形狀不對／負數＝undefined；appliedCorrections 只留整數', () => {
    const d = parseTopics(feed([
      rawTopic({ claimStats: { active: 1, retired: 'a', disputed: 0, user: 0 }, appliedCorrections: [1, 'x', 2.5, 3] }),
      rawTopic({ id: 't2', claimStats: { active: -1, retired: 0, disputed: 0, user: 0 }, appliedCorrections: 'no' }),
    ]))!
    expect(d.topics[0]!.claimStats).toBeUndefined()
    expect(d.topics[0]!.appliedCorrections).toEqual([1, 3])
    expect(d.topics[1]!.claimStats).toBeUndefined()
    expect(d.topics[1]!.appliedCorrections).toBeUndefined()
  })
})

const BODY = [
  '## 一句話',
  '- 先備料再動工 ⟦1⟧',
  '',
  '## 開工前準備',
  '- 帶捲尺 ⟦1⟧',
  '- 帶捲尺 ⟦1⟧',
  '',
  '## 步驟',
  '- 量尺寸 ⟦1⟧、⟦2⟧',
  '- 畫線（僅一例） ⟦3⟧',
  '- 帶捲尺 ⟦1⟧',
  '',
  '## 常見誤解',
  '- 以為：越快越好 → 其實：慢一點才準 ⟦2⟧',
  '',
  '## 踩過的坑',
  '- ~~舊的坑~~（使用者標記有誤 2026-11-12）',
].join('\n')

describe('matchClaims', () => {
  const parsed = parseBodyWithMarkers(BODY)

  it('含 ⟦n⟧、含（僅一例）都配得對，並看節名', () => {
    const m = matchClaims(parsed, [
      claim({ id: 'c001', section: '一句話', text: '- 先備料再動工 ⟦1⟧' }),
      claim({ id: 'c003', text: '- 量尺寸 ⟦1⟧、⟦2⟧' }),
      claim({ id: 'c004', text: '- 畫線（僅一例） ⟦3⟧' }),
      claim({ id: 'c005', section: '常見誤解', text: '- 以為：越快越好 → 其實：慢一點才準 ⟦2⟧' }),
    ])
    expect(m.get('summary')!.id).toBe('c001')
    expect(m.get(bulletId('steps', 0))!.id).toBe('c003')
    expect(m.get(bulletId('steps', 1))!.id).toBe('c004')
    expect(m.get(bulletId('myths', 0))!.id).toBe('c005')
  })
  it('refs 不同就配不到（不放進 Map）', () => {
    const m = matchClaims(parsed, [claim({ id: 'c9', text: '- 量尺寸 ⟦1⟧' })])
    expect(m.size).toBe(0)
  })
  it('兩條文字相同的句子：一對一、依出現順序；同文字但在別節的不會被拿走', () => {
    const m = matchClaims(parsed, [
      claim({ id: 'p1', section: '開工前準備', text: '- 帶捲尺 ⟦1⟧' }),
      claim({ id: 'p2', section: '開工前準備', text: '- 帶捲尺 ⟦1⟧' }),
      claim({ id: 's1', section: '步驟', text: '- 帶捲尺 ⟦1⟧' }),
    ])
    expect(m.get(bulletId('prep', 0))!.id).toBe('p1')
    expect(m.get(bulletId('prep', 1))!.id).toBe('p2')
    expect(m.get(bulletId('steps', 2))!.id).toBe('s1')
    expect(m.size).toBe(3)
  })
  it('多出來的同文字 claim 配不到就略過', () => {
    const m = matchClaims(parsed, [1, 2, 3].map((i) => claim({ id: `p${i}`, section: '開工前準備', text: '- 帶捲尺 ⟦1⟧' })))
    expect(m.size).toBe(2)
  })
  it('被標記有誤的那行也配得到（逐字相同）', () => {
    const m = matchClaims(parsed, [claim({ id: 'd1', section: '踩過的坑', status: 'disputed', text: '- ~~舊的坑~~（使用者標記有誤 2026-11-12）' })])
    expect(m.get(bulletId('pitfalls', 0))!.id).toBe('d1')
  })
  it('舊格式「這件事到底在幹嘛」第一條＝summary 也配得到', () => {
    const legacy = parseBodyWithMarkers('## 這件事到底在幹嘛\n- 第一句 ⟦1⟧\n- 第二句 ⟦1⟧\n')
    const m = matchClaims(legacy, [claim({ id: 'a', section: '這件事到底在幹嘛', text: '- 第一句 ⟦1⟧' }), claim({ id: 'b', section: '這件事到底在幹嘛', text: '- 第二句 ⟦1⟧' })])
    expect(m.get('summary')!.id).toBe('a')
    expect(m.get(bulletId('what', 0))!.id).toBe('b')
  })
})

describe('displayOf／stripMarks', () => {
  it('disputed：去 ~~、去句尾標記並回傳日期', () => {
    const c = claim({ id: 'd', status: 'disputed', text: '' })
    expect(displayOf({ text: '~~舊的坑~~（使用者標記有誤 2026-11-12）' }, c)).toEqual({ text: '舊的坑', date: '2026-11-12', mark: 'disputed' })
  })
  it('使用者補充：去句尾標記並回傳日期', () => {
    const c = claim({ id: 'u', origin: 'user', text: '' })
    expect(displayOf({ text: '我自己加的（使用者補充 2026-11-12）' }, c)).toEqual({ text: '我自己加的', date: '2026-11-12', mark: 'added' })
  })
  it('沒有 claim 或一般 claim 原樣', () => {
    expect(displayOf({ text: '原句 ~~x~~' }, undefined)).toEqual({ text: '原句 ~~x~~', date: null, mark: null })
    expect(displayOf({ text: '一般句' }, claim({ id: 'n', text: '' }))).toEqual({ text: '一般句', date: null, mark: null })
  })
  it('stripMarks 兩種標記都拿掉', () => {
    expect(stripMarks('A（使用者補充 2026-11-12）')).toBe('A')
    expect(stripMarks('B（使用者標記有誤 2026-11-12）')).toBe('B')
    expect(stripMarks('C')).toBe('C')
  })
})

describe('isFresh', () => {
  const now = new Date('2026-11-12T03:00:00Z')
  it('近 14 天內（含今天）為新，更早不是', () => {
    expect(isFresh({ firstSeen: '2026-11-12' }, now)).toBe(true)
    expect(isFresh({ firstSeen: '2026-10-30' }, now)).toBe(true)
    expect(isFresh({ firstSeen: '2026-10-29' }, now)).toBe(false)
    expect(isFresh({ firstSeen: '2026-11-01' }, now, 5)).toBe(false)
    expect(isFresh({ firstSeen: '壞的' }, now)).toBe(false)
  })
})

describe('formatClaimStats', () => {
  it('N 一定顯示，0 的項目省略', () => {
    expect(formatClaimStats({ active: 12, retired: 0, disputed: 0, user: 0 })).toBe('12 條')
    expect(formatClaimStats({ active: 0, retired: 0, disputed: 0, user: 0 })).toBe('0 條')
    expect(formatClaimStats({ active: 12, retired: 3, disputed: 2, user: 1 })).toBe('12 條・你更正 1 條・有誤 2 條・已退役 3 條')
  })
})

describe('勾選鍵（有／沒有 claims）', () => {
  it('有 claims：kn-check:<id>，改版不變；值用 claim id', () => {
    const a = { id: 't1', revision: 1, claims: [] as TopicClaim[] }
    const b = { id: 't1', revision: 7, claims: [] as TopicClaim[] }
    expect(checkKeyFor(a)).toBe('kn-check:t1')
    expect(checkKeyFor(b)).toBe(checkKeyFor(a))
    expect(checkIdFor('steps:0', claim({ id: 'c003', text: '' }))).toBe('c003')
  })
  it('沒有 claims：照舊 checkKey(id, revision) 與 bulletId', () => {
    expect(checkKeyFor({ id: 't1', revision: 3 })).toBe(checkKey('t1', 3))
    expect(checkKeyFor({ id: 't1', revision: 3 })).toBe('kn-check:t1:3')
    expect(checkIdFor('steps:0')).toBe('steps:0')
    expect(checkIdFor('steps:0', null)).toBe('steps:0')
  })
})
