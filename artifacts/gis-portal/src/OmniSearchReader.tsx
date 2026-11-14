import { useEffect, useState } from 'react'
import { MarkdownView } from './MarkdownView'
import { apiFetchInsightDetail } from './insightApi'
import { PROVENANCE_LABEL, RELATION_LABEL, type InsightDetail, type ThreadDot } from './insightTree'
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

/** 心得結果卡的脈絡迷你時間線：同一脈絡在目前結果中可見的心得，一個點一則，顏色依 relation，本則加外圈；只有自己一則時是單點 */
export function ThreadMini({ dots }: { dots: ThreadDot[] }) {
  if (dots.length === 0) return null
  return (
    <span className="it-mini" data-testid="insight-thread-mini" role="img" aria-label={`同一脈絡 ${dots.length} 則`}>
      {dots.map((d) => (
        <i key={d.id} className={`it-mini-dot it-rel-${d.relation}${d.self ? ' it-mini-self' : ''}`} title={`${d.date}・${RELATION_LABEL[d.relation]}${d.self ? '（這一則）' : ''}`} />
      ))}
    </span>
  )
}

/** 搜尋結果裡的心得卡（role=option，與 HitCard 同一套 id 與樣式） */
export function InsightHit({ hit, i, on, q, dots, onPick }: {
  hit: { id: string; title: string; snippet: string; date: string | null }; i: number; on: boolean; q: string; dots: ThreadDot[]; onPick: (i: number) => void
}) {
  return (
    <div id={`om-opt-${i}`} role="option" aria-selected={on} className={`om-hit os-card os-card-plain${on ? ' om-on' : ''}`} data-testid="insight-hit"
      style={{ animationDelay: `${Math.min(i, 12) * 35}ms` }} onClick={() => onPick(i)}>
      <span className="om-kd">心得</span>
      <span className="os-card-main">
        <div className="om-t"><Marked text={hit.title} q={q} /></div>
        {hit.snippet && hit.snippet !== hit.title && <div className="om-s"><Marked text={hit.snippet} q={q} /></div>}
        <div className="it-mini-row">
          {hit.date && <span className="om-s">{hit.date}</span>}
          <ThreadMini dots={dots} />
        </div>
      </span>
    </div>
  )
}

/** 閱讀面板選到心得時：一句話在標題，這裡顯示日記原文（GET /api/insights/:id） */
function InsightReaderBody({ id, pw }: { id: string; pw: string | null }) {
  const [st, setSt] = useState<{ id: string; state: 'loading' | 'ok' | 'missing' | 'error'; data: InsightDetail | null } | null>(null)
  useEffect(() => {
    if (!pw) { setSt(null); return }
    const ctl = new AbortController()
    setSt({ id, state: 'loading', data: null })
    apiFetchInsightDetail(pw, id, ctl.signal)
      .then((d) => { if (!ctl.signal.aborted) setSt({ id, state: d ? 'ok' : 'missing', data: d }) })
      .catch(() => { if (!ctl.signal.aborted) setSt({ id, state: 'error', data: null }) })
    return () => ctl.abort()
  }, [pw, id])
  const cur = st && st.id === id ? st : null
  if (!pw) return <p className="om-one om-dim">解鎖後可看原文</p>
  if (!cur || cur.state === 'loading') return <p className="om-one om-dim">載入原文中…</p>
  if (cur.state === 'error') return <p className="om-one om-dim" role="status">原文暫時讀不到，稍後再試。</p>
  const d = cur.data
  if (!d) return <p className="om-one om-dim">這一則沒有原文資料。</p>
  return (
    <div data-testid="insight-reader">
      <p className="om-one">{d.cluster.name}・{RELATION_LABEL[d.relation]}・{PROVENANCE_LABEL[d.provenance]}・{d.date}</p>
      <h3 className="om-lb">日記原文</h3>
      <div className="om-src">{d.evidence || '（沒有原文）'}</div>
      {d.source && <div className="om-lb">出處：{d.source}</div>}
    </div>
  )
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
  const isInsight = item.kind === 'insight'
  const rawBtn = isDiary || isEvent
  return (
    <div className="om-reader-in">
      <span className="om-kd">{kindLabel(item.kind)}</span>
      <h2><Marked text={item.title} q={q} /></h2>
      {isDiary || isInsight ? null : !data || data.state === 'loading' ? <p className="om-one om-dim">載入預覽中…</p> : null}
      {!isDiary && !isInsight && data?.state === 'error' ? <p className="om-one om-dim" role="status">預覽暫時讀不到，稍後再試。</p> : null}
      {!isDiary && !isInsight && data?.state === 'missing' ? <p className="om-one om-dim">這一筆沒有預覽資料。</p> : null}
      {isDiary && <SearchDiaryReport date={item.id} pw={pw ?? null} />}
      {isInsight && <InsightReaderBody id={item.id} pw={pw ?? null} />}
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
