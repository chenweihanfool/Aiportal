import { useEffect, useMemo, useRef, useState } from 'react'
import { apiFetchHermesDoc, apiFetchHermesRaw, type HermesSourceDoc } from './hermesDocApi'
import { rawOpenMode, sourceBadge, splitByRanges } from './knowledgeSource'
import { highlightRanges } from './knowledgeView'

// 原文面板（2.77.0）：來源全文、原檔檔名與路徑、引用它的題目、開原檔。

/** 取原檔並開啟（pdf／圖片開新分頁，其他下載）。成功回 null，失敗回中文提示。 */
export async function openRawFile(pw: string, rawPath: string, originName: string | null): Promise<string | null> {
  const r = await apiFetchHermesRaw(pw, rawPath)
  if (!r.ok) return r.message
  const url = URL.createObjectURL(r.blob)
  if (rawOpenMode(rawPath) === 'open') {
    window.open(url, '_blank', 'noopener')
  } else {
    const a = document.createElement('a')
    a.href = url
    a.download = originName ?? rawPath.split('/').pop() ?? 'file'
    document.body.appendChild(a)
    a.click()
    a.remove()
    setTimeout(() => URL.revokeObjectURL(url), 10_000)
  }
  return null
}

/** 腳註小卡用：先查 source doc 拿 rawPath，再開原檔。 */
export async function openSourceRaw(pw: string, sourceKey: string): Promise<string | null> {
  try {
    const doc = await apiFetchHermesDoc(pw, 'source', sourceKey)
    if (!doc) return '這份來源還沒同步到入口網。'
    if (!doc.meta.rawPath) return '這份來源沒有原檔可開。'
    return await openRawFile(pw, doc.meta.rawPath, doc.meta.originName)
  } catch {
    return '暫時無法取得來源資料，稍後再試。'
  }
}

type State = { status: 'loading' } | { status: 'missing' } | { status: 'error' } | { status: 'ok'; doc: HermesSourceDoc }

export function KnowledgeSourcePanel({ pw, sourceKey, query, onClose, onOpenTopic }: {
  pw: string
  sourceKey: string
  /** 從搜尋點進來時帶入的搜尋詞；空字串＝不標亮 */
  query: string
  onClose: () => void
  onOpenTopic: (id: string) => void
}) {
  const [state, setState] = useState<State>({ status: 'loading' })
  const [rawMsg, setRawMsg] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)
  const [busy, setBusy] = useState(false)
  const firstHit = useRef<HTMLElement | null>(null)
  const closeBtn = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    let cancelled = false
    setState({ status: 'loading' })
    setRawMsg(null)
    apiFetchHermesDoc(pw, 'source', sourceKey)
      .then((doc) => { if (!cancelled) setState(doc ? { status: 'ok', doc } : { status: 'missing' }) })
      .catch(() => { if (!cancelled) setState({ status: 'error' }) })
    return () => { cancelled = true }
  }, [pw, sourceKey])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', onKey)
    closeBtn.current?.focus()
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])

  const doc = state.status === 'ok' ? state.doc : null
  const segments = useMemo(() => (doc ? splitByRanges(doc.bodyMd, highlightRanges(doc.bodyMd, query)) : []), [doc, query])
  useEffect(() => { firstHit.current?.scrollIntoView({ block: 'center' }) }, [segments])

  const meta = doc?.meta
  const badge = sourceBadge(meta?.type)
  let seenHit = false

  const copy = () => {
    if (!doc?.sourcePath) return
    void navigator.clipboard?.writeText(doc.sourcePath).then(() => setCopied(true), () => setCopied(false))
  }
  const openRaw = () => {
    if (!meta?.rawPath || busy) return
    setBusy(true)
    setRawMsg(null)
    void openRawFile(pw, meta.rawPath, meta.originName).then(setRawMsg).finally(() => setBusy(false))
  }

  return (
    <div className="kn-overlay" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose() }}>
      <aside className="kn-panel" role="dialog" aria-modal="true" aria-label="來源原文">
        <header className="kn-panel-head">
          <h3>{doc ? <><span aria-hidden="true">{badge.icon}</span> {doc.title}</> : '來源原文'}</h3>
          <button type="button" className="kn-mini" ref={closeBtn} onClick={onClose} aria-label="關閉">✕ 關閉</button>
        </header>
        <div className="kn-panel-body">
          {state.status === 'loading' && <p className="kn-muted">讀取中…</p>}
          {state.status === 'missing' && <p className="kn-muted">這份來源還沒同步到入口網（kb-pipeline 推送後才會有原文）。</p>}
          {state.status === 'error' && <p className="kn-muted kn-bad">暫時無法取得原文，稍後再試。</p>}
          {doc && meta && (
            <>
              <dl className="kn-panel-meta">
                {meta.originName && <><dt>原檔</dt><dd>{meta.originName}</dd></>}
                {doc.sourcePath && (
                  <><dt>路徑</dt><dd className="kn-path">{doc.sourcePath} <button type="button" className="kn-mini" onClick={copy}>{copied ? '已複製' : '複製路徑'}</button></dd></>
                )}
                {meta.case && <><dt>案件</dt><dd>{meta.case}</dd></>}
                {meta.date && <><dt>日期</dt><dd>{meta.date}</dd></>}
              </dl>
              {meta.rawPath && (
                <p>
                  <button type="button" className="kn-btn" disabled={busy} onClick={openRaw}>{busy ? '取得中…' : '開原檔'}</button>
                  {rawMsg && <span className="kn-bad kn-raw-msg" role="status"> {rawMsg}</span>}
                </p>
              )}
              {meta.textFrom === 'event' && <p className="kn-notice">找不到原檔，以下是 AI 整理版</p>}
              {doc.truncated && <p className="kn-muted">原文過長，這裡只顯示前段。</p>}
              <pre className="kn-fulltext">
                {segments.length === 0 ? '（沒有原文）' : segments.map((s, i) => {
                  if (!s.hit) return s.text
                  const first = !seenHit
                  seenHit = true
                  return <mark key={i} className="kn-hit" ref={first ? (el) => { firstHit.current = el } : undefined}>{s.text}</mark>
                })}
              </pre>
              <h4 className="kn-case-title">引用它的題目</h4>
              {meta.topics.length === 0 ? <p className="kn-muted">沒有題目引用。</p> : (
                <ul className="kn-related">
                  {meta.topics.map((t) => (
                    <li key={t.id}><button type="button" className="kn-link" onClick={() => onOpenTopic(t.id)}>{t.name}</button></li>
                  ))}
                </ul>
              )}
            </>
          )}
        </div>
      </aside>
    </div>
  )
}
