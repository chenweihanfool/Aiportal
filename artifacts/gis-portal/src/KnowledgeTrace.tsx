import { createContext, useContext, useEffect, useMemo, useRef, useState } from 'react'
import { apiFetchHermesDoc, type HermesTopicQuote } from './hermesDocApi'
import { openSourceRaw } from './KnowledgeSourcePanel'
import { sourceBadge, quoteFor } from './knowledgeSource'
import { caseTimeline, commonTitlePrefix, groupSourcesByCase, type Topic } from './knowledgeView'

// 知識頁「來源可追溯」（2.77.0）：腳註小卡、來源清單／卷宗時間線。資料契約見 hermesDocApi.ts 的 source／topic。

export interface TraceCtx {
  pw: string
  topic: Topic
  /** topic doc 的 meta.quotes；載入中、404 或失敗為 null（小卡只顯示來源標題） */
  quotes: HermesTopicQuote[] | null
  /** 腳註小卡上的「跳到來源清單」（既有 onJump 行為） */
  onJump: (n: number) => void
  /** 打開第 n 個來源的原文面板 */
  onViewSource: (n: number) => void
}

const TraceContext = createContext<TraceCtx | null>(null)
export const TraceProvider = TraceContext.Provider

/** 開啟主題時載入 topic doc；404 或失敗靜默降級成 null */
export function useTopicQuotes(pw: string, topicId: string): HermesTopicQuote[] | null {
  const [quotes, setQuotes] = useState<HermesTopicQuote[] | null>(null)
  useEffect(() => {
    let cancelled = false
    setQuotes(null)
    apiFetchHermesDoc(pw, 'topic', topicId)
      .then((doc) => { if (!cancelled) setQuotes(Array.isArray(doc?.meta?.quotes) ? doc!.meta.quotes : null) })
      .catch(() => { if (!cancelled) setQuotes(null) })
    return () => { cancelled = true }
  }, [pw, topicId])
  return quotes
}

const canHover = (): boolean => (typeof window !== 'undefined' && typeof window.matchMedia === 'function' ? window.matchMedia('(hover: hover)').matches : true)

function FootRef({ n, k }: { n: number; k: number | null }) {
  const ctx = useContext(TraceContext)!
  const src = ctx.topic.sources[n - 1]
  const [hover, setHover] = useState(false)
  const [pinned, setPinned] = useState(false)
  const [msg, setMsg] = useState<string | null>(null)
  const wrap = useRef<HTMLSpanElement>(null)
  const open = hover || pinned
  useEffect(() => {
    if (!open) return
    const close = () => { setPinned(false); setHover(false) }
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') close() }
    const onDown = (e: MouseEvent) => { if (!wrap.current?.contains(e.target as Node)) close() }
    document.addEventListener('keydown', onKey)
    document.addEventListener('mousedown', onDown)
    return () => { document.removeEventListener('keydown', onKey); document.removeEventListener('mousedown', onDown) }
  }, [open])
  useEffect(() => { if (!open) setMsg(null) }, [open])

  const quote = k === null ? null : quoteFor(ctx.quotes, k, n)
  const badge = sourceBadge(src?.type)
  const title = src?.title ?? `來源 ${n}`
  const hoverOn = () => { if (canHover()) setHover(true) }
  const hoverOff = () => setHover(false)

  return (
    <span className="kn-fr" ref={wrap} onMouseEnter={hoverOn} onMouseLeave={hoverOff}
      onFocus={hoverOn} onBlur={(e) => { if (!wrap.current?.contains(e.relatedTarget as Node | null)) hoverOff() }}>
      <button type="button" className="kn-ref" aria-label={`來源 ${n}：${src?.title ?? ''}`} aria-expanded={open} aria-haspopup="dialog"
        onClick={() => setPinned((p) => !p)}>{n}</button>
      {open && (
        <span className="kn-pop" role="dialog" aria-label={`來源 ${n} 的原文摘錄`}>
          <span className="kn-pop-head"><span aria-hidden="true">{badge.icon}</span> <b>{title}</b></span>
          {quote && (
            <>
              <span className="kn-pop-tag">
                {quote.weak ? '來源摘錄（未對到這句）' : '原文摘錄'}
                {!quote.fromOriginal && '・AI 整理版'}
              </span>
              <blockquote className="kn-pop-quote">{quote.text}</blockquote>
            </>
          )}
          <span className="kn-pop-actions">
            <button type="button" className="kn-mini" onClick={() => ctx.onViewSource(n)}>看原文</button>
            <button type="button" className="kn-mini" onClick={() => { void openSourceRaw(ctx.pw, src?.id ?? '').then(setMsg) }}>開原檔</button>
            <button type="button" className="kn-mini" onClick={() => ctx.onJump(n)}>跳到來源清單</button>
          </span>
          {msg && <span className="kn-pop-msg" role="status">{msg}</span>}
        </span>
      )}
    </span>
  )
}

