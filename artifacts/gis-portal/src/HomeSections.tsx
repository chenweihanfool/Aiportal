import { useMemo } from 'react'
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
import { biggestDrag, dayLinkText } from './boardView'
import type { ActivityInsight, CompanionData } from './companion'
import type { Brief, Crowd, ParsedBrief } from './briefView'
import { BriefBoard } from './BriefBoard'
import { dimHash } from './dimensionPage'
import { HomeCard } from './HomeCard'

// 新首頁（HomeBoard）五個區塊的呈現元件。資料與狀態判定都由 HomeBoard.tsx 傳進來，這裡只負責畫。
// 樣式在 portal.css 的 hm-* 類別；每個區塊外框是 HomeCard（id、標題、圖示來自 homeNav.ts 的註冊表）。

type Tone = (score: number) => { color: string; label: string }

const LAMP: Record<SystemLight['level'], string> = { ok: COLOR.ok, warn: COLOR.warn, crit: COLOR.crit, unknown: COLOR.steelDim }

// ── ① 今天 ────────────────────────────────────
type WantEntry = { name: string; kind: Parameters<typeof statusLabelFor>[0]; area: string | null; days: number }

export function TodaySection({ greetingText, part, dateLabel, st, breakdown, trend, trendNote, sentence, move, year, toneOf, onOpen, onRequestUnlock, system, onOpenSystem }: {
  greetingText: string
  part: DayPart
  dateLabel: string
  st: BlockStatus
  breakdown: HhiBreakdown | null
  trend: HhiTrend | null
  /** 歷史不能用時的說明（載入中、失敗、累積中）；null＝正常顯示差與連續天數 */
  trendNote: string | null
  sentence: string
  /** 今日最划算的一件事；沒有就不顯示 */
  move: string | null
  year: YearProgress
  toneOf: Tone
  onOpen: () => void
  onRequestUnlock: () => void
  /** 「一眼看」欄的系統燈；null＝未解鎖或還沒載入（不顯示這一格） */
  system?: SystemLight | null
  onOpenSystem?: () => void
}) {
  const shown = useCountUp(breakdown?.displayed ?? null)
  // 只有分數本身看得到（新鮮或過期但仍顯示）時才列最弱面向；未解鎖／載入中／失敗都不露出任何分數
  const scoreVisible = st.state === 'fresh' || st.state === 'stale'
  const drag = breakdown && scoreVisible ? biggestDrag(breakdown.rows) : null
  const dragMeta = drag ? dimensionOf(drag.key) : undefined
  const dragGap = drag && drag.value !== null ? Math.round(((100 - drag.value) * drag.weightPct) / 10) / 10 : null
  const sysColor = system ? LAMP[system.level] : COLOR.steelDim
  const tone = breakdown ? toneOf(breakdown.displayed) : null
  const d = trend?.delta ?? null
  return (
    <HomeCard id="sec-today" className="hm-today" head={false} data={{ part }}>
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
                  {breakdown.day && <span className="hm-chip" data-testid="day-link" title="每日評分＝80% 當天成果＋20% AI 自評；幸福指數修正＝(今日分−近 28 天平均)×0.15，上下限 ±6，23:55 前只加不扣">{dayLinkText(breakdown.day)}</span>}
                </div>
                <p className="hm-sentence">{sentence}</p>
                {move && <p className="hm-sentence hm-move" data-testid="today-move">👉 {move}</p>}
              </div>
            </div>
          )}
        </StateFrame>
      </div>
      {/* 一眼看（2.53.0）：最弱面向、系統燈、今年進度——最重要的三件事不用往下捲就看得到 */}
      <div className="hm-glance" aria-label="重點">
        {drag && dragMeta && drag.value !== null && (
          <a className="hm-glance-item hm-glance-drag" href={dimHash(drag.key)} style={{ ['--dim' as string]: dragMeta.color }} data-testid="hm-glance-drag"
            aria-label={`最弱面向：${dragMeta.label} ${drag.value} 分，點開看面向頁`}>
            <span className="hm-glance-k">最弱面向</span>
            <span className="hm-glance-v"><span aria-hidden>{dragMeta.icon}</span>{dragMeta.label}<b>{drag.value}</b></span>
            {dragGap !== null && <span className="hm-glance-s">拉低總分 {dragGap} 分</span>}
          </a>
        )}
        {system && onOpenSystem && (
          <button type="button" className="hm-glance-item hm-glance-sys" data-level={system.level} onClick={onOpenSystem} aria-haspopup="dialog" data-testid="hm-glance-sys"
            aria-label={`系統：${system.headline}。點開看戰情室`} title={system.headline}>
            <span className="hm-glance-k">系統</span>
            <span className="hm-glance-v"><i className="hm-lamp" style={{ background: sysColor, boxShadow: `0 0 8px ${sysColor}` }} aria-hidden /><span className="hm-glance-t" style={{ color: system.level === 'warn' || system.level === 'crit' ? sysColor : undefined }}>{system.headline}</span></span>
          </button>
        )}
        <div className="hm-glance-item hm-year" role="group" aria-label={`${year.year} 年已過 ${year.pct}%`}>
          <div className="hm-year-top"><span>{year.year} 已過</span><b>{year.pct}%</b></div>
          <div className="hm-year-bar" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={year.pct} aria-label="今年已過的比例"><i style={{ width: `${year.pct}%` }} /></div>
          <div className="hm-year-sub">第 {year.dayOfYear} / {year.daysInYear} 天</div>
        </div>
      </div>
    </HomeCard>
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

