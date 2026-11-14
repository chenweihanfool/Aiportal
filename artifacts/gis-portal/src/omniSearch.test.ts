import { describe, expect, it } from 'vitest'
import {
  ABANDON_MS, COMMANDS, CTX_H, CTX_W, KIND_ORDER, RECENT_KEY, addRecent, cleanSnippet, commandAnswer, contextLayout, ctxLabel, filterCommands, flattenHits, keepKnownTools,
  highlightSegments, isAbandoned, kindLabel, loadRecent, logKey, moveIndex, openAction, parsePreview, parseQuery, parseSearchResponse,
  quickAnswer, saveRecent, shouldLog, type SearchGroup, type SearchHit,
} from './omniSearch'

const hit = (kind: SearchHit['kind'], id: string, title = id, snippet = ''): SearchHit => ({ kind, id, title, snippet, date: null })

describe('parseQuery', () => {
  it('四種前綴與沒有前綴', () => {
    expect(parseQuery('@王')).toMatchObject({ mode: 'search', prefix: '@', kind: 'person', q: '王' })
    expect(parseQuery('# 鑑界')).toMatchObject({ mode: 'search', prefix: '#', kind: 'case', q: '鑑界' })
    expect(parseQuery('?RTK')).toMatchObject({ mode: 'search', prefix: '?', kind: 'topic', q: 'RTK' })
    expect(parseQuery('>時間')).toEqual({ mode: 'command', prefix: '>', kind: null, q: '時間' })
    expect(parseQuery('  鑑界 ')).toEqual({ mode: 'search', prefix: null, kind: null, q: '鑑界' })
  })
  it('空白與只有前綴', () => {
    expect(parseQuery('   ').mode).toBe('empty')
    expect(parseQuery('@')).toMatchObject({ mode: 'search', kind: 'person', q: '' })
    expect(parseQuery('>')).toMatchObject({ mode: 'command', q: '' })
  })
  it('q 截到 50 字', () => {
    expect(parseQuery('a'.repeat(80)).q).toHaveLength(50)
  })
})

describe('指令', () => {
  it('名稱完全相同的指令排最前面', () => {
    expect(filterCommands('關係宇宙')[0]?.id).toBe('graph')
    expect(filterCommands('知識庫架構')[0]?.id).toBe('architecture')
    expect(filterCommands('關係')[0]?.id).toBe('relations')
    expect(filterCommands('關係')[0]?.action).toEqual({ type: 'hash', hash: 'graph' })
  })
  it('摘要去掉 markdown 標記', () => {
    expect(cleanSnippet('## 這是什麼 鑑界流程 - 備妥 [[權狀|所有權狀]] 與 [[圖]]⟦2⟧ **重點** ^c001')).toBe('這是什麼 鑑界流程 備妥 所有權狀 與 圖 重點')
    expect(cleanSnippet('C# 語言 a-b')).toBe('C# 語言 a-b')
  })
  it('工具連結只留 sites 清單裡有的', () => {
    const hit = (kind: 'tool' | 'case', id: string) => ({ kind, id, title: id, snippet: '', date: null })
    const resp = { q: 'x', total: 4, tookMs: 1, best: hit('tool', '9'), groups: [{ kind: 'case' as const, count: 1, items: [hit('case', 'A')] }, { kind: 'tool' as const, count: 3, items: [hit('tool', '9'), hit('tool', '1')] }] }
    const r = keepKnownTools(resp, new Set(['1']))
    expect(r.groups[1]).toEqual({ kind: 'tool', count: 1, items: [hit('tool', '1')] })
    expect(r.total).toBe(2)
    expect(r.best).toEqual(hit('case', 'A'))
    expect(keepKnownTools(resp, new Set()).groups.map(g => g.kind)).toEqual(['case'])
    expect(keepKnownTools({ ...resp, groups: [resp.groups[0]!] }, new Set())).toMatchObject({ total: 4 })
  })
  it('沒有字回全部', () => expect(filterCommands('')).toHaveLength(COMMANDS.length))
  it('依名稱、關鍵字過濾（不分大小寫）', () => {
    expect(filterCommands('時間').map(c => c.id)).toEqual(['timeline'])
    expect(filterCommands('hermes').map(c => c.id)).toEqual(['hermes'])
    expect(filterCommands('美食').map(c => c.id)).toContain('food')
    expect(filterCommands('zzzz')).toEqual([])
  })
  it('清單含規格列的九項', () => {
    const labels = COMMANDS.map(c => c.label)
    for (const l of ['時間軸', '想法庫', '關係', '知識', '美食地圖', '遊記', '知識庫架構', '舊版首頁', '問 HERMES']) expect(labels).toContain(l)
  })
  it('指令即答', () => {
    expect(commandAnswer([])).toBe('沒有符合的指令')
    expect(commandAnswer(filterCommands('遊記'))).toContain('遊記')
  })
})

