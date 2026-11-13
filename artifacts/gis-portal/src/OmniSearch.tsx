import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type MouseEvent as ReactMouseEvent } from 'react'
import { apiSearch, apiSearchLog, apiSearchPreview } from './omniSearchApi'
import {
  KIND_ORDER, PREFIX_HINTS, addRecent, commandAnswer, filterCommands, flattenHits, isAbandoned, kindLabel, loadRecent, logKey, moveIndex,
  openAction, parseQuery, quickAnswer, saveRecent, shouldLog, type OmniCommand, type OpenAction, type PreviewRelated, type SearchKind, type SearchResponse,
} from './omniSearch'
import { Marked, OmniSearchReader, type PreviewState, type ReaderItem } from './OmniSearchReader'
import type { SiteData } from './portalApi'

// 首頁最上方「一個框搜全部」（2.86.0，取代原本的指令面板）。純邏輯在 omniSearch.ts、網路在 omniSearchApi.ts、閱讀面板在 OmniSearchReader.tsx。

const DEBOUNCE_MS = 250

type Status = 'idle' | 'loading' | 'error' | 'offline' | 'ok'

interface Session { q: string; kind: SearchKind | null; total: number; shownAt: number; clicked: boolean }

function reducedMotion(): boolean {
  try { return typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches } catch { return false }
}

/** 打字機效果：減少動態時直接顯示全文 */
function useTypewriter(text: string): string {
  const [n, setN] = useState(0)
  useEffect(() => {
    if (reducedMotion()) { setN(text.length); return }
    setN(0)
    let i = 0
    const t = setInterval(() => { i += 1; setN(i); if (i >= text.length) clearInterval(t) }, 14)
    return () => clearInterval(t)
  }, [text])
  return text.slice(0, n)
}

function glow(e: ReactMouseEvent<HTMLElement>) {
  const r = e.currentTarget.getBoundingClientRect()
  e.currentTarget.style.setProperty('--mx', `${e.clientX - r.left}px`)
  e.currentTarget.style.setProperty('--my', `${e.clientY - r.top}px`)
}

