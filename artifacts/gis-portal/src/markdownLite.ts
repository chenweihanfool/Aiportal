// 輕量、安全的 Markdown 解析（純函式；輸出結構化節點，由 MarkdownView 轉成 React 元素）。
//
// 為什麼手寫、不引入 marked＋DOMPurify：報表用到的語法有限（標題、粗體、清單、表格、引用、連結、行內 code），
// 輸出是 React 節點而不是 HTML 字串——**沒有 innerHTML，就沒有 XSS 面**，也不需要新增依賴。
// 連結只放行 http／https／mailto；其他協定（javascript:、data: …）一律降級成純文字。
// Obsidian wikilink（[[目標|別名]]）解析成 wikilink 節點：預設只顯示文字，呼叫端（MarkdownView）提供解析函式
// 時才會變成站內可點的連結（解析不到的維持純文字）；內嵌 ![[附件/…]] 一律顯示為「📎 檔名」。
// 設計：kb-pipeline docs/timeline-design.md。

export type Inline =
  | { t: 'text'; v: string }
  | { t: 'br' }
  | { t: 'strong'; c: Inline[] }
  | { t: 'em'; c: Inline[] }
  | { t: 'code'; v: string }
  | { t: 'link'; href: string; c: Inline[] }
  | { t: 'wikilink'; target: string; text: string }

export type Block =
  | { t: 'h'; level: number; c: Inline[] }
  | { t: 'p'; c: Inline[] }
  | { t: 'ul'; items: Inline[][] }
  | { t: 'ol'; items: Inline[][] }
  | { t: 'quote'; c: Inline[] }
  | { t: 'hr' }
  | { t: 'code'; v: string }
  | { t: 'table'; head: Inline[][]; rows: Inline[][][] }

const SAFE_HREF = /^(https?:\/\/|mailto:)/i

export function safeHref(href: string): string | null {
  const h = href.trim()
  return SAFE_HREF.test(h) ? h : null
}

/** 路徑的最後一段（去掉資料夾與 .md）。 */
export function pathBase(path: string): string {
  const name = path.trim().split('/').filter(Boolean).pop() ?? path.trim()
  return name.replace(/\.md$/i, '')
}

/** wikilink 的顯示文字：有別名用別名；日記連結顯示「日記 日期」；其餘取檔名（去資料夾與 .md）。 */
export function wikilinkText(target: string, alias?: string): string {
  if (alias && alias.trim()) return alias.trim()
  if (target.trim().startsWith('日記/')) return `日記 ${pathBase(target)}`
  return pathBase(target)
}

