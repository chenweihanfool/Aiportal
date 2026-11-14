import { MarkdownView } from './MarkdownView'
import { SearchDiaryReport } from './SearchDiaryReport'
import { PinButton } from './PinButton'
import { pinTargetFor } from './pushTriggers'
import { CTX_H, CTX_W, contextLayout, ctxLabel, highlightSegments, kindLabel, openAction, type PreviewRelated, type SearchKind, type SearchPreview } from './omniSearch'

// 全站搜尋的右側閱讀面板（類型、標題、一句話、重點、脈絡圖、出處、開啟）。狀態都由 OmniSearch.tsx 傳進來。

export type ReaderItem = { kind: SearchKind; id: string; title: string }
export type PreviewState = { kind: SearchKind; id: string; state: 'loading' | 'ok' | 'missing' | 'error'; data: SearchPreview | null }

export function Marked({ text, q }: { text: string; q: string }) {
  return <>{highlightSegments(text, q).map((s, i) => (s.hit ? <mark key={i}>{s.text}</mark> : s.text))}</>
}

function pointsLabel(kind: SearchKind): string {
  if (kind === 'repo') return '資訊'
  if (kind === 'topic') return '要注意什麼'
  if (kind === 'case') return '來龍去脈'
  return '最近'
}

function ContextMap({ related, onJump }: { related: PreviewRelated[]; onJump: (r: PreviewRelated) => void }) {
  if (related.length === 0) return null
  const { cx, cy, nodes } = contextLayout(related.length)
  return (
    <>
      <h3 className="om-lb">脈絡圖・點節點跳過去</h3>
      <svg className="om-ctx" viewBox={`0 0 ${CTX_W} ${CTX_H}`} role="group" aria-label="脈絡圖">
        {related.map((r, i) => (
          <line key={`l${r.kind}:${r.id}`} x1={cx} y1={cy} x2={nodes[i].x} y2={nodes[i].y} style={{ animationDelay: `${i * 90}ms` }} />
        ))}
        <g className="om-n om-c"><circle cx={cx} cy={cy} r={6} /></g>
        {related.map((r, i) => {
          const n = nodes[i]
          const go = () => onJump(r)
          return (
            <g
              key={`n${r.kind}:${r.id}`} className="om-n" role="button" tabIndex={0} aria-label={`${kindLabel(r.kind)}：${r.title}`}
              onClick={go} onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); go() } }}
            >
              <circle cx={n.x} cy={n.y} r={5} />
              <text x={n.x} y={n.labelY} textAnchor="middle">{`${kindLabel(r.kind)}・${ctxLabel(r.title, related.length)}`}</text>
            </g>
          )
        })}
      </svg>
    </>
  )
}

export function OmniSearchReader({ item, preview, q, expanded, onToggleExpand, onOpen, onJump, pw }: {
  item: ReaderItem | null
  preview: PreviewState | null
  q: string
  expanded: boolean
  onToggleExpand: () => void
  onOpen: () => void
  onJump: (r: PreviewRelated) => void
  /** 解鎖後的密碼；有給才會顯示 📌 需要時提醒我 */
  pw?: string | null
}) {
  if (!item) return <div className="om-none om-lb">NO PREVIEW</div>
  const data = preview && preview.kind === item.kind && preview.id === item.id ? preview : null
  const p = data?.state === 'ok' ? data.data : null
  const act = openAction(item.kind, item.id).type
  const inPanel = act === 'expand'
  const isDiary = item.kind === 'diary'
  const isEvent = item.kind === 'event'
  const rawBtn = isDiary || isEvent
  return (
    <div className="om-reader-in">
      <span className="om-kd">{kindLabel(item.kind)}</span>
      <h2><Marked text={item.title} q={q} /></h2>
      {isDiary ? null : !data || data.state === 'loading' ? <p className="om-one om-dim">載入預覽中…</p> : null}
      {!isDiary && data?.state === 'error' ? <p className="om-one om-dim" role="status">預覽暫時讀不到，稍後再試。</p> : null}
      {!isDiary && data?.state === 'missing' ? <p className="om-one om-dim">這一筆沒有預覽資料。</p> : null}
      {isDiary && <SearchDiaryReport date={item.id} pw={pw ?? null} />}
      {p && (
        <>
          {!isDiary && p.one && <p className="om-one"><Marked text={p.one} q={q} /></p>}
          {!isDiary && p.points.length > 0 && (
            <>
              <h3 className="om-lb">{pointsLabel(p.kind)}</h3>
              <ul>{p.points.map((pt, i) => <li key={i}><Marked text={pt} q={q} /></li>)}</ul>
            </>
          )}
          <ContextMap related={p.related} onJump={onJump} />
          {p.source && (
            <>
              <h3 className="om-lb">出處</h3>
              <div className="om-src">{p.source}</div>
            </>
          )}
        </>
      )}
      <div className="om-act">
        {isDiary
          ? <button type="button" className="om-cta" onClick={() => { window.location.hash = 'graph/timeline' }}>在時間軸看 ↵</button>
          : <button type="button" className={inPanel ? 'om-gh' : 'om-cta'} onClick={onOpen}>{inPanel ? (expanded ? '收合原文 ↵' : '看原文 ↵') : isEvent ? '開啟事件卷宗 ↵' : item.kind === 'repo' ? '在 GitHub 開啟 ↵' : '開啟 ↵'}</button>}
        {p?.url && <a className="om-gh" href={p.url} target="_blank" rel="noopener noreferrer">在 GitHub 開啟 ↗</a>}
        {p?.bodyMd != null && !inPanel && (
          <button type="button" className="om-gh" onClick={onToggleExpand}>{rawBtn ? (expanded ? '收合原文' : '看原文') : (expanded ? '收合全文' : '展開全文')}</button>
        )}
        <PinButton pw={pw ?? null} target={pinTargetFor(item)} />
        {item.kind === 'topic' && <a className="om-gh" href={`#knowledge/${encodeURIComponent(item.id)}`}>✎ 這頁有錯</a>}
      </div>
      {expanded && p?.bodyMd != null && (
        <div className="om-body"><MarkdownView text={p.bodyMd} /></div>
      )}
      {expanded && p && p.bodyMd == null && <p className="om-one om-dim">這一類沒有全文可展開。</p>}
    </div>
  )
}