describe('parseSearchResponse（寬容）', () => {
  it('正常回應', () => {
    const r = parseSearchResponse({
      q: '鑑界', total: 4, tookMs: 12,
      groups: [{ kind: 'case', count: 3, items: [{ kind: 'case', id: 'a', title: 'A', snippet: 's', date: '2026-10-05' }] }],
      best: { kind: 'case', id: 'a', title: 'A', snippet: 's', date: null },
    })
    expect(r.total).toBe(4)
    expect(r.groups[0]).toMatchObject({ kind: 'case', count: 3 })
    expect(r.groups[0].items[0].date).toBe('2026-10-05')
    expect(r.best?.id).toBe('a')
  })
  it('壞項目與壞組略過，整體不丟錯', () => {
    const r = parseSearchResponse({
      groups: [
        { kind: 'nope', count: 1, items: [{ kind: 'case', id: 'x', title: 'X' }] },
        { kind: 'topic', items: [{ kind: 'topic', id: '', title: 'bad' }, { kind: 'topic', id: 't', title: 'T' }, 5, null, { kind: 'zzz', id: 'q', title: 'Q' }] },
        'junk', { kind: 'person', items: [] },
      ],
      best: { kind: 'case' },
    })
    expect(r.groups).toHaveLength(1)
    expect(r.groups[0].items.map(i => i.id)).toEqual(['t'])
    expect(r.groups[0].count).toBe(1)
    expect(r.total).toBe(1)
    expect(r.best).toBeNull()
  })
  it('完全不是物件', () => {
    for (const v of [null, undefined, 3, 'x', [], { groups: 'no' }]) {
      const r = parseSearchResponse(v)
      expect(r.groups).toEqual([])
      expect(r.total).toBe(0)
    }
  })
  it('parsePreview 寬容', () => {
    expect(parsePreview(null)).toBeNull()
    expect(parsePreview({ kind: 'topic' })).toBeNull()
    const p = parsePreview({ kind: 'topic', id: 't', title: 'T', one: 1, points: ['a', 2, ''], related: [{ kind: 'case', id: 'c', title: 'C' }, { kind: 'bad', id: 'z', title: 'Z' }], bodyMd: null })
    expect(p).toMatchObject({ one: '', points: ['a'], source: '', bodyMd: null })
    expect(p?.related).toEqual([{ kind: 'case', id: 'c', title: 'C' }])
  })
})

describe('攤平與循環移動', () => {
  const groups: SearchGroup[] = [
    { kind: 'case', count: 2, items: [hit('case', 'a'), hit('case', 'b')] },
    { kind: 'topic', count: 1, items: [hit('topic', 'c')] },
  ]
  it('攤平順序＝組順序＋組內順序', () => {
    expect(flattenHits(groups).map(h => h.id)).toEqual(['a', 'b', 'c'])
    expect(flattenHits([])).toEqual([])
  })
  it('循環移動', () => {
    expect(moveIndex(0, 1, 3)).toBe(1)
    expect(moveIndex(2, 1, 3)).toBe(0)
    expect(moveIndex(0, -1, 3)).toBe(2)
    expect(moveIndex(-1, 1, 3)).toBe(0)
    expect(moveIndex(-1, -1, 3)).toBe(2)
    expect(moveIndex(0, 1, 0)).toBe(-1)
  })
})

describe('即答文字', () => {
  it('有結果', () => {
    const s = quickAnswer(hit('case', 'a', '王先生鑑界案', 'x'.repeat(100)))
    expect(s.startsWith('最可能是案件「王先生鑑界案」— ')).toBe(true)
    expect(s.endsWith('　按 Enter 開啟')).toBe(true)
    expect(s).toContain('x'.repeat(60))
    expect(s).not.toContain('x'.repeat(61))
  })
  it('沒有摘要不留破折號', () => expect(quickAnswer(hit('tool', '1', '時間軸'))).toBe('最可能是工具「時間軸」　按 Enter 開啟'))
  it('沒有結果', () => expect(quickAnswer(null)).toBe('找不到。要不要交給 HERMES？'))
})

