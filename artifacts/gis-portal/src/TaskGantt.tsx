import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react'
import { useAsync } from './homeHooks'
import { blockState, taipeiDate } from './homeView'
import { Skeleton, StateFrame } from './StateFrame'
import {
  GANTT_EVERY_MIN, LOOKBACK_DAYS, addDays, apiFetchGantt, buildGanttView, ganttTicks, isWeekend, rangeLabel, taskUrl, upcomingUrl,
  type GanttData, type GanttProject, type GanttRow, type GanttStatus,
} from './taskGantt'

// 從容面板的任務甘特圖（#dim/calm）：Vikunja 任務依專案分組，橫軸是「上週到未來幾週」的每一天。
// 不照搬 Vikunja 的樣式：狀態用顏色講（逾期紅、7 天內到期黃、已完成灰），專案色只用在分組標頭（或依到期日排序時列前）的圓點；
// 「依到期日排序」預設開（使用者 2026-10-25）：不分專案、整份由近到遠；關掉回到依專案分組。
// 只有一個日期的任務畫成菱形里程碑。點任一列在新分頁打開 Vikunja 的那個任務。

const SPANS = [
  { weeks: 5, dayW: 24, label: '近 5 週' },
  { weeks: 13, dayW: 10, label: '近 3 個月' },
] as const

const STATUS_TEXT: Record<GanttStatus, string> = { done: '已完成', overdue: '逾期', soon: '7 天內到期', normal: '進行中' }

