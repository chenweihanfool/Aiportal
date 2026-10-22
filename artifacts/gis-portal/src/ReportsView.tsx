import { useEffect, useMemo, useState } from 'react'
import { apiFetchReports, type Report, type ReportPeriod } from './reportsApi'
import { useAsync } from './homeHooks'
import { Skeleton } from './StateFrame'
import { COLOR, FONT } from './theme'
import {
  FUNNEL_STEPS, PERIOD_LABEL, SERIES_ROWS, barPct, cellLevel, dayOfMonth, delta, funnelRows, ganttBars, isEmptyReport, periodLabel, pinPositions,
  reportsOf, topCounts, type Delta,
} from './reportsView'

// 週報／月報的視覺化頁（#reports／#reports/month）。圖在上、原本的文字報表在日記與 pipeline/報表/ 裡。
// 資料來自 feed kb-report-stats（kb-pipeline 的 report-stats-pusher.py 約每小時推一次）；沒有新後端、圖全是 SVG／CSS，不引入圖表套件。
// 設計：kb-pipeline docs/report-visual-design.md。先做週與月；日／季／年之後補。
// 旅遊只算有趟次檔的旅程（使用者 2026-10-22 裁定），日記裡的景點不算。

const PIN_COLOR = { visited: COLOR.ok, favorite: COLOR.amber, want: COLOR.steel } as const
const PIN_LABEL = { visited: '吃過', favorite: '愛店', want: '想吃' } as const

function Stat({ icon, title, value, unit, d, sub }: { icon: string; title: string; value: number; unit: string; d: Delta; sub?: string }) {
  return (
    <div className="rp-stat" data-tone={d.tone}>
      <span className="rp-stat-t"><span aria-hidden>{icon}</span>{title}</span>
      <b className="rp-stat-v">{value}<small>{unit}</small></b>
      <span className="rp-stat-d">{d.text}</span>
      {sub && <span className="rp-stat-s">{sub}</span>}
    </div>
  )
}

function Bars({ rows, label }: { rows: Array<{ label: string; value: number; pct: number }>; label: string }) {
  if (rows.length === 0) return <p className="hm-note">這期沒有資料。</p>
  return (
    <ul className="rp-bars" aria-label={label}>
      {rows.map((r) => (
        <li key={r.label}><span className="rp-bar-l">{r.label}</span><span className="rp-bar-track" aria-hidden><i style={{ width: `${r.pct}%` }} /></span><b>{r.value}</b></li>
      ))}
    </ul>
  )
}

function Rhythm({ r }: { r: Report }) {
  const monthly = r.period === 'month'
  return (
    <section className="hm-card rp-rhythm" aria-label="活動節奏" data-testid="rp-rhythm">
      <h2 className="hm-h">活動節奏<span className="hm-h-right rp-hint">每格一天，越深越多</span></h2>
      {r.series.length === 0 ? <p className="hm-note">沒有逐日資料。</p> : SERIES_ROWS.map((row) => (
        <div key={row.key} className="rp-row" role="img"
          aria-label={`${row.label}：${r.series.filter((s) => s[row.key] > 0).length} 天有紀錄`}>
          <span className="rp-row-l">{row.label}</span>
          <div className="rp-cells" data-dense={monthly ? 'true' : undefined} style={{ gridTemplateColumns: `repeat(${r.series.length}, minmax(0, 1fr))` }}>
            {r.series.map((s) => (
              <i key={s.date} className="rp-cell" data-lv={cellLevel(s[row.key])} data-k={row.key}
                title={`${s.date.slice(5)}：${s[row.key]}`}>{!monthly ? dayOfMonth(s) : ''}</i>
            ))}
          </div>
        </div>
      ))}
    </section>
  )
}

function IdeasCard({ r }: { r: Report }) {
  const funnel = funnelRows(r.ideas.funnel)
  const cats = topCounts(r.ideas.byCategory)
  return (
    <section className="hm-card" aria-label="想法" data-testid="rp-ideas">
      <h2 className="hm-h">💡 想法</h2>
      <h3 className="rp-sub">本期新想法的現況（{FUNNEL_STEPS.map((s) => s.label.slice(2)).join('→')}）</h3>
      <ul className="rp-bars" aria-label="想法漏斗">
        {funnel.map((f) => (
          <li key={f.key}><span className="rp-bar-l">{f.label}</span><span className="rp-bar-track" aria-hidden><i style={{ width: `${f.pct}%` }} /></span><b>{f.value}</b></li>
        ))}
      </ul>
      <p className="rp-line">
        本期實行 <b>{r.ideas.done}</b>、開始做 <b>{r.ideas.started}</b>；期末還開著 <b>{r.ideas.openAtEnd}</b> 個
        {r.ideas.doneRate !== null && <>，實行率 <b>{Math.round(r.ideas.doneRate * 100)}%</b></>}。
      </p>
      <h3 className="rp-sub">類別</h3>
      <Bars rows={cats} label="想法類別" />
      <h3 className="rp-sub">最值得先做的前三名</h3>
      {r.ideas.top3.length === 0 ? <p className="hm-note">沒有開放中的想法。</p> : (
        <ol className="rp-top3">
          {r.ideas.top3.map((t) => <li key={t.id}><span>{t.title}</span><small>{t.why.join('；')}</small></li>)}
        </ol>
      )}
      {r.ideas.oldestOpen && <p className="rp-line">放最久的：{r.ideas.oldestOpen.title}（{r.ideas.oldestOpen.days} 天）</p>}
    </section>
  )
}