export function OmniSearch({ pw, sites, onSelectSite, onOpenIdeas, onOpenChat, onRequestUnlock }: {
  /** 管理密碼；null＝未解鎖 */
  pw: string | null
  sites: SiteData[]
  onSelectSite: (site: SiteData) => void
  onOpenIdeas: () => void
  /** 打開 HERMES 對話；帶 text 時一併放進輸入框 */
  onOpenChat: (text?: string) => void
  onRequestUnlock: () => void
}) {
  const [raw, setRaw] = useState('')
  const [focused, setFocused] = useState(false)
  const [status, setStatus] = useState<Status>('idle')
  const [resp, setResp] = useState<SearchResponse | null>(null)
  const [sel, setSel] = useState(0)
  const [detour, setDetour] = useState<PreviewRelated | null>(null)
  const [prev, setPrev] = useState<PreviewState | null>(null)
  const [expanded, setExpanded] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)
  const [pulse, setPulse] = useState(0)
  const [recent, setRecent] = useState<string[]>(() => loadRecent())

  const rootRef = useRef<HTMLElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const session = useRef<Session | null>(null)
  const lastLogKey = useRef<string | null>(null)
  const pwRef = useRef(pw)
  pwRef.current = pw

  const parsed = useMemo(() => parseQuery(raw), [raw])
  const searchQ = parsed.mode === 'search' ? parsed.q : ''
  const searchKind = parsed.mode === 'search' ? parsed.kind : null
  const cmds: OmniCommand[] = useMemo(() => (parsed.mode === 'command' ? filterCommands(parsed.q) : []), [parsed])
  const flat = useMemo(() => flattenHits(resp?.groups ?? []), [resp])
  const hitsLen = parsed.mode === 'command' ? cmds.length : status === 'ok' ? flat.length : 0

  // ── 紀錄（F10）──
  const flushAbandon = useCallback(() => {
    const s = session.current
    session.current = null
    const p = pwRef.current
    if (!s || !p || !isAbandoned(s.shownAt, Date.now(), s.clicked)) return
    const key = logKey(s.q, null, null)
    if (!shouldLog(lastLogKey.current, key)) return
    lastLogKey.current = key
    void apiSearchLog(p, { q: s.q, kind: s.kind, total: s.total, clickedKind: null, clickedId: null })
  }, [])
  useEffect(() => () => flushAbandon(), [flushAbandon])

  // ── 搜尋（F3）：停止輸入 250ms 後才打，新查詢取消舊請求 ──
  useEffect(() => {
    flushAbandon()
    setDetour(null)
    setExpanded(false)
    if (!searchQ || !pw) { setStatus('idle'); setResp(null); setSel(0); return }
    setStatus('loading')
    const ctl = new AbortController()
    const t = setTimeout(() => {
      setPulse((n) => n + 1)
      apiSearch(pw, searchQ, searchKind, ctl.signal)
        .then((r) => {
          if (ctl.signal.aborted) return
          if (r === null) { setStatus('offline'); setResp(null); return }
          setResp(r)
          setStatus('ok')
          setSel(r.groups.length > 0 ? 0 : -1)
          session.current = { q: searchQ, kind: searchKind, total: r.total, shownAt: Date.now(), clicked: false }
        })
        .catch(() => { if (!ctl.signal.aborted) setStatus('error') })
    }, DEBOUNCE_MS)
    return () => { clearTimeout(t); ctl.abort() }
  }, [pw, searchQ, searchKind, flushAbandon])

  // 指令模式：過濾字變了就選回第一個
  useEffect(() => { if (parsed.mode === 'command') setSel(0) }, [parsed.mode, parsed.mode === 'command' ? parsed.q : ''])

  // ── 目前選中的那一筆（脈絡圖跳過去的那筆優先）──
  const cur: ReaderItem | null = detour ?? (parsed.mode === 'search' && status === 'ok' && sel >= 0 ? flat[sel] ?? null : null)
  const curKind = cur?.kind
  const curId = cur?.id
  useEffect(() => { setExpanded(false) }, [curKind, curId])
  useEffect(() => {
    if (!curKind || !curId || !pw) { setPrev(null); return }
    const ctl = new AbortController()
    setPrev({ kind: curKind, id: curId, state: 'loading', data: null })
    apiSearchPreview(pw, curKind, curId, ctl.signal)
      .then((d) => { if (!ctl.signal.aborted) setPrev({ kind: curKind, id: curId, state: d ? 'ok' : 'missing', data: d }) })
      .catch(() => { if (!ctl.signal.aborted) setPrev({ kind: curKind, id: curId, state: 'error', data: null }) })
    return () => ctl.abort()
  }, [pw, curKind, curId])

  useEffect(() => { document.getElementById(`om-opt-${sel}`)?.scrollIntoView({ block: 'nearest' }) }, [sel])

  // ── Ctrl/⌘+K（F6、F13）──
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        rootRef.current?.scrollIntoView({ block: 'center', behavior: reducedMotion() ? 'auto' : 'smooth' })
        inputRef.current?.focus()
        inputRef.current?.select()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  useEffect(() => {
    if (!notice) return
    const t = setTimeout(() => setNotice(null), 2600)
    return () => clearTimeout(t)
  }, [notice])

  // ── 開啟（F8、F10、F11）──
  const run = (a: OpenAction, q: string) => {
    switch (a.type) {
      case 'hash': window.location.hash = a.hash; break
      case 'ideas': onOpenIdeas(); break
      case 'chat': onOpenChat(q || undefined); break
      case 'tool': {
        const site = sites.find((s) => String(s.id) === a.id)
        if (site) onSelectSite(site)
        else setNotice('找不到這個工具連結')
        break
      }
      case 'expand': setExpanded((v) => !v); break
    }
  }
  const openItem = (h: ReaderItem) => {
    const s = session.current
    if (s && pw) {
      const key = logKey(s.q, h.kind, h.id)
      if (shouldLog(lastLogKey.current, key)) {
        lastLogKey.current = key
        void apiSearchLog(pw, { q: s.q, kind: s.kind, total: s.total, clickedKind: h.kind, clickedId: h.id })
      }
      s.clicked = true
      const next = addRecent(recent, raw.trim())
      setRecent(next)
      saveRecent(next)
    }
    run(openAction(h.kind, h.id), '')
  }
  const runCommand = (c: OmniCommand) => run(c.action, '')

  const pick = (i: number) => { setDetour(null); setSel(i) }
  const jump = (r: PreviewRelated) => {
    const i = flat.findIndex((h) => h.kind === r.kind && h.id === r.id)
    if (i >= 0) pick(i)
    else setDetour(r)
  }

  const onKeyDown = (e: ReactKeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      if (hitsLen === 0) return
      e.preventDefault()
      setDetour(null)
      setSel((s) => moveIndex(s, e.key === 'ArrowDown' ? 1 : -1, hitsLen))
    } else if (e.key === 'Enter') {
      if (e.nativeEvent.isComposing) return
      if (parsed.mode === 'command') { const c = cmds[sel >= 0 ? sel : 0]; if (c) { e.preventDefault(); runCommand(c) } }
      else if (cur) { e.preventDefault(); openItem(cur) }
    } else if (e.key === 'Escape') {
      setRaw('')
    }
  }

  const startWith = (text: string) => { setRaw(text); inputRef.current?.focus() }

  // ── 顯示用文字 ──
  const noResult = parsed.mode === 'search' && status === 'ok' && flat.length === 0
  const answer =
    parsed.mode === 'empty' ? ''
    : parsed.mode === 'command' ? commandAnswer(cmds)
    : !pw ? '解鎖後可搜尋知識庫'
    : status === 'loading' ? '搜尋中…'
    : status === 'error' ? '搜尋暫時失敗，稍後再試。'
    : status === 'offline' ? '搜尋服務還沒上線'
    : status === 'ok' ? quickAnswer(resp?.best ?? null)
    : ''
  const shown = useTypewriter(answer)
  const searching = parsed.mode !== 'empty'
  const locked = !pw && parsed.mode !== 'command'
  const showLockNote = locked && (focused || searching)
  const showPanel = searching && (parsed.mode === 'command' || !!pw)
  const busy = status === 'loading' && resp !== null

  let idx = -1
  return (
    <section ref={rootRef} className="om-root" data-searching={searching ? 'true' : 'false'} aria-label="全站搜尋">
      {pulse > 0 && <span key={pulse} className="om-pulse" aria-hidden="true" />}
      {!searching && <h2 className="om-title">一個框<em>・</em>搜全部</h2>}
      <div className={`om-ask${focused ? ' om-focus' : ''}`}>
        <div className="om-in">
          <span className="om-pfx" aria-hidden="true">{parsed.prefix ?? '⌕'}</span>
          <input
            ref={inputRef} type="text" value={raw} autoComplete="off" spellCheck={false}
            aria-label="搜尋全部：人、案件、知識、原文、想法、地點、工具"
            role="combobox" aria-expanded={showPanel && hitsLen > 0} aria-controls="om-listbox" aria-autocomplete="list"
            aria-activedescendant={showPanel && hitsLen > 0 && sel >= 0 ? `om-opt-${sel}` : undefined}
            placeholder="找人、案件、知識、原文、想法、地點、工具…"
            onChange={(e) => setRaw(e.target.value)} onKeyDown={onKeyDown}
            onFocus={() => setFocused(true)} onBlur={() => setFocused(false)}
          />
          <kbd aria-hidden="true">Ctrl K</kbd>
        </div>
      </div>

      {showLockNote && (
        <p className="om-lock" role="status">
          🔒 解鎖後可搜尋知識庫（<b>&gt;</b> 指令不用解鎖）
          <button type="button" className="om-gh" onClick={onRequestUnlock}>解鎖</button>
        </p>
      )}

      {!searching && (
        <>
          <div className="om-modes">
            {PREFIX_HINTS.map((m) => (
              <button key={m.prefix} type="button" className="om-mode" onClick={() => startWith(m.prefix)}><b>{m.prefix}</b>{m.label}</button>
            ))}
          </div>
          {recent.length > 0 && (
            <div className="om-recent" aria-label="最近找過">
              <span className="om-lb">最近找過</span>
              {recent.map((r) => <button key={r} type="button" className="om-chip" onClick={() => startWith(r)}>{r}</button>)}
            </div>
          )}
        </>
      )}

      <div className="om-guess" aria-live="polite" hidden={!searching}>
        <span className="om-lb">即答</span>
        <span className="om-ans">{shown}</span>
        <span className="om-caret" aria-hidden="true" />
      </div>
      {notice && <div className="om-toast" role="status">{notice}</div>}

      {showPanel && (
        <div className={`om-results${parsed.mode === 'command' ? ' om-results-cmd' : ''}`}>
          <div className={`om-panel om-rs${busy ? ' om-busy' : ''}`} onMouseMove={glow}>
            <div id="om-listbox" role="listbox" aria-label={parsed.mode === 'command' ? '指令' : '搜尋結果'}>
              {parsed.mode === 'command' && cmds.length === 0 && <div className="om-none">沒有符合的指令</div>}
              {parsed.mode === 'command' && cmds.map((c, i) => (
                <div key={c.id} id={`om-opt-${i}`} role="option" aria-selected={i === sel} className={`om-hit${i === sel ? ' om-on' : ''}`}
                  style={{ animationDelay: `${Math.min(i, 12) * 35}ms` }} onClick={() => { setSel(i); runCommand(c) }}>
                  <span className="om-kd">指令</span>
                  <span><div className="om-t">{c.label}</div><div className="om-s">{c.hint}</div></span>
                </div>
              ))}
              {parsed.mode === 'search' && status === 'loading' && !resp && <div className="om-none" role="presentation">搜尋中…</div>}
              {parsed.mode === 'search' && status === 'error' && <div className="om-none" role="presentation">搜尋暫時失敗，稍後再試。</div>}
              {parsed.mode === 'search' && status === 'offline' && <div className="om-none" role="presentation">搜尋服務還沒上線</div>}
              {noResult && (
                <div className="om-none" role="presentation">
                  知識庫裡沒有「{searchQ}」<br />
                  <span className="om-lb">已記下這次查無結果</span><br /><br />
                  <button type="button" className="om-cta" onClick={() => onOpenChat(searchQ)}>交給 HERMES 找</button>
                </div>
              )}
              {parsed.mode === 'search' && (status === 'ok' || busy) && resp && KIND_ORDER.map((k) => {
                const g = resp.groups.find((x) => x.kind === k)
                if (!g) return null
                return (
                  <div key={k} role="group" aria-label={kindLabel(k)}>
                    <div className="om-grp" aria-hidden="true"><span className="om-lb">{kindLabel(k)}</span><span className="om-lb">{g.count}</span></div>
                    {g.items.map((h) => {
                      idx += 1
                      const i = idx
                      const on = !detour && i === sel
                      return (
                        <div key={`${h.kind}:${h.id}`} id={`om-opt-${i}`} role="option" aria-selected={on} className={`om-hit${on ? ' om-on' : ''}`}
                          style={{ animationDelay: `${Math.min(i, 12) * 35}ms` }} onClick={() => pick(i)}>
                          <span className="om-kd">{kindLabel(h.kind)}</span>
                          <span>
                            <div className="om-t"><Marked text={h.title} q={searchQ} /></div>
                            {h.snippet && <div className="om-s"><Marked text={h.snippet} q={searchQ} /></div>}
                          </span>
                        </div>
                      )
                    })}
                  </div>
                )
              })}
            </div>
          </div>
          {parsed.mode === 'search' && (
            <div className="om-panel om-reader" onMouseMove={glow}>
              <OmniSearchReader
                item={status === 'ok' ? cur : null} preview={prev} q={searchQ} expanded={expanded}
                onToggleExpand={() => setExpanded((v) => !v)} onOpen={() => { if (cur) openItem(cur) }} onJump={jump}
              />
            </div>
          )}
        </div>
      )}
    </section>
  )
}