export function DimensionsSection({ st, breakdown, series, links, onOpen, onRequestUnlock }: {
  st: BlockStatus
  breakdown: HhiBreakdown | null
  /** 每面向的 30 天序列；null（還沒載入／接口沒有 components／有效點不到 2 個）＝不畫線，只留數值條 */
  series: Record<string, DimSeries | null> | null
  /** 每面向的子系統連結（dimensionSiteLinks）；沒有的面向不顯示 */
  links: Record<string, { name: string; url: string }>
  /** 點某個面向小卡：進該面向自己的頁（#dim/<key>） */
  onOpen: (key: string) => void
  onRequestUnlock: () => void
}) {
  // 只有分數本身看得到（新鮮或過期但仍顯示）時才列最弱面向；未解鎖／載入中／失敗都不露出任何分數
  const scoreVisible = st.state === 'fresh' || st.state === 'stale'
  const drag = breakdown && scoreVisible ? biggestDrag(breakdown.rows) : null
  const anySpark = !!series && Object.values(series).some((x) => x !== null)
  const ghost = <div className="hm-dims">{Array.from({ length: 6 }, (_, i) => <div key={i} className="hm-dim hm-dim--ghost"><Skeleton lines={2} /></div>)}</div>
  return (
    <HomeCard id="sec-dims" className="hm-dimsec" right={<span className="hm-hide-sm">{anySpark ? '細線＝近 30 天・' : ''}點卡片看面向頁</span>}>
      <StateFrame status={st} source="幸福指數" skeleton={ghost} onRequestUnlock={onRequestUnlock} empty="六個面向還沒有資料。">
        <div className={`hm-dims${Object.keys(links).length > 0 ? ' has-links' : ''}`}>
          {breakdown?.rows.map((r) => {
            const meta = dimensionOf(r.key)
            const color = meta?.color ?? DIMENSION_FALLBACK_COLOR
            const isDrag = drag?.key === r.key
            const sp = series?.[r.key] ?? null
            const link = links[r.key]
            return (
              <div key={r.key} className="hm-dim-cell">
              <button type="button" className={`hm-dim${isDrag ? ' is-drag' : ''}${sp ? ' has-spark' : ''}`} style={{ ['--dim' as string]: color }} onClick={() => onOpen(r.key)}
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
              {link && <a className="hm-dim-open" href={link.url} target="_blank" rel="noopener noreferrer" aria-label={`開啟 ${link.name}（新分頁）`}>開啟 {link.name} ↗</a>}
              </div>
            )
          })}
        </div>
      </StateFrame>
    </HomeCard>
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

/** 成長軌跡標題列的入口（新增一個頁面入口＝加一筆） */
export const GROWTH_LINKS: ReadonlyArray<{ href: string; label: string; testId?: string }> = [
  { href: '#year', label: '年度回顧', testId: 'hm-year-link' },
  { href: '#graph/timeline', label: '時間軸' },
  { href: '#graph', label: '關係宇宙' },
  { href: '#architecture', label: '知識庫架構', testId: 'hm-arch-link' },
]

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
    <HomeCard id="sec-growth" className="hm-growth" right={<>{GROWTH_LINKS.map((l) => <a key={l.href} href={l.href} className="hm-link" data-testid={l.testId}>{l.label} →</a>)}</>}>
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
    </HomeCard>
  )
}