function FoodCard({ r }: { r: Report }) {
  const W = 320, H = 180
  const pins = useMemo(() => pinPositions(r.food.pins, W, H), [r.food.pins])
  const total = r.food.added + r.food.visited
  return (
    <section className="hm-card" aria-label="美食" data-testid="rp-food">
      <h2 className="hm-h">🍜 美食<span className="hm-h-right"><a href="#food" className="hm-link">美食地圖 →</a></span></h2>
      <p className="rp-line">
        新增想吃 <b>{r.food.added}</b>、吃過 <b>{r.food.visited}</b>
        {r.food.avgRating !== null && <>，平均 <b>{r.food.avgRating}</b> 分</>}；想吃清單累積 <b>{r.food.wantBacklog}</b> 間。
      </p>
      {r.food.oldestWant && <p className="rp-line">想吃最久：{r.food.oldestWant.name}（{r.food.oldestWant.days} 天）</p>}
      <h3 className="rp-sub">菜系</h3>
      <Bars rows={topCounts(r.food.byCuisine)} label="菜系" />
      <h3 className="rp-sub">地區</h3>
      <Bars rows={topCounts(r.food.byArea)} label="地區" />
      <h3 className="rp-sub">這期的地點（北在上，相對位置）</h3>
      {pins.length === 0 ? <p className="hm-note">{total === 0 ? '這期沒有美食紀錄。' : '這期的美食沒有座標。'}</p> : (
        <>
          <svg viewBox={`0 0 ${W} ${H}`} className="rp-map" role="img" aria-label={`本期 ${pins.length} 個地點的相對位置`}>
            <rect x="0.5" y="0.5" width={W - 1} height={H - 1} rx="8" fill="none" stroke="var(--c-line)" />
            {pins.map((p, i) => (
              <circle key={`${p.name}-${i}`} cx={p.x} cy={p.y} r="6" fill={PIN_COLOR[p.status]} fillOpacity="0.85" stroke="var(--c-bg)" strokeWidth="1.5">
                <title>{`${p.name}（${PIN_LABEL[p.status]}）`}</title>
              </circle>
            ))}
          </svg>
          <p className="rp-legend">
            {(['visited', 'favorite', 'want'] as const).map((k) => (
              <span key={k}><i style={{ background: PIN_COLOR[k] }} />{PIN_LABEL[k]}</span>
            ))}
          </p>
        </>
      )}
    </section>
  )
}

function TravelCard({ r }: { r: Report }) {
  const bars = useMemo(() => ganttBars(r.travel.trips, r.range), [r.travel.trips, r.range])
  return (
    <section className="hm-card" aria-label="旅遊" data-testid="rp-travel">
      <h2 className="hm-h">🧭 旅遊<span className="hm-h-right"><a href="#trips" className="hm-link">遊記 →</a></span></h2>
      {bars.length === 0 ? <p className="hm-note">這期沒有旅程。</p> : (
        <>
          <p className="rp-line">出門 <b>{r.travel.tripDays}</b> 天、相片 <b>{r.travel.photos}</b> 張{r.travel.areas.length > 0 && <>，去了 {r.travel.areas.join('、')}</>}。</p>
          <div className="rp-gantt" role="img" aria-label="旅程在本期的位置">
            {bars.map((b) => (
              <a key={b.id} className="rp-trip" href={`#trips/${encodeURIComponent(b.id)}`} style={{ marginLeft: `${b.leftPct}%`, width: `${b.widthPct}%` }}
                title={`${b.title}：${b.start}～${b.end}`}>{b.title}</a>
            ))}
            <div className="rp-axis" aria-hidden><span>{r.range[0].slice(5)}</span><span>{r.range[1].slice(5)}</span></div>
          </div>
        </>
      )}
      <p className="hm-note">只算有趟次檔的旅程。</p>
    </section>
  )
}

