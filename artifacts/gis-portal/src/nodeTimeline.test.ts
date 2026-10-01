import { describe, expect, it } from 'vitest'
import { groupByMonth, parseNarrative, sortNewestFirst, type TimelineRow } from './nodeTimeline'

const row = (id: string, date: string, title = id): TimelineRow => ({ id, date, title, status: null, case: null })

describe('sortNewestFirst / groupByMonth', () => {
  it('sorts newest first, ties by title, without mutating the input', () => {
    const input = [row('a', '2026-09-01', 'B'), row('b', '2026-10-02'), row('c', '2026-09-01', 'A')]
    const out = sortNewestFirst(input)
    expect(out.map(r => r.id)).toEqual(['b', 'c', 'a'])
    expect(input.map(r => r.id)).toEqual(['a', 'b', 'c'])
  })

  it('groups consecutive rows by month and keeps order', () => {
    const g = groupByMonth(sortNewestFirst([row('a', '2026-10-02'), row('b', '2026-09-29'), row('c', '2026-09-21'), row('d', '2026-08-11')]))
    expect(g.map(x => [x.month, x.rows.map(r => r.id)])).toEqual([['2026-10', ['a']], ['2026-09', ['b', 'c']], ['2026-08', ['d']]])
  })

  it('puts rows without a proper date under 未註明日期', () => {
    expect(groupByMonth([row('x', '')]).map(g => g.month)).toEqual(['未註明日期'])
    expect(groupByMonth([])).toEqual([])
  })
})

describe('parseNarrative', () => {
  const real = '本輪新邊中屬 09-21 敘事之後的實質新節點有三筆，其餘增量為 L3 存量補關聯（邊數 58→115）。履約期品質管控：[[2026-09-01_115年度現況測量自我檢查紀錄表9（9月成果檢查）]] 是 08-11 第 1 階驗收通過後的自主成果檢查留痕。教育訓練籌備：[[2026-09-21_向銅鑼所索取資料]] 顯示 10-01 教育訓練節點已進入跨所索取資料階段。最新官方節點：[[2026-10-02_縣府召開會議通知]]，除本所 [[呂佳泰]]、[[陳韋翰]] 外，縣府端 [[劉嘉銘]] 同列。第 2 階段成果送審時程仍未入帳，履約期限 115-12-15 不變。'

  it('splits a long paragraph into a headline plus labelled / plain items', () => {
    const p = parseNarrative(real)
    expect(p.headline).toBe('本輪新邊中屬 09-21 敘事之後的實質新節點有三筆，其餘增量為 L3 存量補關聯（邊數 58→115）')
    expect(p.items.map(i => i.label)).toEqual(['履約期品質管控', '教育訓練籌備', '最新官方節點', null])
    expect(p.items[0].text.startsWith('[[2026-09-01_115年度現況測量自我檢查紀錄表9（9月成果檢查）]] 是 08-11')).toBe(true)
    expect(p.items[3].text).toBe('第 2 階段成果送審時程仍未入帳，履約期限 115-12-15 不變')
  })

  it('keeps wikilinks intact even when their names contain punctuation', () => {
    const p = parseNarrative('標題句。重點：見 [[2026-09-21_函（上游，同案件）：副本]] 與 [[人名]]。')
    expect(p.headline).toBe('標題句')
    expect(p.items).toEqual([{ label: '重點', text: '見 [[2026-09-21_函（上游，同案件）：副本]] 與 [[人名]]' }])
  })

  it('does not mistake a clock time or a number for a label', () => {
    const p = parseNarrative('開場。10:30 開會討論。第 2 階段：送審。')
    expect(p.headline).toBe('開場')
    expect(p.items).toEqual([{ label: null, text: '10:30 開會討論' }, { label: '第 2 階段', text: '送審' }])
  })

  it('uses no headline when the first sentence is already a labelled item; empty text is harmless', () => {
    expect(parseNarrative('重點：甲。次要：乙')).toEqual({ headline: '', items: [{ label: '重點', text: '甲' }, { label: '次要', text: '乙' }] })
    expect(parseNarrative('')).toEqual({ headline: '', items: [] })
    expect(parseNarrative('   ')).toEqual({ headline: '', items: [] })
  })

  it('splits on 「；」 (legacy single paragraph) and on newlines (structured)', () => {
    expect(parseNarrative('甲事；乙事；丙事').items.map(i => i.text)).toEqual(['乙事', '丙事'])
    expect(parseNarrative('甲事\n乙事\n丙事').items.map(i => i.text)).toEqual(['乙事', '丙事'])
  })

  it('L5 結構化格式（換行分隔）：首行為標題，每行一條，行內句號不再切開', () => {
    const p = parseNarrative('案件進入履約期。品質與請款同步\n履約期品質管控：10/1 抽驗 [[a_b]]。結果合格\n下一步：等第二期請款')
    expect(p.headline).toBe('案件進入履約期。品質與請款同步')
    expect(p.items).toEqual([
      { label: '履約期品質管控', text: '10/1 抽驗 [[a_b]]。結果合格' },
      { label: '下一步', text: '等第二期請款' },
    ])
  })
})
