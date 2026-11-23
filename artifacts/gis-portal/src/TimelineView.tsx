import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { CV, FONT, SCORE_SCALE, scoreVar } from './theme'
import { GraphShell } from './GraphShell'
import { ReportDialogFrame, useIsMobile, type Ref } from './DayReportDialog'
import { backLabel } from './timelineLink'
import { apiFetchIdeas } from './boardApi'
import { useAsync } from './homeHooks'
import { apiFetchDailyLife, apiFetchTasksDone, dailyIndex } from './milestones'
import { dailyScore, dailyScoreLine, type DailyScore } from './dailyScore'
import {
  apiFetchTimelineDetail, apiFetchTimelineList,
  type TimelineDetail, type TimelineItem, type TimelineLevel,
} from './timelineApi'
import { goto } from './navBack'
import {
  LEVELS, LEVEL_LABEL, groupItems, itemKey, mergePages, neighbors, oneLine, reportBadge, reportScoreLine, rowDateLabel,
  type ScoreTone,
} from './timelineLogic'

const LEVEL_KEY = 'kb.timeline.level'
// 與熱圖、六面向同一份分數色階（SCORE_SCALE，越綠越好）；時間軸的 ok 就是色階的 good（黃綠）。
const SCORE_TONE: Record<ScoreTone, string> = {
  great: scoreVar(SCORE_SCALE.great), ok: scoreVar(SCORE_SCALE.good), warn: scoreVar(SCORE_SCALE.warn), concern: scoreVar(SCORE_SCALE.concern), crit: scoreVar(SCORE_SCALE.crit),
}
const BADGE_STYLE = { fontFamily: FONT.mono, fontSize: '0.82rem', borderRadius: 4, padding: '0 0.35rem', whiteSpace: 'nowrap' } as const
const MOBILE_BADGE = { fontSize: '0.7rem', padding: '0 0.2rem' } as const   // 手機寬度不夠，徽章縮小以保留摘要的可讀寬度

function isLevel(v: unknown): v is TimelineLevel {
  return v === 'day' || v === 'week' || v === 'month' || v === 'quarter' || v === 'year'
}

function readLevel(): TimelineLevel {
  try {
    const v = sessionStorage.getItem(LEVEL_KEY)
    if (v === 'day' || v === 'week' || v === 'month' || v === 'quarter' || v === 'year') return v
  } catch { /* ignore */ }
  return 'day'
}

