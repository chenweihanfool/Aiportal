import { useCallback, useEffect, useRef, useState } from 'react'
import { COLOR, FONT } from './theme'
import { GraphShell } from './GraphShell'
import { MarkdownView } from './MarkdownView'
import { requestGraphFocus } from './graphFocus'
import {
  apiFetchTimelineDetail, apiFetchTimelineList,
  type TimelineDetail, type TimelineItem, type TimelineLevel,
} from './timelineApi'
import {
  LEVELS, LEVEL_LABEL, groupItems, itemKey, mergePages, neighbors, oneLine, rowDateLabel, scoreBadge,
} from './timelineLogic'

const LEVEL_KEY = 'kb.timeline.level'
const TONE: Record<'ok' | 'warn' | 'concern', string> = { ok: COLOR.ok, warn: COLOR.warn, concern: COLOR.concern }

function readLevel(): TimelineLevel {
  try {
    const v = sessionStorage.getItem(LEVEL_KEY)
    if (v === 'day' || v === 'week' || v === 'month' || v === 'quarter' || v === 'year') return v
  } catch { /* ignore */ }
  return 'day'
}

function useIsMobile(): boolean {
  const [m, setM] = useState(() => window.matchMedia('(max-width: 640px)').matches)
  useEffect(() => {
    const mq = window.matchMedia('(max-width: 640px)')
    const on = () => setM(mq.matches)
    mq.addEventListener('change', on)
    return () => mq.removeEventListener('change', on)
  }, [])
  return m
}

interface Ref { level: TimelineLevel; periodKey: string }

