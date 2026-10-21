import { useMemo, type ReactNode } from 'react'
import { COLOR } from './theme'
import type { HhiBreakdown } from './boardView'
import type { IdeaItem } from './boardApi'
import { categoryColor } from './ideasView'
import { KIND_ICON, statusLabelFor } from './foodMap'
import { TRIP_STATUS_LABEL } from './tripsView'
import { DIMENSION_FALLBACK_COLOR, dimensionOf } from './dimensions'
import { useCountUp } from './homeHooks'
import { Skeleton, StateFrame } from './StateFrame'
import {
  dimensionLine, sparkGeometry, type BlockStatus, type DayPart, type DimSeries, type Heatmap, type HhiTrend, type KnowledgeStats, type LatestTrip, type MilestoneSummary,
  type SystemLight, type YearProgress,
} from './homeView'
import { biggestDrag } from './boardView'

// 新首頁（HomeBoard）五個區塊的呈現元件。資料與狀態判定都由 HomeBoard.tsx 傳進來，這裡只負責畫。
// 樣式在 portal.css 的 hm-* 類別。

type Tone = (score: number) => { color: string; label: string }

const Head = ({ title, right }: { title: string; right?: ReactNode }) => (
  <h2 className="hm-h">{title}{right && <span className="hm-h-right">{right}</span>}</h2>
)

// ── ① 今天 ────────────────────────────────────
type WantEntry = { name: string; kind: Parameters<typeof statusLabelFor>[0]; area: string | null; days: number }

export function TodaySection({ greetingText, part, dateLabel, st, breakdown, trend, trendNote, sentence, year, toneOf, onOpen, onRequestUnlock }: {
  greetingText: string
  part: DayPart
  dateLabel: string
  st: BlockStatus
  breakdown: HhiBreakdown | null
  trend: HhiTrend | null
  /** 歷史不能用時的說明（載入中、失敗、累積中）；null＝正常顯示差與連續天數 */
  trendNote: string | null
  sentence: string
  year: YearProgress
  toneOf: Tone
  onOpen: () => void
  onRequestUnlock: () => void
}) {
  const shown = useCountUp(breakdown?.displayed ?? null)
  const tone = breakdown ? toneOf(breakdown.displayed) : null
  const d = trend?.delta ?? null
  return (
    <section className="hm-card hm-today" data-part={part} aria-label="今天">
      <div className="hm-today-main">
        <div className="hm-hello"><b>{greetingText}，翰翰</b><span>{dateLabel}</span></div>
        <StateFrame status={st} source="幸福指數" onRequestUnlock={onRequestUnlock} skeleton={<Skeleton lines={2} />}
          empty="今天的幸福指數還沒有資料。" className="hm-today-frame">
          {breakdown && tone && (
            <div className="hm-today-body">
              <button type="button" className="hm-score" onClick={onOpen} aria-label={`幸福指數 ${breakdown.displayed}，${tone.label}，點開看詳情`}>
                <span className="hm-score-n" style={{ color: tone.color }}>{shown ?? breakdown.displayed}</span>
                <span className="hm-score-of">/100</span>
              </button>
              <div className="hm-today-text">
                <div className="hm-score-meta">
                  <span className="hm-tone" style={{ color: tone.color }}>{tone.label}</span>
                  {trendNote === null && d !== null && (
                    <span className="hm-delta" style={{ color: d > 0 ? COLOR.ok : d < 0 ? COLOR.concern : COLOR.steelDim }} title="與昨天的差">
                      {d > 0 ? `▲ ${d}` : d < 0 ? `▼ ${-d}` : '— 持平'}
                    </span>
                  )}
                  {trendNote === null && trend?.streak && trend.streak.days >= 2 && (
                    <span className="hm-streak">連 {trend.streak.days} 天{trend.streak.direction === 'up' ? '上升' : '下降'}</span>
                  )}
                  {!breakdown.isFinal && <span className="hm-chip hm-chip--warn" title="23:55 前是暫定值">今日暫定</span>}
                  {trendNote !== null && <span className="hm-muted">{trendNote}</span>}
                </div>
                <p className="hm-sentence">{sentence}</p>
              </div>
            </div>
          )}
        </StateFrame>
      </div>
      <div className="hm-year" role="group" aria-label={`${year.year} 年已過 ${year.pct}%`}>
        <div className="hm-year-top"><span>{year.year} 已過</span><b>{year.pct}%</b></div>
        <div className="hm-year-bar" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={year.pct} aria-label="今年已過的比例"><i style={{ width: `${year.pct}%` }} /></div>
        <div className="hm-year-sub">第 {year.dayOfYear} / {year.daysInYear} 天</div>
      </div>
    </section>
  )
}