export function TaskGantt({ pw, now, color, onRequestUnlock }: {
  pw: string | null
  now: Date
  color: string
  onRequestUnlock: () => void
}) {
  const res = useAsync(pw, apiFetchGantt)
  const [spanIdx, setSpanIdx] = useState(0)
  const [showDone, setShowDone] = useState(false)
  const [byDue, setByDue] = useState(true)
  const [collapsed, setCollapsed] = useState<ReadonlySet<number>>(new Set())
  const today = taipeiDate(now)
  const span = SPANS[spanIdx]!
  const data = res.data
  const view = useMemo(() => (data ? buildGanttView(data, today, span.weeks, showDone, byDue) : null), [data, today, span.weeks, showDone, byDue])
  const st = blockState({
    unlocked: !!pw, loading: res.loading, error: res.error, hasData: !!data, nowMs: now.getTime(),
    updatedAtMs: data ? Date.parse(data.computedAt) : null, expectedEveryMin: GANTT_EVERY_MIN,
  })
  // 窄螢幕時間軸放不下：一打開就捲到「今天」前兩天，不必先滑過上週
  const scrollRef = useRef<HTMLDivElement>(null)
  const hasRows = !!view && (view.groups.length > 0 || view.flat.length > 0)
  // 寬螢幕：每天的寬度拉開填滿卡片（不低於該區間的預設寬），右邊不留一大片空白（2.62.0）
  const [boxW, setBoxW] = useState(0)
  useEffect(() => {
    const el = scrollRef.current
    if (!el || typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver(([e]) => setBoxW(Math.round(e!.contentRect.width)))
    ro.observe(el)
    return () => ro.disconnect()
  }, [hasRows])
  const labelW = boxW > 560 ? 184 : 120   // 與 portal.css 的 .gt-grid --lw（11.5rem／7.5rem）一致
  const dayW = view && boxW > 0 ? Math.max(span.dayW, Math.floor(((boxW - labelW - 2) / view.days) * 10) / 10) : span.dayW
  useEffect(() => {
    const el = scrollRef.current
    if (el && el.scrollWidth > el.clientWidth) el.scrollLeft = (LOOKBACK_DAYS - 2) * dayW
  }, [hasRows, dayW])
  const toggle = (id: number) => setCollapsed((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n })

  return (
    <section className="hm-card dp-gantt" aria-label="任務甘特圖" data-testid="dp-gantt">
      <h2 className="hm-h">任務甘特圖<span className="hm-h-right">
        {SPANS.map((s, i) => (
          <button key={s.weeks} type="button" className={`dp-range${spanIdx === i ? ' is-on' : ''}`} aria-pressed={spanIdx === i} onClick={() => setSpanIdx(i)}>{s.label}</button>
        ))}
        <label className="hm-check"><input type="checkbox" checked={byDue} onChange={(e) => setByDue(e.target.checked)} data-testid="gt-bydue" />依到期日排序</label>
        <label className="hm-check"><input type="checkbox" checked={showDone} onChange={(e) => setShowDone(e.target.checked)} data-testid="gt-done" />含近 {data?.doneDays || 30} 天完成</label>
      </span></h2>
      <StateFrame status={st} source="任務追蹤（Vikunja）" onRequestUnlock={onRequestUnlock} onRetry={res.reload} skeleton={<Skeleton lines={4} />}
        empty="還沒收到甘特圖資料（等 HERMES 的推送上線後約 10 分鐘內出現）。" className="dp-gantt-frame">
        {data && view && (
          <>
            <div className="gt-sum" data-testid="gt-sum">
              <span><b>{view.counts.open}</b> 項進行中</span>
              <span className={view.counts.overdue ? 'is-crit' : ''}><b>{view.counts.overdue}</b> 項逾期</span>
              <span className={view.counts.soon ? 'is-warn' : ''}><b>{view.counts.soon}</b> 項 7 天內到期</span>
              {data.undatedOpen > 0 && <span title="沒有開始、結束或到期日，甘特圖畫不出來"><b>{data.undatedOpen}</b> 項沒排日期</span>}
              {upcomingUrl(data) && <a className="gt-open" href={upcomingUrl(data)!} target="_blank" rel="noopener noreferrer" data-testid="gt-open">在 Vikunja 開啟 ↗</a>}
            </div>
            {!hasRows ? (
              <p className="hm-note">這段期間沒有排了日期的任務。</p>
            ) : (
              <div className="gt-scroll" ref={scrollRef}>
                <div className="gt-grid" style={{ ['--dw' as string]: `${dayW}px`, ['--days' as string]: view.days, ['--dim' as string]: color } as CSSProperties}>
                  <Axis winFrom={view.winFrom} days={view.days} today={today} />
                  {byDue && (
                    <div className="gt-group gt-flat" role="group" aria-label="依到期日排序">
                      {view.flat.map((r) => <Row key={r.task.id} row={r} data={data} dot={projectOf(data, r.task.projectId)?.color ?? color} project={projectOf(data, r.task.projectId)} />)}
                    </div>
                  )}
                  {view.groups.map((g) => {
                    const closed = collapsed.has(g.project.id)
                    return (
                      <div key={g.project.id} className="gt-group" role="group" aria-label={g.project.title}>
                        <button type="button" className="gt-proj" aria-expanded={!closed} onClick={() => toggle(g.project.id)}>
                          <span className="gt-proj-in">
                            <span className="gt-caret" aria-hidden>{closed ? '▸' : '▾'}</span>
                            <i className="gt-dot" style={{ background: g.project.color ?? color }} aria-hidden />
                            <span className="gt-proj-t">{g.project.title}</span>
                            <span className="gt-proj-n">{g.rows.length}{g.overdue > 0 && <em> · {g.overdue} 逾期</em>}</span>
                          </span>
                        </button>
                        {!closed && g.rows.map((r) => <Row key={r.task.id} row={r} data={data} />)}
                      </div>
                    )
                  })}
                  <TodayLine winFrom={view.winFrom} today={today} />
                </div>
              </div>
            )}
            <p className="dp-note">
              橫軸從上週到未來 {span.weeks - 1} 週；長條＝開始到結束（或到期），◆＝只有一個日期。紅＝逾期、黃＝7 天內到期、灰＝已完成。
              {view.later > 0 && ` 另有 ${view.later} 項排在更後面。`}
              {data.truncated > 0 && ` 任務太多，${data.truncated} 項沒有送上來。`}
            </p>
          </>
        )}
      </StateFrame>
    </section>
  )
}

function Axis({ winFrom, days, today }: { winFrom: string; days: number; today: string }) {
  const ticks = ganttTicks(winFrom, days)
  const weekends = Array.from({ length: days }, (_, i) => i).filter((i) => isWeekend(addDays(winFrom, i)))
  return (
    <>
      <div className="gt-axis" aria-hidden>
        <span className="gt-label gt-axis-l">{today.slice(0, 4)}</span>
        <span className="gt-track">
          {ticks.map((t) => <span key={t.idx} className={`gt-tick${t.month ? ' is-month' : ''}`} style={{ left: `calc(${t.idx} * var(--dw))` }}>{t.label}</span>)}
        </span>
      </div>
      <div className="gt-bg" aria-hidden>
        {weekends.map((i) => <i key={i} style={{ left: `calc(${i} * var(--dw))` }} />)}
        {ticks.map((t) => <b key={t.idx} className={t.month ? 'is-month' : ''} style={{ left: `calc(${t.idx} * var(--dw))` }} />)}
      </div>
    </>
  )
}

function TodayLine({ winFrom, today }: { winFrom: string; today: string }) {
  const i = Math.round((Date.parse(`${today}T12:00:00Z`) - Date.parse(`${winFrom}T12:00:00Z`)) / 86_400_000)
  return <div className="gt-today" aria-hidden style={{ left: `calc(var(--lw) + ${i} * var(--dw) + var(--dw) / 2)` }}><span>今天</span></div>
}

const projectOf = (data: GanttData, id: number): GanttProject | undefined => data.projects.find((p) => p.id === id)

function Row({ row, data, dot, project }: { row: GanttRow; data: GanttData; dot?: string; project?: GanttProject }) {
  const { task: t, layout: l } = row
  const url = taskUrl(data, t.id)
  const when = rangeLabel(t)
  const extra = l.status === 'overdue' ? `逾期 ${l.overdueDays} 天` : t.done && t.doneAt ? `${Number(t.doneAt.slice(5, 7))}/${Number(t.doneAt.slice(8, 10))} 完成` : STATUS_TEXT[l.status]
  const tip = `${project ? `${project.title}｜` : ''}${t.title}｜${when}｜${extra}${t.percentDone > 0 && !t.done ? `｜完成 ${t.percentDone}%` : ''}`
  const left = `calc(${l.from} * var(--dw))`
  const width = `calc(${l.to - l.from + 1} * var(--dw))`
  const body = (
    <>
      <span className="gt-label" title={t.title}>
        {dot && <i className="gt-dot" style={{ background: dot }} aria-hidden />}
        {t.priority >= 4 && !t.done && <span className="gt-pri" title="高優先">!</span>}
        <span className="gt-label-t">{t.title}</span>
      </span>
      <span className="gt-track">
        {l.kind === 'bar' ? (
          <span className={`gt-bar${l.clippedLeft ? ' cut-l' : ''}${l.clippedRight ? ' cut-r' : ''}`} style={{ left, width }}>
            {t.percentDone > 0 && !t.done && <i className="gt-pct" style={{ width: `${t.percentDone}%` }} />}
          </span>
        ) : (
          <span className={`gt-ms${l.clippedLeft ? ' cut-l' : ''}`} style={{ left: `calc(${l.from} * var(--dw) + var(--dw) / 2)` }} />
        )}
        <span className="gt-when" style={{ left: `calc(${l.to + 1} * var(--dw) + 6px)` }}>{l.clippedLeft && l.status === 'overdue' && l.kind === 'point' ? `◀ ${extra}` : when}</span>
      </span>
    </>
  )
  const cls = `gt-row is-${l.status}`
  return url
    ? <a className={cls} href={url} target="_blank" rel="noopener noreferrer" title={tip} aria-label={tip} data-testid="gt-row">{body}</a>
    : <div className={cls} title={tip} aria-label={tip} data-testid="gt-row">{body}</div>
}