export function TimelineView({ unlockedPassword, onBack }: { unlockedPassword: string | null; onBack: () => void }) {
  const [level, setLevel] = useState<TimelineLevel>(readLevel)
  const [items, setItems] = useState<TimelineItem[]>([])
  const [nextCursor, setNextCursor] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(false)
  const [loadedLevel, setLoadedLevel] = useState<TimelineLevel | null>(null)
  // 對話框：stack 最上層是目前顯示的期間；下鑽時 push，「返回」時 pop
  const [stack, setStack] = useState<Ref[]>([])
  const [detail, setDetail] = useState<TimelineDetail | null>(null)
  const [detailError, setDetailError] = useState(false)
  const genRef = useRef(0)
  const sentinelRef = useRef<HTMLDivElement>(null)
  const listRef = useRef<HTMLDivElement>(null)
  const lastFocusRef = useRef<HTMLElement | null>(null)
  const isMobile = useIsMobile()

  const loadPage = useCallback(async (lv: TimelineLevel, cursor: string | null, replace: boolean) => {
    if (!unlockedPassword) return
    const gen = ++genRef.current
    setLoading(true); setError(false)
    try {
      const r = await apiFetchTimelineList(unlockedPassword, lv, cursor)
      if (gen !== genRef.current) return                       // 已切換級別，丟棄過期回應
      setItems(prev => (replace ? r.items : mergePages(prev, r.items)))
      setNextCursor(r.nextCursor)
      setLoadedLevel(lv)
    } catch {
      if (gen === genRef.current) setError(true)
    } finally {
      if (gen === genRef.current) setLoading(false)
    }
  }, [unlockedPassword])

  useEffect(() => {
    setItems([]); setNextCursor(null); setLoadedLevel(null)
    void loadPage(level, null, true)
    try { sessionStorage.setItem(LEVEL_KEY, level) } catch { /* ignore */ }
  }, [level, loadPage])

  // 捲到底自動載入下一頁
  useEffect(() => {
    const el = sentinelRef.current
    if (!el || !nextCursor) return
    const io = new IntersectionObserver(es => {
      if (es[0]?.isIntersecting && !loading) void loadPage(level, nextCursor, false)
    }, { root: listRef.current, rootMargin: '200px' })
    io.observe(el)
    return () => io.disconnect()
  }, [nextCursor, loading, level, loadPage])

  const top = stack[stack.length - 1] ?? null
  const topKey = top ? `${top.level}/${top.periodKey}` : null

  useEffect(() => {
    if (!top || !unlockedPassword) { setDetail(null); return }
    let cancelled = false
    setDetail(null); setDetailError(false)
    apiFetchTimelineDetail(unlockedPassword, top.level, top.periodKey)
      .then(d => { if (!cancelled) setDetail(d) })
      .catch(() => { if (!cancelled) setDetailError(true) })
    return () => { cancelled = true }
  }, [topKey]) // eslint-disable-line react-hooks/exhaustive-deps

  const openItem = useCallback((it: TimelineItem, el: HTMLElement | null) => {
    lastFocusRef.current = el
    setStack([{ level: it.level, periodKey: it.periodKey }])
  }, [])
  const closeDialog = useCallback(() => {
    setStack([])
    setTimeout(() => lastFocusRef.current?.focus(), 0)
  }, [])
  const goTo = useCallback((ref: Ref) => setStack([ref]), [])
  const drill = useCallback((ref: Ref) => setStack(s => [...s, ref]), [])
  const back = useCallback(() => setStack(s => (s.length > 1 ? s.slice(0, -1) : s)), [])

  const nav = top && top.level === loadedLevel ? neighbors(items, topKey!) : { older: null, newer: null }

  // 鍵盤：Esc 關閉、←／→ 在同級相鄰期間切換（older／newer）
  useEffect(() => {
    if (!top) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.preventDefault(); closeDialog() }
      else if (e.key === 'ArrowLeft' && nav.older) { e.preventDefault(); goTo({ level: nav.older.level, periodKey: nav.older.periodKey }) }
      else if (e.key === 'ArrowRight' && nav.newer) { e.preventDefault(); goTo({ level: nav.newer.level, periodKey: nav.newer.periodKey }) }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [top, nav.older, nav.newer, closeDialog, goTo])

  const jumpToEvent = useCallback((id: string) => {
    requestGraphFocus({ kind: 'event', id: `e:${id}` })
    setStack([])
    window.location.hash = '#graph'
  }, [])

  const groups = groupItems(level, items)

  return (
    <GraphShell tab="timeline" onBack={onBack}>
      {!unlockedPassword ? (
        <div style={{ margin: 'auto', color: COLOR.steelDim, fontSize: '0.8rem' }}>時間軸屬於私領域，請先在儀表板解鎖。</div>
      ) : (
        <>
          <div role="tablist" aria-label="時間軸級別" style={{ display: 'flex', gap: '0.4rem', padding: '0.6rem 1.2rem', borderBottom: `1px solid ${COLOR.line}` }}>
            {LEVELS.map(l => (
              <button key={l.level} type="button" role="tab" aria-selected={level === l.level} onClick={() => setLevel(l.level)}
                style={{ cursor: 'pointer', fontFamily: FONT.body, fontSize: '0.8rem', padding: '0.25rem 0.8rem', borderRadius: 999,
                  border: `1px solid ${level === l.level ? COLOR.amber : COLOR.line}`, background: level === l.level ? COLOR.panelRaised : 'transparent',
                  color: level === l.level ? COLOR.amber : COLOR.steel }}>{l.label}</button>
            ))}
          </div>
          <div ref={listRef} style={{ flex: 1, overflowY: 'auto', padding: '0 1.2rem 1.5rem' }} data-testid="timeline-list">
            {error && items.length === 0 && <div style={{ color: COLOR.crit, fontSize: '0.8rem', padding: '1rem 0' }}>載入失敗，請稍後重試。</div>}
            {!error && !loading && loadedLevel === level && items.length === 0 && (
              <div style={{ color: COLOR.steelDim, fontSize: '0.8rem', padding: '1rem 0' }}>這個級別目前沒有資料。</div>
            )}
            {groups.map(g => (
              <section key={g.header + g.items[0].periodKey}>
                {g.header && (
                  <div style={{ position: 'sticky', top: 0, zIndex: 1, background: COLOR.panelDeep, padding: '0.55rem 0 0.3rem', color: COLOR.amberDim,
                    fontFamily: FONT.mono, fontSize: '0.7rem', letterSpacing: '0.06em', borderBottom: `1px solid ${COLOR.line}` }}>{g.header}</div>
                )}
                {g.items.map(it => {
                  const badge = scoreBadge(it.mindScore)
                  const dim = !it.hasReport
                  return (
                    <button key={itemKey(it)} type="button" data-testid="timeline-row" onClick={e => openItem(it, e.currentTarget)}
                      style={{ display: 'flex', alignItems: 'center', gap: '0.8rem', width: '100%', textAlign: 'left', cursor: 'pointer',
                        background: 'none', border: 'none', borderBottom: `1px ${dim ? 'dashed' : 'solid'} ${COLOR.line}`, padding: '0.55rem 0.2rem',
                        color: dim ? COLOR.steelDim : COLOR.ink, fontFamily: FONT.body }}>
                      <span style={{ flex: '0 0 auto', minWidth: level === 'day' ? '5.4rem' : '6.2rem', fontFamily: FONT.mono, fontSize: '0.72rem', color: dim ? COLOR.steelDim : COLOR.steel }}>
                        {rowDateLabel(it)}{it.rangeInferred ? <span title="涵蓋區間為推算" style={{ color: COLOR.warn }}> ~</span> : null}
                      </span>
                      {level === 'day' && (
                        <span style={{ flex: '0 0 auto', width: '2.9rem', display: 'flex', justifyContent: 'center' }}>
                          {badge && <span title="當日心智指標" style={{ fontFamily: FONT.mono, fontSize: '0.66rem', color: TONE[badge.tone], border: `1px solid ${TONE[badge.tone]}`, borderRadius: 4, padding: '0 0.3rem' }}>{badge.text}</span>}
                        </span>
                      )}
                      <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontSize: '0.84rem' }}>
                        {it.periodNote && <span title={it.periodNote} style={{ color: COLOR.warn }}>⚠ </span>}{oneLine(it)}
                      </span>
                      {it.eventCount > 0 && <span style={{ flex: '0 0 auto', fontFamily: FONT.mono, fontSize: '0.66rem', color: COLOR.steelDim }}>{it.eventCount} 事件</span>}
                    </button>
                  )
                })}
              </section>
            ))}
            <div ref={sentinelRef} style={{ height: 1 }} />
            {loading && <div style={{ color: COLOR.steelDim, fontSize: '0.75rem', padding: '0.8rem 0' }}>載入中…</div>}
            {!loading && nextCursor && (
              <button type="button" onClick={() => void loadPage(level, nextCursor, false)}
                style={{ margin: '0.8rem auto', display: 'block', cursor: 'pointer', color: COLOR.steel, background: 'none', border: `1px solid ${COLOR.line}`, borderRadius: 4, padding: '0.3rem 1rem', fontSize: '0.75rem' }}>載入更多</button>
            )}
          </div>
        </>
      )}
      {top && (
        <TimelineDialog
          detail={detail} detailError={detailError} ref_={top} isMobile={isMobile} canBack={stack.length > 1}
          older={nav.older} newer={nav.newer}
          onClose={closeDialog} onBack={back} onGo={goTo} onDrill={drill} onEvent={jumpToEvent}
        />
      )}
    </GraphShell>
  )
}

