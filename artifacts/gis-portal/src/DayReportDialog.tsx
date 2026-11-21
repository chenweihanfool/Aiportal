import { useEffect, useRef, useState, type ReactNode } from 'react'
import { CV, FONT } from './theme'
import { MarkdownView } from './MarkdownView'
import { ReportBody } from './ReportBody'
import { countWithTime, eventDisplayTime, eventTimeLabel, eventTimeTitle } from './dayEvents'
import { dailyScoreLine, type DailyScore } from './dailyScore'
import { apiFetchTimelineDetail, type TimelineDetail, type TimelineItem, type TimelineLevel } from './timelineApi'
import { LEVEL_LABEL, reportScoreLine, rowDateLabel } from './timelineLogic'
import { isValidDay } from './timelineLink'

// 全尺寸日報視窗：時間軸（TimelineView）與心得面板（InsightPanel）共用。
export interface Ref { level: TimelineLevel; periodKey: string }

export function useIsMobile(): boolean {
  const [m, setM] = useState(() => window.matchMedia('(max-width: 640px)').matches)
  useEffect(() => {
    const mq = window.matchMedia('(max-width: 640px)')
    const on = () => setM(mq.matches)
    mq.addEventListener('change', on)
    return () => mq.removeEventListener('change', on)
  }, [])
  return m
}

