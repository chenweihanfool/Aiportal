import { describe, expect, it } from 'vitest'
import { parseInline, parseMarkdown, safeHref } from './markdownLite'

const plain = (nodes: ReturnType<typeof parseInline>): string =>
  nodes.map(n => n.t === 'text' ? n.v : n.t === 'br' ? '\n' : n.t === 'code' ? n.v : plain(n.c)).join('')

describe('safeHref（連結協定白名單）', () => {
  it.each([
    ['https://example.com/a', 'https://example.com/a'],
    ['http://example.com', 'http://example.com'],
    ['mailto:a@b.co', 'mailto:a@b.co'],
  ])('allows %s', (input, out) => expect(safeHref(input)).toBe(out))
  it.each(['javascript:alert(1)', 'JaVaScRiPt:alert(1)', 'data:text/html,<script>', 'vbscript:x', '//evil.example', 'file:///etc/passwd', ' javascript:alert(1)'])
    ('blocks %s', href => expect(safeHref(href)).toBeNull())
})

describe('parseInline', () => {
  it('parses bold, italic, code and nesting', () => {
    const n = parseInline('**重點**與 *強調* 與 `code` 與 **外層 *內層* 外層**')
    expect(n.map(x => x.t)).toEqual(['strong', 'text', 'em', 'text', 'code', 'text', 'strong'])
    expect(plain(n)).toBe('重點與 強調 與 code 與 外層 內層 外層')
  })
  it('does not treat intraword underscores as bold (window.__xss=2 stays literal)', () => {
    expect(plain(parseInline('window.__xss=2 與 window.__xss=3'))).toBe('window.__xss=2 與 window.__xss=3')
    expect(parseInline('snake__case__name').every(n => n.t === 'text')).toBe(true)
    expect(parseInline('__真的粗體__ 後面')[0].t).toBe('strong')
    expect(parseInline('前面 __粗體__')[1].t).toBe('strong')
  })
  it('keeps unmatched markers as literal text', () => {
    expect(plain(parseInline('**沒關 與 * 孤立星號 與 `沒關'))).toBe('**沒關 與 * 孤立星號 與 `沒關')
  })
  it('turns safe links into link nodes and unsafe ones into plain text', () => {
    const ok = parseInline('[檢核表](https://example.com/x)')
    expect(ok).toEqual([{ t: 'link', href: 'https://example.com/x', c: [{ t: 'text', v: '檢核表' }] }])
    const bad = parseInline('[點我](javascript:alert(1))')
    expect(bad).toEqual([{ t: 'text', v: '點我' }])
    expect(JSON.stringify(bad)).not.toContain('javascript')
  })
  it('keeps one level of balanced parentheses inside a URL (e.g. wiki-style links)', () => {
    const n = parseInline('[條目](https://example.com/wiki/Foo_(bar))後面')
    expect(n[0]).toEqual({ t: 'link', href: 'https://example.com/wiki/Foo_(bar)', c: [{ t: 'text', v: '條目' }] })
    expect(plain(n)).toBe('條目後面')
  })
  it('renders wikilinks as their alias or name', () => {
    expect(plain(parseInline('見 [[2026-09-28_事件標題]] 與 [[人名|別名]]'))).toBe('見 2026-09-28_事件標題 與 別名')
  })
  it('never produces raw html nodes (angle brackets stay text)', () => {
    const n = parseInline('<script>alert(1)</script> <img src=x onerror=alert(1)>')
    expect(n.every(x => x.t === 'text')).toBe(true)
    expect(plain(n)).toContain('<script>')
  })
})

describe('parseMarkdown blocks', () => {
  it('strips BOM and frontmatter', () => {
    const b = parseMarkdown('﻿---\ndate: 2026-07-17\ntags: []\n---\n# 標題\n內容')
    expect(b[0]).toMatchObject({ t: 'h', level: 1 })
    expect(b).toHaveLength(2)
  })
  it('parses headings 1-6, hr and quote', () => {
    const b = parseMarkdown('# a\n### b\n###### c\n---\n> 引用一\n> 引用二')
    expect(b.map(x => x.t === 'h' ? `h${x.level}` : x.t)).toEqual(['h1', 'h3', 'h6', 'hr', 'quote'])
    expect(plain((b[4] as { c: ReturnType<typeof parseInline> }).c)).toBe('引用一\n引用二')
  })
  it('keeps single newlines inside a paragraph as line breaks (emoji-bold report style)', () => {
    const b = parseMarkdown('⚡ **狀態與決策**\n今天整理設定。\n\n🔦 **盲點**\n略。')
    expect(b).toHaveLength(2)
    expect(b[0].t).toBe('p')
    expect((b[0] as { c: Array<{ t: string }> }).c.some(n => n.t === 'br')).toBe(true)
  })
  it('parses unordered and ordered lists', () => {
    const b = parseMarkdown('- 甲\n- 乙\n\n1. 一\n2) 二')
    expect(b.map(x => x.t)).toEqual(['ul', 'ol'])
    expect((b[0] as { items: unknown[] }).items).toHaveLength(2)
    expect((b[1] as { items: unknown[] }).items).toHaveLength(2)
  })
  it('parses tables, including one that directly follows a paragraph line', () => {
    const b = parseMarkdown('說明\n| 月 | 件數 |\n|---|---|\n| 5 | 10 |\n| 6 | 12 |\n後面')
    expect(b.map(x => x.t)).toEqual(['p', 'table', 'p'])
    const tbl = b[1] as { head: unknown[]; rows: unknown[][] }
    expect(tbl.head).toHaveLength(2)
    expect(tbl.rows).toHaveLength(2)
  })
  it('does not treat a lone pipe line without separator as a table', () => {
    expect(parseMarkdown('| 只是一行 |').map(x => x.t)).toEqual(['p'])
  })
  it('parses fenced code verbatim, including an unclosed fence', () => {
    expect(parseMarkdown('```\n**不解析**\n```')[0]).toEqual({ t: 'code', v: '**不解析**' })
    expect(parseMarkdown('```\n一路到底')[0]).toEqual({ t: 'code', v: '一路到底' })
  })
  it('handles empty and whitespace-only input', () => {
    expect(parseMarkdown('')).toEqual([])
    expect(parseMarkdown('\n \n')).toEqual([])
  })
  it('does not hang or blow up on pathological input', () => {
    const t0 = Date.now()
    parseMarkdown('*'.repeat(5000) + '\n' + '['.repeat(2000) + '\n' + '`'.repeat(3000) + '\n' + '**a'.repeat(1500))
    expect(Date.now() - t0).toBeLessThan(2000)
  })
})