export function parseInline(src: string): Inline[] {
  const out: Inline[] = []
  let buf = ''
  const flush = () => { if (buf) { out.push({ t: 'text', v: buf }); buf = '' } }
  let i = 0
  while (i < src.length) {
    const rest = src.slice(i)
    let m: RegExpExecArray | null
    if ((m = /^`([^`\n]+)`/.exec(rest))) {
      flush(); out.push({ t: 'code', v: m[1] }); i += m[0].length; continue
    }
    // 粗體：`**` 隨處可用；`__` 依 CommonMark 不可出現在英數字中間（例：window.__xss=2 不是粗體）
    if ((m = /^(\*\*|__)(?=\S)([\s\S]*?\S)\1/.exec(rest)) && (m[1] === '**' || i === 0 || !/[A-Za-z0-9_]/.test(src[i - 1]))
      && (m[1] === '**' || !/[A-Za-z0-9_]/.test(src[i + m[0].length] ?? ''))) {
      flush(); out.push({ t: 'strong', c: parseInline(m[2]) }); i += m[0].length; continue
    }
    if ((m = /^!\[\[([^\]|]+)(?:\|[^\]]*)?\]\]/.exec(rest))) {            // ![[附件/x.png]] 內嵌 → 「📎 檔名」
      flush(); out.push({ t: 'text', v: `📎 ${pathBase(m[1])}` }); i += m[0].length; continue
    }
    if ((m = /^\[\[([^\]|]+)(?:\|([^\]]*))?\]\]/.exec(rest))) {          // [[wikilink|alias]]
      flush(); out.push({ t: 'wikilink', target: m[1].trim(), text: wikilinkText(m[1], m[2]) }); i += m[0].length; continue
    }
    if ((m = /^\[([^\]\n]+)\]\(((?:[^()\s]|\([^()\s]*\))+)\)/.exec(rest))) {
      const href = safeHref(m[2])
      flush()
      if (href) out.push({ t: 'link', href, c: parseInline(m[1]) })
      else out.push({ t: 'text', v: m[1] })                              // 不安全協定：只留連結文字
      i += m[0].length; continue
    }
    if ((m = /^\*(?=\S)([^*\n]*?\S)\*(?!\*)/.exec(rest)) && (i === 0 || /[\s(（,，、:：]/.test(src[i - 1]))) {
      flush(); out.push({ t: 'em', c: parseInline(m[1]) }); i += m[0].length; continue
    }
    buf += src[i]
    i += 1
  }
  flush()
  return out
}

function inlineWithBreaks(lines: string[]): Inline[] {
  const out: Inline[] = []
  lines.forEach((ln, idx) => {
    if (idx > 0) out.push({ t: 'br' })
    out.push(...parseInline(ln))
  })
  return out
}

const isTableSep = (s: string) => /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/.test(s) && s.includes('-')
const splitRow = (s: string) => s.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map(c => c.trim())

export function parseMarkdown(text: string): Block[] {
  let lines = text.replace(/^﻿/, '').replace(/\r\n?/g, '\n').split('\n')
  if (lines[0]?.trim() === '---') {                                       // frontmatter
    const end = lines.findIndex((l, i) => i > 0 && l.trim() === '---')
    if (end > 0) lines = lines.slice(end + 1)
  }
  const blocks: Block[] = []
  let i = 0
  while (i < lines.length) {
    const line = lines[i]
    const t = line.trim()
    if (!t) { i++; continue }
    if (t.startsWith('```')) {                                             // fenced code
      const buf: string[] = []
      i++
      while (i < lines.length && !lines[i].trim().startsWith('```')) { buf.push(lines[i]); i++ }
      i++
      blocks.push({ t: 'code', v: buf.join('\n') })
      continue
    }
    const h = /^(#{1,6})\s+(.*)$/.exec(t)
    if (h) { blocks.push({ t: 'h', level: h[1].length, c: parseInline(h[2].replace(/\s+#+\s*$/, '')) }); i++; continue }
    if (/^(-{3,}|\*{3,}|_{3,})$/.test(t)) { blocks.push({ t: 'hr' }); i++; continue }
    if (t.startsWith('|') && i + 1 < lines.length && isTableSep(lines[i + 1])) {   // table
      const head = splitRow(t).map(parseInline)
      const rows: Inline[][][] = []
      i += 2
      while (i < lines.length && lines[i].trim().startsWith('|')) { rows.push(splitRow(lines[i]).map(parseInline)); i++ }
      blocks.push({ t: 'table', head, rows })
      continue
    }
    if (t.startsWith('>')) {
      const buf: string[] = []
      while (i < lines.length && lines[i].trim().startsWith('>')) { buf.push(lines[i].trim().replace(/^>\s?/, '')); i++ }
      blocks.push({ t: 'quote', c: inlineWithBreaks(buf) })
      continue
    }
    if (/^([-*+])\s+/.test(t) || /^\d+[.)]\s+/.test(t)) {
      const ordered = /^\d+[.)]\s+/.test(t)
      const re = ordered ? /^\s*\d+[.)]\s+/ : /^\s*[-*+]\s+/
      const items: Inline[][] = []
      while (i < lines.length && re.test(lines[i])) { items.push(parseInline(lines[i].replace(re, ''))); i++ }
      blocks.push({ t: ordered ? 'ol' : 'ul', items })
      continue
    }
    const para: string[] = []                                              // paragraph（保留單行換行）
    while (i < lines.length) {
      const l = lines[i]; const lt = l.trim()
      if (!lt || /^#{1,6}\s/.test(lt) || lt.startsWith('```') || /^(-{3,}|\*{3,}|_{3,})$/.test(lt)
        || lt.startsWith('>') || (lt.startsWith('|') && i + 1 < lines.length && isTableSep(lines[i + 1]))
        || /^([-*+])\s+/.test(lt) || /^\d+[.)]\s+/.test(lt)) break
      para.push(l.trimEnd()); i++
    }
    if (para.length) blocks.push({ t: 'p', c: inlineWithBreaks(para) })
    else i++
  }
  return blocks
}