export function ReportDialogFrame(props: {
  detail: TimelineDetail | null; detailError: boolean; ref_: Ref; isMobile: boolean; canBack: boolean; password: string | null
  /** 僅日報：每日評分（80% 成果＋20% AI 自評） */
  score: DailyScore | null
  older: TimelineItem | null; newer: TimelineItem | null
  /** 標題列最左邊的額外按鈕（例如「‹ 回到心得」） */
  leading?: ReactNode
  /** 有值就在標題列顯示「在時間軸看 →」連結 */
  timelineHref?: string
  testId?: string
  onClose: () => void; onBack: () => void; onGo: (r: Ref) => void; onDrill: (r: Ref) => void; onEvent: (id: string) => void
}) {
  const { detail: d, detailError, ref_, isMobile, canBack, password, score, older, newer, leading, timelineHref, testId, onClose, onBack, onGo, onDrill, onEvent } = props
  // 報告裡的日期（🕰️ 的 [[YYYY-MM-DD]]、里程碑的日柱）→ 疊一層打開那天的日報，「返回」回到這一天
  const openDay = (date: string) => onDrill({ level: 'day', periodKey: date })
  const resolveDay = (target: string) => (isValidDay(target.trim()) ? target.trim() : null)
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
    cursor: disabled ? 'default' : 'pointer', background: 'none', border: `1px solid ${CV.line}`, borderRadius: 4, padding: '0.35rem 0.9rem',
    fontSize: '0.92rem', color: disabled ? CV.steelDim : CV.steel, opacity: disabled ? 0.5 : 1, fontFamily: FONT.body,
  } as const)

  return (
    <div onMouseDown={e => { if (e.target === e.currentTarget) onClose() }}
      style={{ position: 'fixed', inset: 0, zIndex: 300, background: 'rgba(8,9,12,0.72)', display: 'flex', alignItems: isMobile ? 'stretch' : 'center', justifyContent: 'center' }}>
      <div ref={boxRef} role="dialog" aria-modal="true" data-testid={testId} aria-labelledby="timeline-dialog-title" onKeyDown={onKeyDown}
        style={{ background: CV.panel, border: isMobile ? 'none' : `1px solid ${CV.lineBright}`, borderRadius: isMobile ? 0 : 8,
          width: isMobile ? '100%' : 'min(1180px, 95vw)', maxHeight: isMobile ? '100%' : '92vh', height: isMobile ? '100%' : '92vh',
          display: 'flex', flexDirection: 'column', boxShadow: '0 12px 48px rgba(0,0,0,0.5)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', padding: '0.7rem 1rem', borderBottom: `1px solid ${CV.line}` }}>
          {canBack ? <button type="button" onClick={onBack} style={btn(false)}>‹ 返回</button> : leading}
          <div style={{ flex: 1, minWidth: 0 }}>
            <div id="timeline-dialog-title" style={{ fontSize: '1.3rem', fontWeight: 600, color: CV.ink }}>{title}</div>
            {d && (
              <div style={{ fontFamily: FONT.mono, fontSize: '0.84rem', color: CV.steelDim, marginTop: 3 }}>
                {d.startDate === d.endDate ? d.startDate : `${d.startDate} ~ ${d.endDate}`}
                {d.rangeInferred && <span style={{ color: CV.warn }}>　（涵蓋區間為推算）</span>}
                {!d.hasReport && <span style={{ color: CV.warn }}>　（無報告，以下為降級內容）</span>}
                {score && <span data-testid="detail-report-score" title={d.reportScore ? `AI 自評 ${reportScoreLine(d.reportScore)}` : undefined}>　每日評分 {dailyScoreLine(score)}</span>}
              </div>
            )}
          </div>
          {timelineHref && <a href={timelineHref} data-testid="day-dialog-timeline-link" style={{ ...btn(false), textDecoration: 'none' }}>在時間軸看 →</a>}
          <button ref={closeRef} type="button" onClick={onClose} aria-label="關閉" style={btn(false)}>關閉 ✕</button>
        </div>
        <div style={{ flex: 1, overflowY: 'auto', padding: '0.4rem 1.1rem 1rem' }}>
          {detailError && <div style={{ color: CV.crit, fontSize: '0.8rem', padding: '0.8rem 0' }}>載入失敗（入口網可能沒有這一期的報告或事件）。</div>}
          {!d && !detailError && <div style={{ color: CV.steelDim, fontSize: '0.8rem', padding: '0.8rem 0' }}>載入中…</div>}
          {d?.periodNote && <div style={{ margin: '0.6rem 0', padding: '0.4rem 0.7rem', borderLeft: `3px solid ${CV.warn}`, color: CV.warn, fontSize: '0.95rem' }}>⚠ {d.periodNote}</div>}
          {d && d.hasReport && (
            // 報告（日／週／月／季／年）：圖表帶＋段落卡片，可切「原文」
            <ReportBody level={d.level} startDate={d.startDate} endDate={d.endDate} bodyMd={d.bodyMd} reportScore={d.reportScore} password={password}
              onOpenDay={openDay}
              md={(text, size) => <MarkdownView text={text} fontSize={size ?? '1.1rem'} resolveWikilink={resolveDay} onNavigate={openDay} />} />
          )}
          {d && !d.hasReport && (
            <div style={{ color: CV.steelDim, fontSize: '1rem', padding: '0.8rem 0' }}>
              {d.level === 'day' ? '這一天沒有日報。' : '這一期沒有報告。'}{d.eventCount > 0 ? '當日事件如下：' : ''}
            </div>
          )}
          {d && d.level === 'day' && d.events.length > 0 && (
            <div style={{ marginTop: '0.9rem' }}>
              <div style={{ fontFamily: FONT.mono, fontSize: '0.84rem', color: CV.steelDim, marginBottom: 6 }}>
                當日事件 · {d.eventCount}（寫進日記的時間 新→舊；灰色 ~＝日記那行沒有時戳，改用萃取時間；點擊跳到關係圖）
              </div>
              {countWithTime(d.events) === 0 && (
                <div style={{ fontSize: '0.86rem', color: CV.warn, marginBottom: 6 }}>尚無時間資料，以下順序不代表時間先後。</div>
              )}
              <div role="list">
                {d.events.map(ev => { const tm = eventDisplayTime(ev); const tt = eventTimeTitle(tm.iso, tm.source); return (
                  <button key={ev.id} role="listitem" type="button" onClick={() => onEvent(ev.id)} title={tt ? `${ev.title}\n${tt}` : ev.title}
                    style={{ display: 'flex', gap: '0.8rem', alignItems: 'baseline', width: '100%', textAlign: 'left', cursor: 'pointer', background: 'none', border: 'none',
                      borderBottom: `1px solid ${CV.line}`, padding: '0.4rem 0.1rem', color: CV.ink, fontFamily: FONT.body }}>
                    <span style={{ flex: '0 0 5.8rem', fontFamily: FONT.mono, fontSize: '0.88rem', color: tm.source === 'diary' ? CV.steel : CV.steelDim, whiteSpace: 'nowrap' }}>
                      {tm.source === 'extracted' ? '~' : ''}{eventTimeLabel(tm.iso, d.periodKey)}
                    </span>
                    <span style={{ flex: 1, minWidth: 0, fontSize: '1.02rem', lineHeight: 1.55, wordBreak: 'break-word' }}>{ev.title}</span>
                  </button>
                ) })}
              </div>
            </div>
          )}
          {d && d.children.length > 0 && (
            <div style={{ marginTop: '1.1rem' }}>
              <div style={{ fontFamily: FONT.mono, fontSize: '0.84rem', color: CV.steelDim, marginBottom: 6 }}>涵蓋的{LEVEL_LABEL[d.children[0].level]} · {d.children.length}</div>
              {d.children.map(c => (
                <button key={`${c.level}/${c.periodKey}`} type="button" onClick={() => onDrill({ level: c.level, periodKey: c.periodKey })}
                  style={{ display: 'flex', gap: '0.7rem', width: '100%', textAlign: 'left', cursor: 'pointer', background: 'none', border: 'none', borderBottom: `1px solid ${CV.line}`,
                    padding: '0.4rem 0.1rem', color: CV.ink, fontFamily: FONT.body }}>
                  <span style={{ flex: '0 0 auto', fontFamily: FONT.mono, fontSize: '0.88rem', color: CV.steel }}>{c.level === 'day' ? c.periodKey.slice(5) : c.periodKey}</span>
                  <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontSize: '1.02rem' }}>{c.summary || '（無摘要）'}</span>
                </button>
              ))}
            </div>
          )}
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: '0.6rem', padding: '0.6rem 1rem', borderTop: `1px solid ${CV.line}` }}>
          <button type="button" disabled={!older} onClick={() => older && onGo({ level: older.level, periodKey: older.periodKey })} style={btn(!older)}>‹ 較舊（←）</button>
          <button type="button" disabled={!newer} onClick={() => newer && onGo({ level: newer.level, periodKey: newer.periodKey })} style={btn(!newer)}>較新（→）›</button>
        </div>
      </div>
    </div>
  )
}

