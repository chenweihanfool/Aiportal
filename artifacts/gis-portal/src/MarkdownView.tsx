import type { ReactNode } from 'react'
import { COLOR, FONT } from './theme'
import { parseInline, parseMarkdown, type Block, type Inline } from './markdownLite'

// 把 markdownLite 的結構轉成 React 元素——只產生元素、不使用 dangerouslySetInnerHTML。
// resolveWikilink／onNavigate：提供時，能解析到站內節點的 wikilink 會變成可點連結（點了跳到該節點）；
// 沒提供或解析不到就維持純文字。
interface LinkOpts { resolveWikilink?: (target: string) => string | null; onNavigate?: (nodeId: string) => void }

function renderInline(nodes: Inline[], opts: LinkOpts): ReactNode[] {
  return nodes.map((n, i) => {
    switch (n.t) {
      case 'text': return n.v
      case 'br': return <br key={i} />
      case 'strong': return <strong key={i} style={{ color: COLOR.ink, fontWeight: 600 }}>{renderInline(n.c, opts)}</strong>
      case 'em': return <em key={i}>{renderInline(n.c, opts)}</em>
      case 'code': return <code key={i} style={{ fontFamily: FONT.mono, fontSize: '0.92em', background: COLOR.panelRaised, padding: '0 0.25em', borderRadius: 3 }}>{n.v}</code>
      case 'wikilink': {
        const id = opts.onNavigate ? opts.resolveWikilink?.(n.target) ?? null : null
        if (!id) return n.text
        return (
          <span
            key={i}
            role="link"
            tabIndex={0}
            onClick={() => opts.onNavigate?.(id)}
            onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); opts.onNavigate?.(id) } }}
            style={{ color: COLOR.amber, cursor: 'pointer', textDecoration: 'underline', textDecorationStyle: 'dotted', textUnderlineOffset: '3px' }}
          >{n.text}</span>
        )
      }
      case 'link': return <a key={i} href={n.href} target="_blank" rel="noopener noreferrer" style={{ color: COLOR.amber }}>{renderInline(n.c, opts)}</a>
    }
  })
}

function renderBlock(b: Block, i: number, opts: LinkOpts): ReactNode {
  switch (b.t) {
    case 'h': {
      const size = ['1.15rem', '1.05rem', '0.95rem', '0.88rem', '0.82rem', '0.8rem'][b.level - 1]
      return <div key={i} role="heading" aria-level={b.level} style={{ fontSize: size, fontWeight: 600, color: COLOR.ink, margin: '1rem 0 0.35rem' }}>{renderInline(b.c, opts)}</div>
    }
    case 'p': return <p key={i} style={{ margin: '0.5rem 0', lineHeight: 1.7 }}>{renderInline(b.c, opts)}</p>
    case 'ul': return <ul key={i} style={{ margin: '0.4rem 0', paddingLeft: '1.3rem', lineHeight: 1.7 }}>{b.items.map((it, j) => <li key={j}>{renderInline(it, opts)}</li>)}</ul>
    case 'ol': return <ol key={i} style={{ margin: '0.4rem 0', paddingLeft: '1.5rem', lineHeight: 1.7 }}>{b.items.map((it, j) => <li key={j}>{renderInline(it, opts)}</li>)}</ol>
    case 'quote': return <blockquote key={i} style={{ margin: '0.5rem 0', padding: '0.1rem 0.8rem', borderLeft: `3px solid ${COLOR.amberDim}`, color: COLOR.steel, lineHeight: 1.7 }}>{renderInline(b.c, opts)}</blockquote>
    case 'hr': return <hr key={i} style={{ border: 0, borderTop: `1px solid ${COLOR.line}`, margin: '0.9rem 0' }} />
    case 'code': return <pre key={i} style={{ margin: '0.6rem 0', padding: '0.6rem 0.8rem', background: COLOR.panelRaised, borderRadius: 4, overflowX: 'auto', fontFamily: FONT.mono, fontSize: '0.75rem' }}>{b.v}</pre>
    case 'table': return (
      <div key={i} style={{ overflowX: 'auto', margin: '0.6rem 0' }}>
        <table style={{ borderCollapse: 'collapse', fontSize: '0.78rem', minWidth: '60%' }}>
          <thead><tr>{b.head.map((c, j) => <th key={j} style={{ textAlign: 'left', padding: '0.3rem 0.6rem', borderBottom: `1px solid ${COLOR.lineBright}`, color: COLOR.steel }}>{renderInline(c, opts)}</th>)}</tr></thead>
          <tbody>{b.rows.map((r, j) => <tr key={j}>{r.map((c, k) => <td key={k} style={{ padding: '0.3rem 0.6rem', borderBottom: `1px solid ${COLOR.line}` }}>{renderInline(c, opts)}</td>)}</tr>)}</tbody>
        </table>
      </div>
    )
  }
}

export function MarkdownView({
  text, fontSize = '0.84rem', resolveWikilink, onNavigate,
}: { text: string; fontSize?: string } & LinkOpts) {
  const opts: LinkOpts = { resolveWikilink, onNavigate }
  return <div style={{ fontSize, color: COLOR.steel, wordBreak: 'break-word' }}>{parseMarkdown(text).map((b, i) => renderBlock(b, i, opts))}</div>
}

/** 單行內文（不產生段落區塊）：給敘事條列這種「一句話」的場合用，wikilink 規則同 MarkdownView。 */
export function InlineText({ text, resolveWikilink, onNavigate }: { text: string } & LinkOpts) {
  return <>{renderInline(parseInline(text), { resolveWikilink, onNavigate })}</>
}