// ── ② 六個面向 ────────────────────────────────
const SPARK_W = 100
const SPARK_H = 24
const SPARK_PAD = 3
/** 30 天迷你線：顏色用面向的識別色（父層 --dim）、沒資料的日子斷線、終點一個點、最後一個值與前一天的差（ ▲ 變好／▼ 變差；分數越高越好） */
function DimSpark({ series }: { series: DimSeries }) {
  const g = useMemo(() => sparkGeometry(series), [series])
  const px = (p: { x: number; y: number }) => ({ x: p.x * SPARK_W, y: SPARK_PAD + p.y * (SPARK_H - 2 * SPARK_PAD) })
  const pct = (p: { x: number; y: number }) => ({ left: `${p.x * 100}%`, top: `${((SPARK_PAD + p.y * (SPARK_H - 2 * SPARK_PAD)) / SPARK_H) * 100}%` })
  const d = series.delta
  return (
    <span className="hm-dim-spark" role="img"
      aria-label={`近 ${series.days.length} 天走勢，${series.validCount} 天有資料，最新 ${Math.round(series.last.value)} 分${d === null ? '' : d === 0 ? '，與前一天持平' : d > 0 ? `，比前一天高 ${d} 分` : `，比前一天低 ${-d} 分`}`}>
      <span className="hm-spark">
        <svg viewBox={`0 0 ${SPARK_W} ${SPARK_H}`} preserveAspectRatio="none" aria-hidden focusable="false">
          {g.lines.map((l, i) => <polyline key={i} className="hm-spark-line" fill="none" vectorEffect="non-scaling-stroke" points={l.map((p) => { const q = px(p); return `${q.x.toFixed(2)},${q.y.toFixed(2)}` }).join(' ')} />)}
        </svg>
        {g.dots.map((p, i) => <i key={i} className="hm-spark-dot" style={pct(p)} />)}
        <i className="hm-spark-end" style={pct(g.end)} />
      </span>
      {d !== null && (
        <span className="hm-spark-delta" style={{ color: d > 0 ? COLOR.ok : d < 0 ? COLOR.concern : COLOR.steelDim }} title="最後一個值與前一天的差">
          {d > 0 ? `▲ ${d}` : d < 0 ? `▼ ${-d}` : '— 0'}
        </span>
      )}
    </span>
  )
}