export function ReportsView({ period, unlockedPassword, onBack, onRequestUnlock }: {
  period: ReportPeriod
  unlockedPassword: string | null
  onBack: () => void
  onRequestUnlock: () => void
}) {
  const feed = useAsync(unlockedPassword, apiFetchReports)
  const list = useMemo(() => reportsOf(feed.data?.reports ?? [], period), [feed.data, period])
  const [idx, setIdx] = useState(0)
  useEffect(() => { setIdx(0) }, [period])
  const r = list[Math.min(idx, Math.max(0, list.length - 1))] ?? null

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape' && !e.defaultPrevented) onBack() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onBack])

  const setPeriod = (p: ReportPeriod) => { window.location.hash = p === 'week' ? 'reports' : 'reports/month' }

  return (
    <div className="dp-page rp-page" data-testid="reports-page" data-period={period}
      style={{ position: 'fixed', inset: 0, background: COLOR.panelDeep, display: 'flex', flexDirection: 'column', zIndex: 200, color: COLOR.ink, fontFamily: FONT.body }}>
      <header className="dp-head">
        <a href="#" data-testid="dp-back" className="dp-back" onClick={(e) => { e.preventDefault(); onBack() }}>← 首頁</a>
        <nav className="yr-nav" aria-label="切換週期">
          {(['week', 'month'] as const).map((p) => (
            <button key={p} type="button" className="dp-range" aria-pressed={p === period} data-testid={`rp-tab-${p}`} onClick={() => setPeriod(p)}>{PERIOD_LABEL[p]}</button>
          ))}
        </nav>
        <span className="dp-title" aria-hidden>報表視覺化</span>
      </header>
      <div className="dp-body">
        <div className="dp-wrap yr-wrap">
          {!unlockedPassword ? (
            <section className="hm-card"><button type="button" className="hm-lock" onClick={onRequestUnlock}>🔒 解鎖後顯示</button></section>
          ) : feed.loading ? <Skeleton lines={4} /> : feed.error && !feed.data ? (
            <section className="hm-card"><p className="hm-note">報表資料暫時讀不到。<button type="button" className="hm-retry" onClick={feed.reload}>重試</button></p></section>
          ) : !feed.data || !r ? (
            <section className="hm-card" data-testid="rp-empty"><p className="hm-note">
              還沒有{PERIOD_LABEL[period]}資料。推送端（kb-pipeline 的 report-stats-pusher.py）部署後約一小時內會出現。
            </p></section>
          ) : (
            <>
              <div className="rp-nav">
                <button type="button" className="dp-range" disabled={idx >= list.length - 1} data-testid="rp-prev" onClick={() => setIdx(idx + 1)}>← 前一{period === 'week' ? '週' : '月'}</button>
                <h1 className="yr-title" data-testid="rp-title">{PERIOD_LABEL[period]}　{periodLabel(r)}</h1>
                <button type="button" className="dp-range" disabled={idx <= 0} data-testid="rp-next" onClick={() => setIdx(idx - 1)}>後一{period === 'week' ? '週' : '月'} →</button>
              </div>
              {r.partial && <p className="hm-note" data-testid="rp-partial">這{period === 'week' ? '週' : '個月'}還沒結束，數字會繼續變。</p>}
              {feed.data.warnings.length > 0 && <p className="hm-note" role="status">資料來源有問題：{feed.data.warnings.join('；')}</p>}
              {isEmptyReport(r) ? (
                <section className="hm-card" data-testid="rp-none"><p className="hm-note">這{period === 'week' ? '週' : '個月'}沒有想法、美食或旅程的紀錄。</p></section>
              ) : (
                <>
                  <section className="rp-stats" aria-label="三個主題的數字">
                    <Stat icon="💡" title="新想法" value={r.ideas.new} unit="個" d={delta(r.ideas.new, r.prev.ideas.new)} sub={`實行 ${r.ideas.done}`} />
                    <Stat icon="🍜" title="新增想吃" value={r.food.added} unit="間" d={delta(r.food.added, r.prev.food.added)} sub={`吃過 ${r.food.visited}`} />
                    <Stat icon="🧭" title="出門天數" value={r.travel.tripDays} unit="天" d={delta(r.travel.tripDays, r.prev.travel.tripDays)} sub={`${r.travel.trips.length} 趟`} />
                  </section>
                  <Rhythm r={r} />
                  <div className="rp-grid">
                    <IdeasCard r={r} />
                    <FoodCard r={r} />
                    <TravelCard r={r} />
                  </div>
                </>
              )}
              <p className="hm-note rp-foot">資料更新於 {feed.data.computedAt.slice(0, 16).replace('T', ' ')}；與「{r.prev.range[0].slice(5)}～{r.prev.range[1].slice(5)}」比較。文字總結在日記與 pipeline/報表/ 的{PERIOD_LABEL[period]}。</p>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