function TimelineDialog(props: {
  detail: TimelineDetail | null; detailError: boolean; ref_: Ref; isMobile: boolean; canBack: boolean
  older: TimelineItem | null; newer: TimelineItem | null
  onClose: () => void; onBack: () => void; onGo: (r: Ref) => void; onDrill: (r: Ref) => void; onEvent: (id: string) => void
}) {
  const { detail: d, detailError, ref_, isMobile, canBack, older, newer, onClose, onBack, onGo, onDrill, onEvent } = props
  const boxRef = useRef<HTMLDivElement>(null)
  const closeRef = useRef<HTMLButtonElement>(null)
  useEffect(() => { closeRef.current?.focus() }, [])

  // 焦點鎖：Tab 只在對話框內循環
  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key !== 'Tab' || !boxRef.current) return
    const f = Array.from(boxRef.current.querySelectorAll<HTMLElement>('button, a[href], [tabindex]:not([tabindex="-1"])')).filter(x => !x.hasAttribute('disabled'))
    if (f.length === 0) return
    const first = f[0]; const last = f[f.length - 1]
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus() }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus() }
  }

  const title = d ? `${LEVEL_LABEL[d.level]}　${d.level === 'week' || d.level === 'day' ? rowDateLabel(d) : d.periodKey}` : `${LEVEL_LABEL[ref_.level]}　${ref_.periodKey}`
  const btn = (disabled: boolean) => ({
    cursor: disabled ? 'default' : 'pointer', background: 'none', border: `1px solid ${COLOR.line}`, borderRadius: 4, padding: '0.25rem 0.7rem',
    fontSize: '0.75rem', color: disabled ? COLOR.steelDim : COLOR.steel, opacity: disabled ? 0.5 : 1, fontFamily: FONT.body,
  } as const)

  return (
    <div onMouseDown={e => { if (e.target === e.currentTarget) onClose() }}
      style={{ position: 'fixed', inset: 0, zIndex: 300, background: 'rgba(8,9,12,0.72)', display: 'flex', alignItems: isMobile ? 'stretch' : 'center', justifyContent: 'center' }}>
      <div ref={boxRef} role="dialog" aria-modal="true" aria-labelledby="timeline-dialog-title" onKeyDown={onKeyDown}
        style={{ background: COLOR.panel, border: isMobile ? 'none' : `1px solid ${COLOR.lineBright}`, borderRadius: isMobile ? 0 : 8,
          width: isMobile ? '100%' : 'min(760px, 92vw)', maxHeight: isMobile ? '100%' : '86vh', height: isMobile ? '100%' : undefined,
          display: 'flex', flexDirection: 'column', boxShadow: '0 12px 48px rgba(0,0,0,0.5)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', padding: '0.7rem 1rem', borderBottom: `1px solid ${COLOR.line}` }}>
          {canBack && <button type="button" onClick={onBack} style={btn(false)}>‹ 返回</button>}
          <div style={{ flex: 1, minWidth: 0 }}>
            <div id="timeline-dialog-title" style={{ fontSize: '0.95rem', fontWeight: 600, color: COLOR.ink }}>{title}</div>
            {d && (
              <div style={{ fontFamily: FONT.mono, fontSize: '0.66rem', color: COLOR.steelDim, marginTop: 2 }}>
                {d.startDate === d.endDate ? d.startDate : `${d.startDate} ~ ${d.endDate}`}
                {d.rangeInferred && <span style={{ color: COLOR.warn }}>　（涵蓋區間為推算）</span>}
                {!d.hasReport && <span style={{ color: COLOR.warn }}>　（無報告，以下為降級內容）</span>}
                {d.mindScore !== null && <span>　心智指標 {d.mindScore.toFixed(1)}</span>}
              </div>
            )}
          </div>
          <button ref={closeRef} type="button" onClick={onClose} aria-label="關閉" style={btn(false)}>關閉 ✕</button>
        </div>
        <div style={{ flex: 1, overflowY: 'auto', padding: '0.4rem 1.1rem 1rem' }}>
          {detailError && <div style={{ color: COLOR.crit, fontSize: '0.8rem', padding: '0.8rem 0' }}>載入失敗。</div>}
          {!d && !detailError && <div style={{ color: COLOR.steelDim, fontSize: '0.8rem', padding: '0.8rem 0' }}>載入中…</div>}
          {d?.periodNote && <div style={{ margin: '0.6rem 0', padding: '0.4rem 0.7rem', borderLeft: `3px solid ${COLOR.warn}`, color: COLOR.warn, fontSize: '0.78rem' }}>⚠ {d.periodNote}</div>}
          {d && d.hasReport && <MarkdownView text={d.bodyMd} />}
          {d && !d.hasReport && (
            <div style={{ color: COLOR.steelDim, fontSize: '0.82rem', padding: '0.8rem 0' }}>
              {d.level === 'day' ? '這一天沒有日報。' : '這一期沒有報告。'}{d.eventCount > 0 ? '當日事件如下：' : ''}
            </div>
          )}
          {d && d.level === 'day' && d.events.length > 0 && (
            <div style={{ marginTop: '0.9rem' }}>
              <div style={{ fontFamily: FONT.mono, fontSize: '0.66rem', color: COLOR.steelDim, marginBottom: 6 }}>當日事件 · {d.eventCount}（點擊跳到關係圖）</div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.4rem' }}>
                {d.events.map(ev => (
                  <button key={ev.id} type="button" onClick={() => onEvent(ev.id)} title={ev.title}
                    style={{ cursor: 'pointer', maxWidth: '100%', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', background: COLOR.panelRaised,
                      border: `1px solid ${COLOR.line}`, color: COLOR.ink, borderRadius: 999, padding: '0.15rem 0.7rem', fontSize: '0.74rem', fontFamily: FONT.body }}>{ev.title}</button>
                ))}
              </div>
            </div>
          )}
          {d && d.children.length > 0 && (
            <div style={{ marginTop: '1.1rem' }}>
              <div style={{ fontFamily: FONT.mono, fontSize: '0.66rem', color: COLOR.steelDim, marginBottom: 6 }}>涵蓋的{LEVEL_LABEL[d.children[0].level]} · {d.children.length}</div>
              {d.children.map(c => (
                <button key={`${c.level}/${c.periodKey}`} type="button" onClick={() => onDrill({ level: c.level, periodKey: c.periodKey })}
                  style={{ display: 'flex', gap: '0.7rem', width: '100%', textAlign: 'left', cursor: 'pointer', background: 'none', border: 'none', borderBottom: `1px solid ${COLOR.line}`,
                    padding: '0.4rem 0.1rem', color: COLOR.ink, fontFamily: FONT.body }}>
                  <span style={{ flex: '0 0 auto', fontFamily: FONT.mono, fontSize: '0.7rem', color: COLOR.steel }}>{c.level === 'day' ? c.periodKey.slice(5) : c.periodKey}</span>
                  <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontSize: '0.8rem' }}>{c.summary || '（無摘要）'}</span>
                </button>
              ))}
            </div>
          )}
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: '0.6rem', padding: '0.6rem 1rem', borderTop: `1px solid ${COLOR.line}` }}>
          <button type="button" disabled={!older} onClick={() => older && onGo({ level: older.level, periodKey: older.periodKey })} style={btn(!older)}>‹ 較舊（←）</button>
          <button type="button" disabled={!newer} onClick={() => newer && onGo({ level: newer.level, periodKey: newer.periodKey })} style={btn(!newer)}>較新（→）›</button>
        </div>
      </div>
    </div>
  )
}