export function DimensionsSection({ st, breakdown, series, onOpen, onRequestUnlock }: {
  st: BlockStatus
  breakdown: HhiBreakdown | null
  /** 每面向的 30 天序列；null（還沒載入／接口沒有 components／有效點不到 2 個）＝不畫線，只留數值條 */
  series: Record<string, DimSeries | null> | null
  /** 點某個面向小卡：進該面向自己的頁（#dim/<key>） */
  onOpen: (key: string) => void
  onRequestUnlock: () => void
}) {
  const drag = breakdown ? biggestDrag(breakdown.rows) : null
  const anySpark = !!series && Object.values(series).some((x) => x !== null)
  const ghost = <div className="hm-dims">{Array.from({ length: 6 }, (_, i) => <div key={i} className="hm-dim hm-dim--ghost"><Skeleton lines={2} /></div>)}</div>
  return (
    <section className="hm-card hm-dimsec" aria-label="六個面向">
      <Head title="六個面向" right={anySpark ? <span className="hm-hide-sm">細線＝近 30 天</span> : undefined} />
      <StateFrame status={st} source="幸福指數" skeleton={ghost} onRequestUnlock={onRequestUnlock} empty="六個面向還沒有資料。">
        <div className="hm-dims">
          {breakdown?.rows.map((r) => {
            const meta = dimensionOf(r.key)
            const color = meta?.color ?? DIMENSION_FALLBACK_COLOR
            const isDrag = drag?.key === r.key
            const sp = series?.[r.key] ?? null
            return (
              <button key={r.key} type="button" className={`hm-dim${isDrag ? ' is-drag' : ''}${sp ? ' has-spark' : ''}`} style={{ ['--dim' as string]: color }} onClick={() => onOpen(r.key)}
                aria-label={`${meta?.label ?? r.label} ${r.value ?? '沒有資料'}，點開看這個面向的頁面`}>
                <span className="hm-dim-name"><span aria-hidden>{meta?.icon ?? '◆'}</span>{meta?.label ?? r.label}{isDrag && <span className="hm-chip hm-chip--warn">短板</span>}</span>
                <span className="hm-dim-num">{r.value ?? '—'}</span>
                <span className="hm-dim-bar" aria-hidden><i style={{ width: `${r.value === null ? 0 : Math.max(2, r.value)}%` }} /></span>
                {sp && <DimSpark series={sp} />}
                <span className="hm-dim-foot">
                  <span className="hm-dim-sub">權重 {r.weightPct}%・貢獻 {r.points !== null ? `${r.points.toFixed(1)} 分` : '—'}</span>
                  <span className="hm-dim-line">{dimensionLine(r, isDrag)}</span>
                </span>
              </button>
            )
          })}
        </div>
      </StateFrame>
    </section>
  )
}

// ── ③ 成長軌跡 ────────────────────────────────
export function YearHeat({ heat, toneOf, label = '幸福指數' }: { heat: Heatmap; toneOf: Tone; label?: string }) {
  return (
    <div className="hm-heat">
      <div className="hm-heat-months" style={{ gridTemplateColumns: `repeat(${heat.cols}, minmax(0, 1fr))` }} aria-hidden>
        {heat.months.map((m) => <span key={`${m.col}-${m.label}`} style={{ gridColumn: `${m.col + 1} / span 4` }}>{m.label}</span>)}
      </div>
      <div className="hm-heat-grid" role="img" aria-label={`${label}年熱圖：${heat.start} 到 ${heat.end} 共 ${heat.cells.length} 天，${heat.withData} 天有紀錄`}
        style={{ gridTemplateColumns: `repeat(${heat.cols}, minmax(0, 1fr))` }}>
        {heat.cells.map((c) => (
          <i key={c.date} className={`hm-cell${c.value === null ? ' is-empty' : ''}`} data-date={c.date}
            title={c.value === null ? `${c.date.slice(5)} 沒有紀錄` : `${c.date.slice(5)}：${c.value}`}
            style={{ gridColumn: c.col + 1, gridRow: c.row + 1, background: c.value === null ? undefined : toneOf(c.value).color }} />
        ))}
      </div>
      <div className="hm-heat-legend" aria-hidden>
        <span className="hm-cell is-empty" />沒有紀錄
        {[20, 40, 55, 70, 90].map((v) => <i key={v} className="hm-cell" style={{ background: toneOf(v).color }} />)}
        <span>色階同幸福指數等級</span>
      </div>
    </div>
  )
}

const kbNum = (n: number | null) => (n === null ? '—' : n.toLocaleString('en-US'))