describe('開啟去處', () => {
  it('每個 kind', () => {
    expect(openAction('topic', 'a b')).toEqual({ type: 'hash', hash: 'knowledge/a%20b' })
    expect(openAction('idea', '1')).toEqual({ type: 'ideas' })
    expect(openAction('place', '1')).toEqual({ type: 'hash', hash: 'food' })
    expect(openAction('trip', '濱海/行')).toEqual({ type: 'hash', hash: `trips/${encodeURIComponent('濱海/行')}` })
    expect(openAction('tool', '7')).toEqual({ type: 'tool', id: '7' })
    expect(openAction('case', 'x')).toEqual({ type: 'graph', kind: 'case', id: 'c:x' })
    expect(openAction('person', 'x')).toEqual({ type: 'graph', kind: 'person', id: 'p:x' })
    expect(openAction('object', 'x')).toEqual({ type: 'graph', kind: 'object', id: 'o:x' })
    for (const k of ['event', 'concept', 'method', 'source'] as const) expect(openAction(k, 'x')).toEqual({ type: 'expand' })
  })
  it('每個 kind 都有中文標籤', () => {
    for (const k of KIND_ORDER) expect(kindLabel(k)).not.toBe('')
  })
})

describe('highlightSegments', () => {
  it('切出命中片段', () => {
    expect(highlightSegments('王先生鑑界案', '鑑界')).toEqual([{ text: '王先生', hit: false }, { text: '鑑界', hit: true }, { text: '案', hit: false }])
    expect(highlightSegments('abc', '')).toEqual([{ text: 'abc', hit: false }])
    expect(highlightSegments('ABC abc', 'b').filter(s => s.hit)).toHaveLength(2)
  })
})

describe('脈絡圖座標', () => {
  for (const n of [0, 1, 2, 8]) {
    it(`${n} 個節點：在畫布內且不重疊`, () => {
      const { cx, cy, nodes } = contextLayout(n)
      expect(nodes).toHaveLength(n)
      const all = [{ x: cx, y: cy, labelY: cy }, ...nodes]
      for (const p of all) {
        expect(p.x).toBeGreaterThanOrEqual(10)
        expect(p.x).toBeLessThanOrEqual(CTX_W - 10)
        expect(p.y).toBeGreaterThanOrEqual(10)
        expect(p.y).toBeLessThanOrEqual(CTX_H - 10)
        expect(p.labelY).toBeGreaterThan(0)
        expect(p.labelY).toBeLessThan(CTX_H)
      }
      for (let i = 0; i < all.length; i++) for (let j = i + 1; j < all.length; j++) {
        expect(Math.hypot(all[i].x - all[j].x, all[i].y - all[j].y)).toBeGreaterThan(14)
      }
    })
  }
  it('標籤截短', () => {
    expect(ctxLabel('短', 3)).toBe('短')
    expect(ctxLabel('一二三四五六七八九十一二', 3)).toBe('一二三四五六七八九…')
    expect(ctxLabel('一二三四五六七八', 8)).toBe('一二三四五…')
  })
})

describe('紀錄去重（F10）', () => {
  it('同一個查詢連續重複不重送，換了或點開的項目不同就送', () => {
    const k1 = logKey('鑑界', null, null)
    expect(shouldLog(null, k1)).toBe(true)
    expect(shouldLog(k1, logKey('鑑界', null, null))).toBe(false)
    expect(shouldLog(k1, logKey('RTK', null, null))).toBe(true)
    expect(shouldLog(k1, logKey('鑑界', 'case', 'a'))).toBe(true)
  })
  it('停留 2 秒且沒點開才算放棄', () => {
    expect(isAbandoned(0, ABANDON_MS, false)).toBe(true)
    expect(isAbandoned(0, ABANDON_MS - 1, false)).toBe(false)
    expect(isAbandoned(0, ABANDON_MS * 5, true)).toBe(false)
  })
})

describe('最近找過（F11）', () => {
  it('最多 5 個、去重、新的在最前', () => {
    let l: string[] = []
    for (const q of ['a', 'b', 'c', 'd', 'e', 'f']) l = addRecent(l, q)
    expect(l).toEqual(['f', 'e', 'd', 'c', 'b'])
    expect(addRecent(l, 'D')).toEqual(['D', 'f', 'e', 'c', 'b'])
    expect(addRecent(l, '  ')).toEqual(l)
  })
  it('讀寫包 try/catch', () => {
    const mem = new Map<string, string>()
    const st = { getItem: (k: string) => mem.get(k) ?? null, setItem: (k: string, v: string) => { mem.set(k, v) } }
    saveRecent(['x', 'y'], st)
    expect(loadRecent(st)).toEqual(['x', 'y'])
    mem.set(RECENT_KEY, '{bad')
    expect(loadRecent(st)).toEqual([])
    mem.set(RECENT_KEY, JSON.stringify(['a', 3, '', 'b']))
    expect(loadRecent(st)).toEqual(['a', 'b'])
    const boom = { getItem: () => { throw new Error('x') }, setItem: () => { throw new Error('x') } }
    expect(loadRecent(boom)).toEqual([])
    expect(() => saveRecent(['a'], boom)).not.toThrow()
    expect(loadRecent(null)).toEqual([])
  })
})
