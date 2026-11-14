import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type MouseEvent as ReactMouseEvent } from 'react'
import { apiSearch, apiSearchLog, apiSearchPreview } from './omniSearchApi'
import { apiFetchHermesGraph } from './hermesGraphApi'
import { buildIndex } from './graphInsights'
import { apiFetchTopicsData } from './statsApi'
import { apiFetchTrips } from './tripsApi'
import { HitCard } from './SearchCards'
import { SearchOverview, type DateFilter } from './SearchOverview'
import { cardModel, taipeiYm, type CardCtx, type CardModel } from './searchViz'
import {
  KIND_ORDER, PREFIX_HINTS, addRecent, commandAnswer, filterCommands, flattenHits, isAbandoned, kindLabel, loadRecent, logKey, moveIndex,
  keepKnownTools, openAction, parseQuery, quickAnswer, saveRecent, shouldLog, type OmniCommand, type OpenAction, type PreviewRelated, type SearchKind, type SearchResponse,
} from './omniSearch'
import { requestGraphFocus } from './graphFocus'
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

export function OmniSearch({ pw, sites, onSelectSite, onOpenIdeas, onOpenChat, onRequestUnlock, seed }: {
  /** 管理密碼；null＝未解鎖 */
  pw: string | null
  sites: SiteData[]
  onSelectSite: (site: SiteData) => void
  onOpenIdeas: () => void
  /** 打開 HERMES 對話；帶 text 時一併放進輸入框 */
  onOpenChat: (text?: string) => void
  onRequestUnlock: () => void
  /** 外部帶入搜尋詞（STATUS 的「最近」小籤）：n 每次加 1 就把 q 放進搜尋框並執行搜尋 */
  seed?: { q: string; n: number }
}) {
  const [raw, setRaw] = useState('')
  const [focused, setFocused] = useState(false)
  const [status, setStatus] = useState<Status>('idle')
  const [rawResp, setRawResp] = useState<SearchResponse | null>(null)
  const [sel, setSel] = useState(0)
  const [detour, setDetour] = useState<PreviewRelated | null>(null)
  const [prev, setPrev] = useState<PreviewState | null>(null)
  const [expanded, setExpanded] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)
  const [pulse, setPulse] = useState(0)
  const [recent, setRecent] = useState<string[]>(() => loadRecent())
  // 總覽條的篩選（類別、月份）；key 對不上目前的搜尋詞＝已失效（詞一改就自動清掉）
  const [flt, setFlt] = useState<{ key: string; kind: SearchKind | null; date: DateFilter | null }>({ key: '', kind: null, date: null })
  const [listState, setListState] = useState<{ key: string; resp: SearchResponse } | null>(null)
  const [ctx, setCtx] = useState<CardCtx | null>(null)

  const rootRef = useRef<HTMLElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const session = useRef<Session | null>(null)
  const lastLogKey = useRef<string | null>(null)
  const interacted = useRef(false)
  const lastQKey = useRef('')
  const ctxStarted = useRef(false)
  const mounted = useRef(true)
  useEffect(() => { mounted.current = true; return () => { mounted.current = false } }, [])
  const pwRef = useRef(pw)
  pwRef.current = pw
  const sitesRef = useRef(sites)
  sitesRef.current = sites

  // 外部帶入（seed.n 變了才動作；同一個詞連點兩次 n 也會變）
  useEffect(() => {
    if (!seed || seed.n <= 0) return
    setRaw(seed.q)
    inputRef.current?.focus()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [seed?.n])

  const parsed = useMemo(() => parseQuery(raw), [raw])
  const searchQ = parsed.mode === 'search' ? parsed.q : ''
  const searchKind = parsed.mode === 'search' ? parsed.kind : null
  const cmds: OmniCommand[] = useMemo(() => (parsed.mode === 'command' ? filterCommands(parsed.q) : []), [parsed])
  // 存的是原始回應；工具只留 sites 認識的。sites 還沒載完（空陣列）時先不濾，
  // 等 sites 到了再依它重算——否則回應比清單先到，工具會被整組濾掉且不會補回。
  const knownToolIds = useMemo(() => new Set(sites.map((x) => String(x.id))), [sites])
  const resp = useMemo(
    () => (rawResp === null || knownToolIds.size === 0 ? rawResp : keepKnownTools(rawResp, knownToolIds)),
    [rawResp, knownToolIds],
  )
  const fkey = `${searchKind ?? ''}|${searchQ}`
  const kindFilter = flt.key === fkey ? flt.kind : null
  const dateFilter = flt.key === fkey ? flt.date : null
  const dateType = dateFilter?.type ?? null
  const dateYm = dateFilter?.ym ?? null
  const listKey = `${fkey}|${dateType ?? ''}:${dateYm ?? ''}|${kindFilter ?? ''}`
  const listResp = useMemo(
    () => (listState === null || listState.key !== listKey ? null : knownToolIds.size === 0 ? listState.resp : keepKnownTools(listState.resp, knownToolIds)),
    [listState, listKey, knownToolIds],
  )
  // 選了類別：列表用另打的 kind 查詢（limit 20）；還沒回來先用基本查詢裡那一類
  const groups = useMemo(
    () => (kindFilter ? (listResp?.groups ?? (resp?.groups ?? []).filter((g) => g.kind === kindFilter)) : (resp?.groups ?? [])),
    [kindFilter, listResp, resp],
  )
  const flat = useMemo(() => flattenHits(groups), [groups])
  const models = useMemo(() => {
    const m = new Map<string, CardModel>()
    if (ctx) for (const h of flat) m.set(`${h.kind}:${h.id}`, cardModel(h, ctx))
    return m
  }, [flat, ctx])
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
    if (lastQKey.current !== fkey) { interacted.current = false; lastQKey.current = fkey }
    setDetour(null)
    setExpanded(false)
    if (!searchQ || !pw) { setStatus('idle'); setRawResp(null); setSel(0); return }
    setStatus('loading')
    const ctl = new AbortController()
    const t = setTimeout(() => {
      setPulse((n) => n + 1)
      apiSearch(pw, searchQ, searchKind, ctl.signal, dateType === 'month' ? { month: dateYm ?? undefined } : dateType === 'before' ? { before: dateYm ?? undefined } : {})
        .then((r) => {
          if (ctl.signal.aborted) return
          if (r === null) { setStatus('offline'); setRawResp(null); return }
          setRawResp(r)
          setStatus('ok')
          // 先照「當下」的 sites 推導一次（sites 未到＝原樣不濾）；之後 sites 到了，
          // 畫面會用 useMemo 重算，不必重打 API。
          const known = new Set(sitesRef.current.map((x) => String(x.id)))
          const shown = known.size === 0 ? r : keepKnownTools(r, known)
          setSel(shown.groups.length > 0 ? 0 : -1)
          session.current = { q: searchQ, kind: searchKind, total: shown.total, shownAt: Date.now(), clicked: interacted.current }
        })
        .catch(() => { if (!ctl.signal.aborted) setStatus('error') })
    }, DEBOUNCE_MS)
    return () => { clearTimeout(t); ctl.abort() }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pw, searchQ, searchKind, dateType, dateYm, flushAbandon])

  // 選了類別：另打 kind 查詢取列表（含月份篩選）
  useEffect(() => {
    if (!kindFilter || !pw || !searchQ) { setListState(null); return }
    const ctl = new AbortController()
    const opts = { limit: 20, ...(dateType === 'month' ? { month: dateYm ?? undefined } : dateType === 'before' ? { before: dateYm ?? undefined } : {}) }
    apiSearch(pw, searchQ, kindFilter, ctl.signal, opts)
      .then((r) => { if (!ctl.signal.aborted) setListState(r ? { key: listKey, resp: r } : null) })
      .catch(() => { if (!ctl.signal.aborted) setListState(null) })
    return () => ctl.abort()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pw, searchQ, kindFilter, dateType, dateYm])

  // 視覺卡要的資料：第一次有結果時抓一次，抓不到就維持文字列
  const hasResults = status === 'ok' && (resp?.total ?? 0) > 0
  useEffect(() => {
    if (!hasResults || !pw || ctxStarted.current) return
    ctxStarted.current = true
    void Promise.allSettled([apiFetchHermesGraph(pw), apiFetchTopicsData(pw), apiFetchTrips(pw)]).then(([g, t, r]) => {
      if (!mounted.current) return
      let index = null
      try { if (g.status === 'fulfilled' && g.value.graph) index = buildIndex(g.value.graph) } catch { index = null }
      const topics = t.status === 'fulfilled' ? (t.value.value?.topics ?? null) : null
      const trips = r.status === 'fulfilled' && !r.value.sample ? r.value.trips : null
      setCtx({ index, topics, trips })
    })
  }, [hasResults, pw])

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
        // sites 裡沒有這個工具（清單尚未載入或已被撤掉）只顯示提示，不開空白頁
        const site = sites.find((s) => String(s.id) === a.id)
        if (site) onSelectSite(site)
        else setNotice('找不到這個工具連結')
        break
      }
      case 'expand': setExpanded((v) => !v); break
      case 'graph': requestGraphFocus({ kind: a.kind, id: a.id }); window.location.hash = '#graph'; break
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

  // 點總覽條算互動：不要被當成「沒點開」記放棄
  const touch = () => { interacted.current = true; if (session.current) session.current.clicked = true }
  const pickKind = (k: SearchKind | null) => {
    touch(); setDetour(null); setSel(0)
    setFlt((f) => ({ key: fkey, kind: k, date: f.key === fkey ? f.date : null }))
  }
  const pickDate = (d: DateFilter | null) => {
    touch(); setDetour(null)
    setFlt((f) => ({ key: fkey, date: d, kind: f.key === fkey ? f.kind : null }))
  }

  // ── 顯示用文字 ──
  const noResult = parsed.mode === 'search' && status === 'ok' && flat.length === 0
  const filtering = kindFilter !== null || dateFilter !== null
  const answer =
    parsed.mode === 'empty' ? ''
    : parsed.mode === 'command' ? commandAnswer(cmds)
    : !pw ? ''
    : status === 'loading' ? '搜尋中…'
    : status === 'error' ? '搜尋暫時失敗，稍後再試。'
    : status === 'offline' ? '搜尋服務還沒上線'
    : status === 'ok' ? quickAnswer(resp?.best ?? null)
    : ''
  const shown = useTypewriter(answer)
  const busy = status === 'loading' && resp !== null
  const showOverview = parsed.mode === 'search' && (status === 'ok' || busy) && !!resp && (resp.total > 0 || filtering)
  const searching = parsed.mode !== 'empty'
  const locked = !pw && parsed.mode !== 'command'
  const showLockNote = locked && (focused || searching)
  const showPanel = searching && (parsed.mode === 'command' || !!pw)

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

      <div className="om-guess" aria-live="polite" hidden={!searching || answer === ''}>
        <span className="om-lb">即答</span>
        <span className="om-ans">{shown}</span>
        <span className="om-caret" aria-hidden="true" />
      </div>
      {notice && <div className="om-toast" role="status">{notice}</div>}

      {showPanel && (
        <div className={`om-results${parsed.mode === 'command' ? ' om-results-cmd' : ''}`}>
          <div className={`om-panel om-rs${busy ? ' om-busy' : ''}`} onMouseMove={glow}>
            {showOverview && resp && (
              <SearchOverview resp={resp} kindFilter={kindFilter} date={dateFilter} todayYm={taipeiYm()} onKind={pickKind} onDate={pickDate} />
            )}
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
              {noResult && filtering && <div className="om-none" role="presentation">這個篩選沒有結果，按上面的「全部」取消篩選。</div>}
              {noResult && !filtering && (
                <div className="om-none" role="presentation">
                  知識庫裡沒有「{searchQ}」<br />
                  <span className="om-lb">已記下這次查無結果</span><br /><br />
                  <button type="button" className="om-cta" onClick={() => onOpenChat(searchQ)}>交給 HERMES 找</button>
                </div>
              )}
              {parsed.mode === 'search' && (status === 'ok' || busy) && resp && KIND_ORDER.map((k) => {
                const g = groups.find((x) => x.kind === k)
                if (!g) return null
                return (
                  <div key={k} role="group" aria-label={kindLabel(k)}>
                    <div className="om-grp" aria-hidden="true"><span className="om-lb">{kindLabel(k)}</span><span className="om-lb">{g.count}</span></div>
                    {g.items.map((h) => {
                      idx += 1
                      const i = idx
                      const on = !detour && i === sel
                      return (
                        <HitCard key={`${h.kind}:${h.id}`} hit={h} i={i} on={on} q={searchQ} model={models.get(`${h.kind}:${h.id}`) ?? null} onPick={pick} onSearch={startWith} />
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
