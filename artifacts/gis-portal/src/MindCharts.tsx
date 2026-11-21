import { useMemo, useState } from 'react'
import { apiFetchIdeas } from './boardApi'
import { useAsync } from './homeHooks'
import { addDays, blockState, taipeiDate } from './homeView'
import { FORCE_LABELS, FORCE_TREND_DAYS, buildForces, buildFunnel, type ForceView, type ScoreRow } from './mindCharts'
import { Skeleton, StateFrame } from './StateFrame'
import { CV, FONT, alpha } from './theme'
import { apiFetchTimelineList } from './timelineApi'

// 心智面向頁（#dim/mind）的兩張主圖：想法漏斗（近 90 天）、五力（日報五項分數的雷達＋走勢）。純函式在 mindCharts.ts。

const fetchScores = async (pw: string): Promise<ScoreRow[]> => {
  const r = await apiFetchTimelineList(pw, 'day', null, 60)
  return r.items.map((i) => ({ date: i.startDate, score: i.reportScore }))
}

const LIST_MAX = 20

function IdeaFunnel({ pw, now, color, onRequestUnlock }: { pw: string | null; now: Date; color: string; onRequestUnlock: () => void }) {
  const res = useAsync(pw, apiFetchIdeas)
  const [open, setOpen] = useState<number | null>(null)
  const today = taipeiDate(now)
  const data = res.data
  const view = useMemo(() => (data ? buildFunnel(data.ideas, today) : null), [data, today])
  const st = blockState({ unlocked: !!pw, loading: res.loading, error: res.error, hasData: !!data, nowMs: now.getTime() })
  const top = Math.max(1, view?.stages[0]?.count ?? 1)
  return (
    <section className="hm-card dp-gantt mc-card" aria-label="想法漏斗" data-testid="mc-funnel">
      <h2 className="hm-h">想法漏斗・近 90 天</h2>
      <StateFrame status={st} source="想法庫" onRequestUnlock={onRequestUnlock} onRetry={res.reload} skeleton={<Skeleton lines={3} />} className="mc-frame">
        {view && (
          <>
            <ol className="mc-funnel">
              {view.stages.map((s, i) => {
                const step = i > 0 ? view.steps[i - 1]! : null
                const w = Math.max(14, Math.round((s.count / top) * 100))
                return (
                  <li key={s.key}>
                    {step && (
                      <div className="mc-step" aria-label={`${view.stages[i - 1]!.label}到${s.label}`}>
                        ↓ {step.rate === null ? '—' : `${step.rate}%`}・停留中位數 {step.medianDays === null ? '—' : `${step.medianDays} 天`}
                      </div>
                    )}
                    <button type="button" className="mc-bar" aria-expanded={open === i} style={{ width: `${w}%`, background: `color-mix(in srgb, ${color} ${70 - i * 18}%, transparent)` }}
                      onClick={() => setOpen(open === i ? null : i)}>
                      <span>{s.label}</span><b>{s.count}</b>
                    </button>
                    {open === i && (
                      s.ideas.length === 0 ? <p className="hm-note">這段沒有想法。</p> : (
                        <ul className="mc-list">
                          {s.ideas.slice(0, LIST_MAX).map((x) => <li key={x.id}>{x.title}</li>)}
                          {s.ideas.length > LIST_MAX && <li className="mc-more">還有 {s.ideas.length - LIST_MAX} 個</li>}
                        </ul>
                      )
                    )}
                  </li>
                )
              })}
            </ol>
            <p className="dp-note">封存 {view.archived}。母體：近 90 天產生、非回填、未被併入的想法；點一段看想法清單。</p>
          </>
        )}
      </StateFrame>
    </section>
  )
}

/** 五軸雷達（0–4）：本 7 天實線填色、前 7 天虛線淡色。panelUi 的 LabeledRadarChart 只有單一序列，所以這裡自己畫 */
function ForceRadar({ view, color }: { view: ForceView; color: string }) {
  const size = 240, c = size / 2, r = size * 0.3, n = FORCE_LABELS.length
  const ang = (i: number) => (Math.PI * 2 * i) / n - Math.PI / 2
  const pt = (i: number, rad: number) => [c + rad * Math.cos(ang(i)), c + rad * Math.sin(ang(i))] as const
  const poly = (vals: Array<number | null>) => vals.map((v, i) => pt(i, r * (Math.max(0, Math.min(4, v ?? 0)) / 4)).map((q) => q.toFixed(1)).join(',')).join(' ')
  const ring = (f: number) => FORCE_LABELS.map((_, i) => pt(i, r * f).map((q) => q.toFixed(1)).join(',')).join(' ')
  return (
    <svg className="mc-radar-svg" viewBox={`0 0 ${size} ${size}`} role="img" aria-label="五力雷達：本 7 天與前 7 天平均">
      <polygon points={ring(1)} fill="none" stroke={CV.line} />
      <polygon points={ring(0.5)} fill="none" stroke={CV.line} />
      {FORCE_LABELS.map((_, i) => { const [x, y] = pt(i, r); return <line key={i} x1={c} y1={c} x2={x} y2={y} stroke={CV.line} /> })}
      <polygon points={poly(view.prevWeek)} fill="none" stroke={CV.steel} strokeWidth={1.3} strokeDasharray="4 3" opacity={0.7} />
      <polygon points={poly(view.thisWeek)} fill={alpha(color, 20)} stroke={color} strokeWidth={2} />
      {FORCE_LABELS.map((label, i) => {
        const [x, y] = pt(i, r + 20)
        const cos = Math.cos(ang(i))
        const v = view.thisWeek[i]
        return <text key={label} x={x} y={y} textAnchor={cos > 0.35 ? 'start' : cos < -0.35 ? 'end' : 'middle'} dominantBaseline="middle" fontSize="11" fontFamily={FONT.body} fill={CV.steel}>{label}{v !== null ? ` ${v}` : ''}</text>
      })}
    </svg>
  )
}