export function GrowthSection({ histSt, heat, heatPending, kbSt, kb, milestones, toneOf, onRequestUnlock, onRetryHistory, onRetryKb }: {
  histSt: BlockStatus
  heat: Heatmap
  heatPending: string
  kbSt: BlockStatus
  kb: KnowledgeStats
  milestones: MilestoneSummary
  toneOf: Tone
  onRequestUnlock: () => void
  onRetryHistory: () => void
  onRetryKb: () => void
}) {
  const tiles: Array<[string, number | null, number | null]> = [['人物', kb.people, kb.newPeopleThisWeek], ['事件', kb.events, kb.newEventsThisWeek], ['概念', kb.concepts, null], ['方法', kb.methods, null]]
  return (
    <section className="hm-card hm-growth" aria-label="成長軌跡">
      <Head title="成長軌跡" right={<><a href="#year" className="hm-link" data-testid="hm-year-link">年度回顧 →</a><a href="#graph/timeline" className="hm-link">時間軸 →</a><a href="#graph" className="hm-link">關係宇宙 →</a><a href="#nebula" className="hm-link">星雲圖 →</a></>} />
      <div className="hm-growth-body">
        <StateFrame status={histSt} source="幸福指數歷史" onRequestUnlock={onRequestUnlock} onRetry={onRetryHistory}
          pendingText={heatPending} className="hm-heat-frame">
          <YearHeat heat={heat} toneOf={toneOf} />
        </StateFrame>
        <div className="hm-growth-foot">
          <div className="hm-growth-kb">
            <div className="hm-sub">知識庫累積</div>
            <StateFrame status={kbSt} source="知識庫" onRequestUnlock={onRequestUnlock} onRetry={onRetryKb} empty="知識庫還沒有資料。">
              <div className="hm-kb">
                {tiles.map(([label, n, week]) => (
                  <div key={label} className="hm-kb-tile">
                    <span className="hm-kb-label">{label}</span>
                    <b className="hm-kb-n">{kbNum(n)}</b>
                    <span className="hm-kb-week">{week !== null ? `本週 +${week}` : '\u00a0'}</span>
                  </div>
                ))}
              </div>
            </StateFrame>
          </div>
          <div className="hm-growth-miles">
            <div className="hm-sub">里程碑</div>
            <ul className="hm-miles" aria-label="里程碑">
              {milestones.badges.length === 0
                ? <li className="hm-muted">{milestones.next ? '還沒有達成的里程碑' : '資料累積到門檻才會出現（只列算得出來的）'}</li>
                : milestones.badges.map((m) => (
                  <li key={m.id} className="hm-mile" title={m.detail}><span aria-hidden>{m.icon}</span>{m.title}</li>
                ))}
            </ul>
            {milestones.next && (
              <div className="hm-next" title={`${milestones.next.text}（${Math.round(milestones.next.ratio * 100)}%）`}>
                <span className="hm-next-text"><span aria-hidden>{milestones.next.icon}</span>{milestones.next.text}</span>
                <span className="hm-next-bar" role="progressbar" aria-label="離下一個里程碑的進度" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(milestones.next.ratio * 100)}>
                  <i style={{ width: `${Math.min(100, Math.max(2, milestones.next.ratio * 100))}%` }} />
                </span>
              </div>
            )}
          </div>
        </div>
      </div>
    </section>
  )
}