// ── ④ 好玩的 ──────────────────────────────────
// ── 明日報告：前一晚看明天要注意的事 ──────────
export function BriefSection({ st, brief, parsed, crowd, onRequestUnlock, onRetry }: {
  st: BlockStatus
  brief: Brief | null
  parsed: ParsedBrief | null
  crowd: Crowd | null
  onRequestUnlock: () => void
  onRetry: () => void
}) {
  return (
    <HomeCard id="sec-brief" className="hm-brief" right={brief ? <span className="hm-muted">{brief.label}</span> : undefined}>
      <StateFrame status={st} source="明日報告" onRequestUnlock={onRequestUnlock} onRetry={onRetry} empty="明日報告每晚 21:00 整理，好了就會出現在這裡。">
        {brief && <BriefBoard brief={brief} parsed={parsed} crowd={crowd} />}
      </StateFrame>
    </HomeCard>
  )
}

// ── 陪伴：歷年今天、很久沒聯絡、什麼事讓你變好 ──────────
export function CompanionSection({ st, data, insight, onRequestUnlock, onRetry }: {
  st: BlockStatus
  data: CompanionData | null
  insight: ActivityInsight
  onRequestUnlock: () => void
  onRetry: () => void
}) {
  return (
    <HomeCard id="sec-companion" className="hm-companion">
      <StateFrame status={st} source="陪伴資料" onRequestUnlock={onRequestUnlock} onRetry={onRetry} empty="陪伴資料還沒推上來。">
        {data && (
          <div className="hm-comp-grid">
            <div data-testid="on-this-day">
              <h3 className="hm-h3">🗓️ 歷年今天</h3>
              {data.onThisDay.length === 0 ? <p className="hm-muted">往年的今天沒有紀錄。</p> : (
                <ul className="hm-comp-list">
                  {data.onThisDay.slice(0, 5).map((e) => <li key={`${e.date}-${e.title}`}><span className="hm-muted">{e.date.slice(0, 4)}</span> {e.title}</li>)}
                </ul>
              )}
            </div>
            <div data-testid="quiet-people">
              <h3 className="hm-h3">👋 很久沒聯絡</h3>
              {data.quietPeople.length === 0 ? <p className="hm-muted">最近都有聯絡。</p> : (
                <ul className="hm-comp-list">
                  {data.quietPeople.slice(0, 5).map((p) => <li key={p.name} title={p.lastEvent ?? undefined}>{p.name}<span className="hm-muted">　{p.daysQuiet} 天前</span></li>)}
                </ul>
              )}
            </div>
            <div data-testid="activity-insight">
              <h3 className="hm-h3">🔍 什麼事讓你變好</h3>
              <p className={insight.ready ? '' : 'hm-muted'}>{insight.text}</p>
            </div>
          </div>
        )}
      </StateFrame>
    </HomeCard>
  )
}

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
    <HomeCard id="sec-fun" className="hm-fun" right={<button type="button" className="hm-link" onClick={onOpenIdeas}>全部想法 →</button>}>
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
    </HomeCard>
  )
}

// ── ⑤ 系統一顆燈 ──────────────────────────────
export function SystemSection({ st, light, onOpen, onRequestUnlock }: {
  st: BlockStatus
  light: SystemLight
  onOpen: () => void
  onRequestUnlock: () => void
}) {
  const alert = light.level === 'warn' || light.level === 'crit'
  const color = LAMP[light.level]
  return (
    <HomeCard id="sec-sys" className={`hm-sys${alert ? ' is-alert' : ''}`} head={false} data={{ level: light.level }} style={alert ? { borderColor: color } : undefined}>
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
    </HomeCard>
  )
}