/** 只給日期與密碼就自己抓那天的日報；報告裡的日期連結會疊一層，「‹ 返回」回上一天。 */
export function DayReportDialog({ date, password, onClose, timelineHref, leading }: {
  date: string; password: string | null; onClose: () => void; timelineHref?: string; leading?: ReactNode
}) {
  const isMobile = useIsMobile()
  const [stack, setStack] = useState<string[]>([date])
  const [detail, setDetail] = useState<TimelineDetail | null>(null)
  const [detailError, setDetailError] = useState(false)
  useEffect(() => { setStack([date]) }, [date])
  const cur = stack[stack.length - 1]
  useEffect(() => {
    if (!password || !isValidDay(cur)) { setDetail(null); setDetailError(!!password); return }
    let cancelled = false
    setDetail(null); setDetailError(false)
    apiFetchTimelineDetail(password, 'day', cur)
      .then((d) => { if (!cancelled) setDetail(d) })
      .catch(() => { if (!cancelled) setDetailError(true) })
    return () => { cancelled = true }
  }, [cur, password])
  useEffect(() => {
    const f = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.preventDefault(); onClose() } }
    window.addEventListener('keydown', f)
    return () => window.removeEventListener('keydown', f)
  }, [onClose])
  return (
    <ReportDialogFrame detail={detail} detailError={detailError} ref_={{ level: 'day', periodKey: cur }} isMobile={isMobile}
      canBack={stack.length > 1} password={password} score={null} older={null} newer={null}
      leading={leading} timelineHref={timelineHref} testId="day-report-dialog"
      onClose={onClose} onBack={() => setStack((s) => (s.length > 1 ? s.slice(0, -1) : s))} onGo={() => {}}
      onDrill={(r) => setStack((s) => [...s, r.periodKey])}
      onEvent={(id) => { window.location.hash = '#dossier/event/' + encodeURIComponent(id) }} />
  )
}
