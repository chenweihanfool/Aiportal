import { describe, expect, it } from 'vitest'
import { quoteFor, rawOpenMode, sourceBadge, splitByRanges } from './knowledgeSource'
import { highlightRanges } from './knowledgeView'

const quotes = [
  { k: 0, ref: 2, text: '第一句', fromOriginal: true, weak: false },
  { k: 1, ref: 1, text: null, fromOriginal: true, weak: false },
]

describe('quoteFor', () => {
  it('ref 對得上才採用', () => {
    expect(quoteFor(quotes, 0, 2)?.text).toBe('第一句')
  })
  it('ref 對不上（序號錯位）、text 為 null、越界、沒有 quotes 都回 null', () => {
    expect(quoteFor(quotes, 0, 1)).toBeNull()
    expect(quoteFor(quotes, 1, 1)).toBeNull()
    expect(quoteFor(quotes, 5, 1)).toBeNull()
    expect(quoteFor(null, 0, 1)).toBeNull()
  })
})

describe('sourceBadge', () => {
  it('已知型別與未知型別', () => {
    expect(sourceBadge('pdf').label).toBe('PDF')
    expect(sourceBadge('diary').icon).toBe('📓')
    expect(sourceBadge(undefined).label).toBe('其他')
    expect(sourceBadge('zzz').label).toBe('其他')
  })
})

describe('splitByRanges', () => {
  it('依命中區間切段', () => {
    const t = 'Abc 中文 abc'
    expect(splitByRanges(t, highlightRanges(t, 'abc'))).toEqual([
      { text: 'Abc', hit: true }, { text: ' 中文 ', hit: false }, { text: 'abc', hit: true },
    ])
    expect(splitByRanges('xyz', [])).toEqual([{ text: 'xyz', hit: false }])
  })
})

describe('rawOpenMode', () => {
  it('pdf 與圖片開新分頁，Office 下載', () => {
    expect(rawOpenMode('人類/a.PDF')).toBe('open')
    expect(rawOpenMode('人類/a.jpg')).toBe('open')
    expect(rawOpenMode('人類/a.docx')).toBe('download')
    expect(rawOpenMode('人類/a.xlsx')).toBe('download')
  })
})