/** 一條 bullet 的腳註。k0＝這條第一個標記在整份本文的序號（parseBodyWithMarkers 填的），沒有就不顯示摘錄 */
export function FootRefs({ refs, k0 }: { refs: number[]; k0?: number }) {
  if (refs.length === 0) return null
  return (
    <span className="kn-refs">
      {refs.map((n, i) => <FootRef key={`${n}-${i}`} n={n} k={k0 === undefined ? null : k0 + i} />)}
    </span>
  )
}

/* ───────── 來源清單／卷宗時間線 ───────── */

const MAX_SOURCES = 40

export function SourceList({ t, hl, onSelect, onView }: { t: Topic; hl: number | null; onSelect: (n: number) => void; onView: (n: number) => void }) {
  const [view, setView] = useState<'list' | 'timeline'>('list')
  const sources = useMemo(() => t.sources.slice(0, MAX_SOURCES), [t.sources])
  const prefix = useMemo(() => commonTitlePrefix(sources.map((s) => s.title)), [sources])
  const groups = useMemo(() => groupSourcesByCase(sources), [sources])
  const timeline = useMemo(() => caseTimeline(sources), [sources])
  if (sources.length === 0) return <p className="kn-muted">沒有列出來源。</p>
  const when = (s: Topic['sources'][number]) => s.date ?? s.month
  return (
    <div className="kn-srcwrap">
      <div className="kn-seg" role="group" aria-label="來源檢視">
        {([['list', '清單'], ['timeline', '時間線']] as const).map(([k, label]) => (
          <button key={k} type="button" aria-pressed={view === k} onClick={() => setView(k)}>{label}</button>
        ))}
      </div>
      {view === 'list' && (
        <>
          {prefix && <p className="kn-prefix">{prefix}…</p>}
          {groups.map((g) => (
            <div key={g.label} className="kn-case">
              {groups.length > 1 || g.case ? <h4 className="kn-case-title">{g.label}</h4> : null}
              <ul className="kn-sources">
                {g.items.map(({ source: s, n }) => {
                  const b = sourceBadge(s.type)
                  return (
                    <li key={s.id} id={`kn-src-${n}`} data-hl={hl === n}>
                      <span className="kn-sno">{n}</span>
                      <span className="kn-badge" title={b.label}><span aria-hidden="true">{b.icon}</span><span className="kn-badge-l">{b.label}</span></span>
                      <button type="button" className="kn-src-title" title="標亮本文中引用它的段落" onClick={() => onSelect(n)}>{prefix ? s.title.slice(prefix.length) : s.title}</button>
                      {when(s) && <span className="kn-date">{when(s)}</span>}
                      <button type="button" className="kn-mini" onClick={() => onView(n)}>看原文</button>
                    </li>
                  )
                })}
              </ul>
            </div>
          ))}
        </>
      )}
      {view === 'timeline' && timeline.map((g) => (
        <div key={g.label} className="kn-case">
          <h4 className="kn-case-title">{g.label}</h4>
          <ol className="kn-timeline kn-srctl">
            {g.items.map(({ source: s, n, stage }) => (
              <li key={s.id} id={`kn-src-${n}`} data-hl={hl === n}>
                <span className="kn-date">{s.date ?? '無日期'}</span>
                {stage && <span className="kn-stage">{stage}</span>}
                <button type="button" className="kn-src-title" onClick={() => onSelect(n)}>{s.title}</button>
                <button type="button" className="kn-mini" onClick={() => onView(n)}>看原文</button>
              </li>
            ))}
          </ol>
        </div>
      ))}
    </div>
  )
}