function Spark({ f, color, weakest }: { f: ForceView['sparks'][number]; color: string; weakest: boolean }) {
  const W = 120, H = 26
  const n = f.points.length
  const x = (i: number) => (n <= 1 ? 0 : (i / (n - 1)) * W)
  const y = (v: number) => H - 2 - (Math.max(0, Math.min(4, v)) / 4) * (H - 4)
  const segs: string[] = []
  let cur: string[] = []
  f.points.forEach((p, i) => {
    if (p.value === null) { if (cur.length) segs.push(cur.join(' ')); cur = [] } else cur.push(`${x(i).toFixed(1)},${y(p.value).toFixed(1)}`)
  })
  if (cur.length) segs.push(cur.join(' '))
  return (
    <div className="mc-spark">
      <span className="mc-spark-l">{f.label}{weakest && <em>最弱</em>}</span>
      <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" role="img" aria-label={`${f.label}近 ${FORCE_TREND_DAYS} 天走勢`}>
        {segs.map((pts, i) => pts.includes(' ')
          ? <polyline key={i} points={pts} fill="none" stroke={color} strokeWidth={1.6} vectorEffect="non-scaling-stroke" />
          : <circle key={i} cx={pts.split(',')[0]} cy={pts.split(',')[1]} r={1.6} fill={color} />)}
      </svg>
      <span className="mc-spark-v">{f.latest ?? '—'}<small>週均 {f.weekAvg ?? '—'}</small></span>
    </div>
  )
}

function Forces({ pw, now, color, onRequestUnlock }: { pw: string | null; now: Date; color: string; onRequestUnlock: () => void }) {
  const res = useAsync(pw, fetchScores)
  const today = taipeiDate(now)
  const data = res.data
  const view = useMemo(() => (data ? buildForces(data.filter((r) => r.date >= addDays(today, -40)), today) : null), [data, today])
  const st = blockState({ unlocked: !!pw, loading: res.loading, error: res.error, hasData: !!data, nowMs: now.getTime() })
  return (
    <section className="hm-card dp-gantt mc-card" aria-label="五力" data-testid="mc-forces">
      <h2 className="hm-h">五力・推進 決策 卡點 覺察 能量</h2>
      <StateFrame status={st} source="每日報告分數" onRequestUnlock={onRequestUnlock} onRetry={res.reload} skeleton={<Skeleton lines={4} />} className="mc-frame">
        {view && (!view.enough ? (
          <p className="hm-note">近 {FORCE_TREND_DAYS} 天只有 {view.days} 天有日報分數，累積到 3 天以上才畫圖。</p>
        ) : (
          <>
            <div className="mc-radar">
              <ForceRadar view={view} color={color} />
              <div className="mc-legend">
                <span><i style={{ background: color }} />本 7 天平均</span>
                <span><i className="mc-dash" style={{ borderColor: CV.steel }} />前 7 天平均</span>
              </div>
            </div>
            <div className="mc-sparks">
              {view.sparks.map((f) => <Spark key={f.label} f={f} color={color} weakest={f.label === view.weakest} />)}
            </div>
            <p className="dp-note">五軸 0–4；走勢是近 {FORCE_TREND_DAYS} 天每天一點，沒有日報分數的日子斷線。右邊是最近值與本週平均。</p>
          </>
        ))}
      </StateFrame>
    </section>
  )
}

export function MindCharts({ pw, now, color, onRequestUnlock }: { pw: string | null; now: Date; color: string; onRequestUnlock: () => void }) {
  return (
    <>
      <IdeaFunnel pw={pw} now={now} color={color} onRequestUnlock={onRequestUnlock} />
      <Forces pw={pw} now={now} color={color} onRequestUnlock={onRequestUnlock} />
    </>
  )
}