// ── ④ 好玩的 ──────────────────────────────────
export function FunSection({ ideasSt, ideasCount, topIdeas, foodSt, food, tripsSt, trip, onOpenIdeas, onRequestUnlock, onRetryIdeas, onRetryFood, onRetryTrips }: {
  ideasSt: BlockStatus
  ideasCount: number
  topIdeas: IdeaItem[]
  foodSt: BlockStatus
  food: { wantEat: WantEntry | null; wantGo: WantEntry | null; been: number; total: number }
  tripsSt: BlockStatus
  trip: LatestTrip | null
  onOpenIdeas: () => void
  onRequestUnlock: () => void
  onRetryIdeas: () => void
  onRetryFood: () => void
  onRetryTrips: () => void
}) {
  return (
    <section className="hm-card hm-fun" aria-label="好玩的">
      <Head title="好玩的" right={<button type="button" className="hm-link" onClick={onOpenIdeas}>全部想法 →</button>} />
      <div className="hm-fun-body">
        <div className="hm-sub">💡 想法庫前三名</div>
        <StateFrame status={ideasSt} source="想法庫" onRequestUnlock={onRequestUnlock} onRetry={onRetryIdeas}
          empty={ideasCount === 0 ? '還沒有想法。' : '目前沒有開放中的想法。'}>
          <ol className="hm-ideas">
            {topIdeas.map((it, i) => {
              const c = categoryColor(it.category)
              return (
                <li key={it.id}>
                  <button type="button" className="hm-idea" onClick={onOpenIdeas} title={it.scoreWhy.join('\n')}>
                    <span className="hm-idea-rank" style={{ color: i === 0 ? COLOR.amber : COLOR.steel }}>{i + 1}</span>
                    <span className="hm-idea-title">{it.status === 'doing' && <span aria-label="進行中">🚀 </span>}{it.title}</span>
                    <span className="hm-cat" style={{ color: c, borderColor: c }}>{it.category ?? '未分類'}</span>
                    <span className="hm-idea-score">{it.score?.toFixed(1) ?? '—'}</span>
                  </button>
                </li>
              )
            })}
          </ol>
        </StateFrame>
        <div className="hm-pair">
          <div className="hm-tile">
            <div className="hm-sub">🔖 想吃／想去</div>
            <StateFrame status={foodSt} source="地點" onRequestUnlock={onRequestUnlock} onRetry={onRetryFood}
              empty={<a href="#food" className="hm-link">還沒有想吃的紀錄 →</a>}>
              {food.wantEat || food.wantGo ? (
                <>
                  {[food.wantEat, food.wantGo].map((w) => w && (
                    <a key={w.kind === 'food' ? 'eat' : 'go'} href="#food" className="hm-tile-link" data-testid={w.kind === 'food' ? 'hm-want-eat' : 'hm-want-go'}>
                      <b>{KIND_ICON[w.kind]} {w.name}</b>
                      <span>{w.area ? `${w.area}・` : ''}{statusLabelFor(w.kind, 'want')} {w.days} 天了</span>
                    </a>
                  ))}
                </>
              ) : (
                <a href="#food" className="hm-tile-link">
                  <b>還沒有想吃的紀錄</b>
                  <span>已去過 {food.been} / {food.total} 個地點 →</span>
                </a>
              )}
            </StateFrame>
          </div>
          <div className="hm-tile">
            <div className="hm-sub">🧳 最新一趟</div>
            <StateFrame status={tripsSt} source="遊記" onRequestUnlock={onRequestUnlock} onRetry={onRetryTrips}
              empty={<a href="#trips" className="hm-link">還沒有遊記 →</a>}>
              {trip && (
                <a href={`#trips/${encodeURIComponent(trip.trip.id)}`} className="hm-tile-link">
                  <b>{trip.trip.name}</b>
                  <span>{trip.trip.start.slice(5).replace('-', '/')}{trip.trip.end !== trip.trip.start ? `–${trip.trip.end.slice(5).replace('-', '/')}` : ''}・{trip.days} 天・{TRIP_STATUS_LABEL[trip.trip.status]}</span>
                </a>
              )}
            </StateFrame>
          </div>
        </div>
      </div>
    </section>
  )
}

// ── ⑤ 系統一顆燈 ──────────────────────────────
const LAMP: Record<SystemLight['level'], string> = { ok: COLOR.ok, warn: COLOR.warn, crit: COLOR.crit, unknown: COLOR.steelDim }

export function SystemSection({ st, light, onOpen, onRequestUnlock }: {
  st: BlockStatus
  light: SystemLight
  onOpen: () => void
  onRequestUnlock: () => void
}) {
  const alert = light.level === 'warn' || light.level === 'crit'
  const color = LAMP[light.level]
  return (
    <section className={`hm-card hm-sys${alert ? ' is-alert' : ''}`} data-level={light.level} style={alert ? { borderColor: color } : undefined} aria-label="系統">
      <StateFrame status={st} source="系統狀態" onRequestUnlock={onRequestUnlock} skeleton={<Skeleton lines={1} />} className="hm-sys-frame">
        <button type="button" className="hm-sys-bar" onClick={onOpen} aria-haspopup="dialog" aria-label={`系統：${light.headline}。點開看戰情室`}>
          <i className="hm-lamp" style={{ background: color, boxShadow: `0 0 8px ${color}` }} aria-hidden />
          <b className="hm-sys-name">系統</b>
          <span className="hm-sys-text" style={{ color: alert ? color : undefined }}>{light.headline}</span>
          <span className="hm-link">戰情室 →</span>
        </button>
        {alert && light.reasons.length > 1 && (
          <ul className="hm-reasons">
            {light.reasons.slice(1, 4).map((r, i) => <li key={i} style={{ color: r.level === 'crit' ? COLOR.crit : COLOR.warn }}>{r.text}</li>)}
          </ul>
        )}
      </StateFrame>
    </section>
  )
}
