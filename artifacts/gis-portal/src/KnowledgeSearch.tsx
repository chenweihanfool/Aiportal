import { useEffect, useMemo, useState } from 'react'
import { apiSearchHermesDocs, type HermesSearchResult } from './hermesDocApi'
import { sourceBadge, splitByRanges } from './knowledgeSource'
import { highlightRanges } from './knowledgeView'

// 左欄「原文」搜尋（2.77.0）：停止輸入 300ms 後才打 API，q 空白不打。

export const SEARCH_DEBOUNCE_MS = 300

type State = { status: 'idle' } | { status: 'loading' } | { status: 'error' } | { status: 'ok'; results: HermesSearchResult[] }

function Marked({ text, q }: { text: string; q: string }) {
  const segs = useMemo(() => splitByRanges(text, highlightRanges(text, q)), [text, q])
  return <>{segs.map((s, i) => (s.hit ? <mark key={i} className="kn-hit">{s.text}</mark> : s.text))}</>
}

export function SourceSearchResults({ pw, q, onPick }: { pw: string; q: string; onPick: (key: string, q: string) => void }) {
  const [state, setState] = useState<State>({ status: 'idle' })
  const term = q.trim()
  useEffect(() => {
    if (!term) { setState({ status: 'idle' }); return }
    const ctl = new AbortController()
    const timer = setTimeout(() => {
      setState({ status: 'loading' })
      apiSearchHermesDocs(pw, term, ctl.signal)
        .then((results) => { if (!ctl.signal.aborted) setState({ status: 'ok', results }) })
        .catch(() => { if (!ctl.signal.aborted) setState({ status: 'error' }) })
    }, SEARCH_DEBOUNCE_MS)
    return () => { clearTimeout(timer); ctl.abort() }
  }, [pw, term])

  if (state.status === 'idle') return <p className="kn-muted">輸入關鍵字，搜尋所有來源的原文。</p>
  if (state.status === 'loading') return <p className="kn-muted">搜尋中…</p>
  if (state.status === 'error') return <p className="kn-muted kn-bad" role="status">搜尋暫時失敗，稍後再試。</p>
  if (state.results.length === 0) return <p className="kn-muted">原文裡沒有找到。</p>
  return (
    <ul className="kn-hits">
      {state.results.map((r) => {
        const b = sourceBadge(r.meta?.type)
        return (
          <li key={r.key}>
            <button type="button" className="kn-hit-item" onClick={() => onPick(r.key, term)}>
              <span className="kn-hit-title"><Marked text={r.title} q={term} /></span>
              <span className="kn-hit-meta"><span aria-hidden="true">{b.icon}</span> {b.label}{r.meta?.date ? `・${r.meta.date}` : ''}</span>
              <span className="kn-hit-snip"><Marked text={r.snippet} q={term} /></span>
            </button>
          </li>
        )
      })}
    </ul>
  )
}
