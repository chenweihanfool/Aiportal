import type { ReactNode } from 'react'
import { COLOR } from './theme'
import type { HhiBreakdown } from './boardView'
import type { IdeaItem } from './boardApi'
import { categoryColor } from './ideasView'
import { KIND_ICON, statusLabelFor } from './foodMap'
import { TRIP_STATUS_LABEL } from './tripsView'
import { DIMENSION_FALLBACK_COLOR, dimensionOf } from './homeDimensions'
import { useCountUp } from './homeHooks'
import { Skeleton, StateFrame } from './StateFrame'
import {
  dimensionLine, type BlockStatus, type DayPart, type Heatmap, type HhiTrend, type KnowledgeStats, type LatestTrip, type Milestone,
  type SystemLight, type YearProgress,
} from './homeView'
import { biggestDrag } from './boardView'

// 新首頁（HomeBoard）五個區塊的呈現元件。資料與狀態判定都由 HomeBoard.tsx 傳進來，這裡只負責畫。
// 樣式在 portal.css 的 hm-* 類別。

type Tone = (score: number) => { color: string; label: string }

const Head = ({ no, title, right }: { no: string; title: string; right?: ReactNode }) => (
  <h2 className="hm-h"><span className="hm-no" aria-hidden>{no}</span>{title}{right && <span className="hm-h-right">{right}</span>}</h2>
)

// ── ① 今天 ────────────────────────────────────
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
export function DimensionsSection({ st, breakdown, onOpen, onRequestUnlock }: {
  st: BlockStatus
  breakdown: HhiBreakdown | null
  onOpen: () => void
  onRequestUnlock: () => void
}) {
  const drag = breakdown ? biggestDrag(breakdown.rows) : null
  const ghost = <div className="hm-dims">{Array.from({ length: 6 }, (_, i) => <div key={i} className="hm-dim hm-dim--ghost"><Skeleton lines={2} /></div>)}</div>
  return (
    <section className="hm-card hm-dimsec" aria-label="六個面向">
      <Head no="②" title="六個面向" right={<span className="hm-hide-sm" title="/api/happiness/history 只回總分，沒有每個面向的歷史，所以不畫迷你線，先用數值條">各面向歷史還沒有資料來源，先以數值條呈現</span>} />
      <StateFrame status={st} source="幸福指數" skeleton={ghost} onRequestUnlock={onRequestUnlock} empty="六個面向還沒有資料。">
        <div className="hm-dims">
          {breakdown?.rows.map((r) => {
            const meta = dimensionOf(r.key)
            const color = meta?.color ?? DIMENSION_FALLBACK_COLOR
            const isDrag = drag?.key === r.key
            return (
              <button key={r.key} type="button" className={`hm-dim${isDrag ? ' is-drag' : ''}`} style={{ ['--dim' as string]: color }} onClick={onOpen}
                aria-label={`${meta?.label ?? r.label} ${r.value ?? '沒有資料'}，點開看詳情`}>
                <span className="hm-dim-name"><span aria-hidden>{meta?.icon ?? '◆'}</span>{meta?.label ?? r.label}{isDrag && <span className="hm-chip hm-chip--warn">短板</span>}</span>
                <span className="hm-dim-num">{r.value ?? '—'}</span>
                <span className="hm-dim-bar" aria-hidden><i style={{ width: `${r.value === null ? 0 : Math.max(2, r.value)}%` }} /></span>
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
function YearHeat({ heat, toneOf }: { heat: Heatmap; toneOf: Tone }) {
  return (
    <div className="hm-heat">
      <div className="hm-heat-months" style={{ gridTemplateColumns: `repeat(${heat.cols}, minmax(0, 1fr))` }} aria-hidden>
        {heat.months.map((m) => <span key={`${m.col}-${m.label}`} style={{ gridColumn: `${m.col + 1} / span 4` }}>{m.label}</span>)}
      </div>
      <div className="hm-heat-grid" role="img" aria-label={`幸福指數年熱圖：${heat.start} 到 ${heat.end} 共 ${heat.cells.length} 天，${heat.withData} 天有紀錄`}
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
  milestones: Milestone[]
  toneOf: Tone
  onRequestUnlock: () => void
  onRetryHistory: () => void
  onRetryKb: () => void
}) {
  const tiles: Array<[string, number | null, number | null]> = [['人物', kb.people, kb.newPeopleThisWeek], ['事件', kb.events, kb.newEventsThisWeek], ['概念', kb.concepts, null], ['方法', kb.methods, null]]
  return (
    <section className="hm-card hm-growth" aria-label="成長軌跡">
      <Head no="③" title="成長軌跡" right={<><a href="#graph/timeline" className="hm-link">時間軸 →</a><a href="#graph" className="hm-link">關係宇宙 →</a></>} />
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
              {milestones.length === 0
                ? <li className="hm-muted">資料累積到門檻才會出現（只列算得出來的）</li>
                : milestones.map((m) => (
                  <li key={m.id} className="hm-mile" title={[m.detail, m.next].filter(Boolean).join('・')}><span aria-hidden>{m.icon}</span>{m.title}</li>
                ))}
            </ul>
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
  food: { want: { name: string; kind: Parameters<typeof statusLabelFor>[0]; area: string | null; days: number } | null; been: number; total: number }
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
      <Head no="④" title="好玩的" right={<button type="button" className="hm-link" onClick={onOpenIdeas}>全部想法 →</button>} />
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
            <div className="hm-sub">🍜 想吃的</div>
            <StateFrame status={foodSt} source="地點" onRequestUnlock={onRequestUnlock} onRetry={onRetryFood}
              empty={<a href="#food" className="hm-link">還沒有想吃的紀錄 →</a>}>
              {food.want ? (
                <a href="#food" className="hm-tile-link">
                  <b>{KIND_ICON[food.want.kind]} {food.want.name}</b>
                  <span>{food.want.area ? `${food.want.area}・` : ''}{statusLabelFor(food.want.kind, 'want')} {food.want.days} 天了</span>
                </a>
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
          <b className="hm-sys-name">⑤ 系統</b>
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
