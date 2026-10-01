import type { ReactNode } from 'react'
import { COLOR, FONT } from './theme'
import { parseMarkdown, type Block, type Inline } from './markdownLite'

// 把 markdownLite 的結構轉成 React 元素——只產生元素、不使用 dangerouslySetInnerHTML。
function renderInline(nodes: Inline[]): ReactNode[] {
  return nodes.map((n, i) => {
    switch (n.t) {
      case 'text': return n.v
      case 'br': return <br key={i} />
      case 'strong': return <strong key={i} style={{ color: COLOR.ink, fontWeight: 600 }}>{renderInline(n.c)}</strong>
      case 'em': return <em key={i}>{renderInline(n.c)}</em>
      case 'code': return <code key={i} style={{ fontFamily: FONT.mono, fontSize: '0.92em', background: COLOR.panelRaised, padding: '0 0.25em', borderRadius: 3 }}>{n.v}</code>
      case 'link': return <a key={i} href={n.href} target="_blank" rel="noopener noreferrer" style={{ color: COLOR.amber }}>{renderInline(n.c)}</a>
    }
  })
}

function renderBlock(b: Block, i: number): ReactNode {
  switch (b.t) {
    case 'h': {
      const size = ['1.15rem', '1.05rem', '0.95rem', '0.88rem', '0.82rem', '0.8rem'][b.level - 1]
      return <div key={i} role="heading" aria-level={b.level} style={{ fontSize: size, fontWeight: 600, color: COLOR.ink, margin: '1rem 0 0.35rem' }}>{renderInline(b.c)}</div>
    }
    case 'p': return <p key={i} style={{ margin: '0.5rem 0', lineHeight: 1.7 }}>{renderInline(b.c)}</p>
    case 'ul': return <ul key={i} style={{ margin: '0.4rem 0', paddingLeft: '1.3rem', lineHeight: 1.7 }}>{b.items.map((it, j) => <li key={j}>{renderInline(it)}</li>)}</ul>
    case 'ol': return <ol key={i} style={{ margin: '0.4rem 0', paddingLeft: '1.5rem', lineHeight: 1.7 }}>{b.items.map((it, j) => <li key={j}>{renderInline(it)}</li>)}</ol>
    case 'quote': return <blockquote key={i} style={{ margin: '0.5rem 0', padding: '0.1rem 0.8rem', borderLeft: `3px solid ${COLOR.amberDim}`, color: COLOR.steel, lineHeight: 1.7 }}>{renderInline(b.c)}</blockquote>
    case 'hr': return <hr key={i} style={{ border: 0, borderTop: `1px solid ${COLOR.line}`, margin: '0.9rem 0' }} />
    case 'code': return <pre key={i} style={{ margin: '0.6rem 0', padding: '0.6rem 0.8rem', background: COLOR.panelRaised, borderRadius: 4, overflowX: 'auto', fontFamily: FONT.mono, fontSize: '0.75rem' }}>{b.v}</pre>
    case 'table': return (
      <div key={i} style={{ overflowX: 'auto', margin: '0.6rem 0' }}>
        <table style={{ borderCollapse: 'collapse', fontSize: '0.78rem', minWidth: '60%' }}>
          <thead><tr>{b.head.map((c, j) => <th key={j} style={{ textAlign: 'left', padding: '0.3rem 0.6rem', borderBottom: `1px solid ${COLOR.lineBright}`, color: COLOR.steel }}>{renderInline(c)}</th>)}</tr></thead>
          <tbody>{b.rows.map((r, j) => <tr key={j}>{r.map((c, k) => <td key={k} style={{ padding: '0.3rem 0.6rem', borderBottom: `1px solid ${COLOR.line}` }}>{renderInline(c)}</td>)}</tr>)}</tbody>
        </table>
      </div>
    )
  }
}

export function MarkdownView({ text, fontSize = '0.84rem' }: { text: string; fontSize?: string }) {
  return <div style={{ fontSize, color: COLOR.steel, wordBreak: 'break-word' }}>{parseMarkdown(text).map(renderBlock)}</div>
}