export function TimelineView({ unlockedPassword, onBack, initialDay = null, from = null }: {
  unlockedPassword: string | null; onBack: () => void
  /** 深連結：直接打開這一天的日報對話框 */
  initialDay?: string | null
  /** 深連結的來源 hash（不含 #；空字串＝首頁）；null＝沒有來源 */
  from?: string | null
}) {
  const [level, setLevel] = useState<TimelineLevel>(readLevel)
  const [items, setItems] = useState<TimelineItem[]>([])
  const [nextCursor, setNextCursor] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(false)
  const [loadedLevel, setLoadedLevel] = useState<TimelineLevel | null>(null)
  // 對話框：stack 最上層是目前顯示的期間；下鑽時 push，「返回」時 pop
  const [stack, setStack] = useState<Ref[]>(() => (initialDay ? [{ level: 'day', periodKey: initialDay }] : []))
  // 對話框是從深連結（帶 from）打開的：✕／Esc／回去鍵都回到來源，而不是停在列表
  const [fromActive, setFromActive] = useState(() => !!initialDay && from !== null)
  const goFrom = useCallback(() => { if (from !== null) goto(from) }, [from])
  useEffect(() => {
    if (initialDay) { setStack([{ level: 'day', periodKey: initialDay }]); setFromActive(from !== null) }
  }, [initialDay, from])
  const [detail, setDetail] = useState<TimelineDetail | null>(null)
  const [detailError, setDetailError] = useState(false)
  const genRef = useRef(0)
  const sentinelRef = useRef<HTMLDivElement>(null)
  const listRef = useRef<HTMLDivElement>(null)
  const lastFocusRef = useRef<HTMLElement | null>(null)
  const isMobile = useIsMobile()
  // 每日評分＝80% 當天成果＋20% AI 自評（dailyScore.ts）；成果要等想法庫與完成任務都載入，避免徽章先顯示 AI 分數再跳
  const ideasA = useAsync(unlockedPassword, apiFetchIdeas)
  const tasksA = useAsync(unlockedPassword, apiFetchTasksDone)
  const lifeA = useAsync(unlockedPassword, apiFetchDailyLife)
  // 載完＝成功（含「還沒部署」回 null 的情況，靠 loadedAt 判斷）或失敗；只看 data 會讓回 null 的來源永遠算沒載完
  const settled = (a: { data: unknown; error: boolean; loadedAt: number | null }) => a.data !== null || a.loadedAt !== null || a.error
  const scoresReady = settled(ideasA) && settled(tasksA) && settled(lifeA)
  const ix = useMemo(() => (ideasA.data && tasksA.data ? dailyIndex(ideasA.data.ideas, tasksA.data, lifeA.data) : null), [ideasA.data, tasksA.data, lifeA.data])
  const scoreOf = useCallback((it: TimelineItem | null): DailyScore | null =>
    (it && it.level === 'day' && scoresReady ? dailyScore(it.reportScore?.total, ix ? ix.at(it.startDate) : null) : null), [ix, scoresReady])

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
    setFromActive(false)
    setStack([{ level: it.level, periodKey: it.periodKey }])
  }, [])
  const closeDialog = useCallback(() => {
    if (fromActive) { setFromActive(false); setStack([]); goFrom(); return }
    setStack([])
    setTimeout(() => lastFocusRef.current?.focus(), 0)
  }, [fromActive, goFrom])
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
    setStack([])
    goto('#dossier/event/' + encodeURIComponent(id))
  }, [])

  const groups = groupItems(level, items)

  return (
    <GraphShell tab="timeline" onBack={from !== null ? goFrom : onBack}>
      {!unlockedPassword ? (
        <div style={{ margin: 'auto', color: CV.steelDim, fontSize: '0.8rem' }}>時間軸屬於私領域，請先在儀表板解鎖。</div>
      ) : (
        <>
          <div role="tablist" aria-label="時間軸級別" style={{ display: 'flex', gap: '0.4rem', padding: '0.6rem 1.2rem', borderBottom: `1px solid ${CV.line}` }}>
            {LEVELS.map(l => (
              <button key={l.level} type="button" role="tab" aria-selected={level === l.level} onClick={() => setLevel(l.level)}
                style={{ cursor: 'pointer', fontFamily: FONT.body, fontSize: '0.98rem', padding: '0.3rem 1rem', borderRadius: 999,
                  border: `1px solid ${level === l.level ? 'var(--c-accent)' : CV.line}`, background: level === l.level ? CV.panelRaised : 'transparent',
                  color: level === l.level ? 'var(--c-accent)' : CV.steel }}>{l.label}</button>
            ))}
          </div>
          <div ref={listRef} style={{ flex: 1, overflowY: 'auto', padding: '0 1.2rem 1.5rem' }} data-testid="timeline-list">
            {error && items.length === 0 && <div style={{ color: CV.crit, fontSize: '0.8rem', padding: '1rem 0' }}>載入失敗，請稍後重試。</div>}
            {!error && !loading && loadedLevel === level && items.length === 0 && (
              <div style={{ color: CV.steelDim, fontSize: '0.8rem', padding: '1rem 0' }}>這個級別目前沒有資料。</div>
            )}
            {groups.map(g => (
              <section key={g.header + g.items[0].periodKey}>
                {g.header && (
                  <div style={{ position: 'sticky', top: 0, zIndex: 1, background: CV.panelDeep, padding: '0.55rem 0 0.3rem', color: 'var(--c-accent-dim)',
                    fontFamily: FONT.mono, fontSize: '0.88rem', letterSpacing: '0.06em', borderBottom: `1px solid ${CV.line}` }}>{g.header}</div>
                )}
                {g.items.map(it => {
                  const score = scoreOf(it)
                  const badge = reportBadge(score)
                  const dim = !it.hasReport
                  return (
                    <button key={itemKey(it)} type="button" data-testid="timeline-row" onClick={e => openItem(it, e.currentTarget)}
                      style={{ display: 'flex', alignItems: 'center', gap: '0.8rem', width: '100%', textAlign: 'left', cursor: 'pointer',
                        background: 'none', border: 'none', borderBottom: `1px ${dim ? 'dashed' : 'solid'} ${CV.line}`, padding: '0.7rem 0.2rem',
                        color: dim ? CV.steelDim : CV.ink, fontFamily: FONT.body }}>
                      <span style={{ flex: '0 0 auto', minWidth: level === 'day' ? '6.6rem' : '7.6rem', fontFamily: FONT.mono, fontSize: '0.92rem', color: dim ? CV.steelDim : CV.steel }}>
                        {rowDateLabel(it)}{it.rangeInferred ? <span title="涵蓋區間為推算" style={{ color: CV.warn }}> ~</span> : null}
                      </span>
                      {level === 'day' && (
                        <span style={{ flex: '0 0 auto', width: isMobile ? '3.2rem' : '4rem', display: 'flex', justifyContent: 'center' }}>
                          {badge && score && <span data-testid="badge-report" title={`每日評分 ${dailyScoreLine(score)}${it.reportScore ? `\nAI 自評 ${reportScoreLine(it.reportScore)}` : ''}`} style={{ ...BADGE_STYLE, ...(isMobile ? MOBILE_BADGE : {}), color: SCORE_TONE[badge.tone], border: `1px solid ${SCORE_TONE[badge.tone]}` }}>日 {badge.text}</span>}
                        </span>
                      )}
                      <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontSize: '1.08rem' }}>
                        {it.periodNote && <span title={it.periodNote} style={{ color: CV.warn }}>⚠ </span>}{oneLine(it)}
                      </span>
                      {it.eventCount > 0 && <span style={{ flex: '0 0 auto', fontFamily: FONT.mono, fontSize: '0.84rem', color: CV.steelDim }}>{it.eventCount} 事件</span>}
                    </button>
                  )
                })}
              </section>
            ))}
            <div ref={sentinelRef} style={{ height: 1 }} />
            {loading && <div style={{ color: CV.steelDim, fontSize: '0.75rem', padding: '0.8rem 0' }}>載入中…</div>}
            {!loading && nextCursor && (
              <button type="button" onClick={() => void loadPage(level, nextCursor, false)}
                style={{ margin: '0.8rem auto', display: 'block', cursor: 'pointer', color: CV.steel, background: 'none', border: `1px solid ${CV.line}`, borderRadius: 4, padding: '0.3rem 1rem', fontSize: '0.75rem' }}>載入更多</button>
            )}
          </div>
        </>
      )}
      {top && (
        <ReportDialogFrame
          detail={detail} detailError={detailError} ref_={top} isMobile={isMobile} canBack={stack.length > 1} password={unlockedPassword} score={scoreOf(detail)}
          older={nav.older} newer={nav.newer} testId="timeline-dialog"
          leading={fromActive && from !== null ? <button type="button" data-testid="day-back-from" onClick={goFrom} style={{ cursor: 'pointer', background: 'none', border: `1px solid ${CV.line}`, borderRadius: 4, padding: '0.35rem 0.9rem', fontSize: '0.92rem', color: CV.steel, fontFamily: FONT.body }}>{backLabel(from)}</button> : undefined}
          onClose={closeDialog} onBack={back} onGo={goTo} onDrill={drill} onEvent={jumpToEvent}
        />
      )}
    </GraphShell>
  )
}
