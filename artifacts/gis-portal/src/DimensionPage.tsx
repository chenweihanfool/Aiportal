import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { biggestDrag, buildHhiBreakdown } from './boardView'
import { SCORE_NOTE, deltaText, dimHash, dimNeighbors, dimOverview, rangeStats, recentDigest } from './dimensionPage'
import { fetchHhiHistoryStrict } from './homeApi'
import { DIMENSIONS, DIMENSION_FALLBACK_COLOR, dimensionOf } from './dimensions'
import { useAsync, useNow } from './homeHooks'
import { EXPECTED_EVERY_MIN, blockState, buildDimensionHeatmap, dimensionSeries, historyUpdatedAtMs, sparkGeometry, taipeiDate, type DimSeries } from './homeView'
import { YearHeat } from './HomeSections'
import { Skeleton, StateFrame } from './StateFrame'
import { TaskGantt } from './TaskGantt'
import { COLOR, FONT } from './theme'

// 面向頁（#dim/<key>）：從首頁點某個面向進來，看這一個面向自己的東西——
// 現在的分數與權重、近 30／90 天走勢與統計、這個分數怎麼來（原始數據與算法）、相關連結。
// 版面（2.62.0，使用者 2026-10-25「電腦版沒有善用空間」）：寬螢幕三欄＝左「六個面向一覽」｜中主內容｜右「近況＋相關」；
// 中等寬度兩欄（側欄併到右邊）；手機單欄依常看程度排序。「分數怎麼來」預設收起放在主欄最下面。
// 資料全部來自既有接口：/api/dashboard 的 hhi 摘要（分數、權重）、/api/happiness/history（每面向的 components）、
// 各子系統摘要（由 App.tsx 組成 detail 傳進來）。
// 從容（calm）另外在下方放任務甘特圖（泛用 feed vikunja-gantt，見 TaskGantt.tsx）。

// 365 天：走勢圖只取近 30／90 天（dimensionSeries 依視窗過濾），年熱圖用整整一年
const fetchHistory365 = (pw: string) => fetchHhiHistoryStrict(pw, 365)

const DETAIL_OPEN_KEY = 'dp-detail-open'
const readDetailOpen = (): boolean => { try { return localStorage.getItem(DETAIL_OPEN_KEY) === '1' } catch { return false } }

export interface DimLink { label: string; hash?: string; onClick?: () => void }

export function DimensionPage({ dimKey, hhiData, hhiFetchedAt, hhiError, unlocked, unlockedPassword, toneOf, onRequestUnlock, detail, links }: {
  dimKey: string
  hhiData: Record<string, unknown> | undefined
  hhiFetchedAt?: string | null
  hhiError?: boolean
  unlocked: boolean
  unlockedPassword: string | null
  toneOf: (s: number) => { color: string; label: string }
  onRequestUnlock: () => void
  /** 這個面向的原始數據與算法（App.tsx 依面向組好；null＝沒有） */
  detail: ReactNode
  links: DimLink[]
}) {
  const dim = dimensionOf(dimKey)
  const color = dim?.color ?? DIMENSION_FALLBACK_COLOR
  const pw = unlocked && unlockedPassword ? unlockedPassword : null
  const now = useNow()
  const nowMs = now.getTime()
  const todayIso = taipeiDate(now)
  const [range, setRange] = useState<30 | 90>(30)
  // Esc 回首頁（燈箱、對話框之類在上層的東西自己會攔掉 Esc）
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape' && !e.defaultPrevented) window.location.hash = '' }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const breakdown = useMemo(() => buildHhiBreakdown(hhiData), [hhiData])
  const row = breakdown?.rows.find((r) => r.key === dimKey) ?? null
  const drag = breakdown ? biggestDrag(breakdown.rows) : null
  const isDrag = !!row && drag?.key === row.key
  const history = useAsync(pw, fetchHistory365)
  const series = useMemo(() => (history.data ? dimensionSeries(history.data, dimKey, todayIso, range) : null), [history.data, dimKey, todayIso, range])
  const stats = useMemo(() => rangeStats(series), [series])
  const heat = useMemo(() => (history.data ? buildDimensionHeatmap(history.data, dimKey, todayIso, 365) : null), [history.data, dimKey, todayIso])
  const digest = useMemo(() => (history.data ? recentDigest(history.data, dimKey, todayIso) : null), [history.data, dimKey, todayIso])
  const overview = useMemo(() => (breakdown ? dimOverview(breakdown.rows, dimKey) : null), [breakdown, dimKey])
  const [detailOpen, setDetailOpen] = useState(readDetailOpen)
  useEffect(() => { try { localStorage.setItem(DETAIL_OPEN_KEY, detailOpen ? '1' : '0') } catch { /* 無痕或封鎖儲存：只是不記得 */ } }, [detailOpen])

  const heroSt = blockState({
    unlocked: !!pw, loading: !hhiData && !hhiError, error: !!hhiError, hasData: !!row && row.value !== null, nowMs,
    updatedAtMs: hhiFetchedAt ? Date.parse(hhiFetchedAt) : null, expectedEveryMin: EXPECTED_EVERY_MIN.hhi,
  })
  const trendSt = blockState({
    unlocked: !!pw, loading: history.loading, error: history.error, hasData: history.data !== null, nowMs,
    updatedAtMs: history.data ? historyUpdatedAtMs(history.data) : null, expectedEveryMin: EXPECTED_EVERY_MIN.hhiHistory,
  })
  const nb = dimNeighbors(dimKey)
  const about = dim?.about ?? null
  const tone = row && row.value !== null ? toneOf(row.value) : null
  const delta = deltaText(series?.delta ?? null)

  if (!dim) {
    return (
      <Shell title="面向" dimKey={dimKey}>
        <div className="dp-body"><div className="dp-wrap"><p className="hm-note">找不到這個面向。<a href="#" onClick={(e) => { e.preventDefault(); window.location.hash = '' }} style={{ color: COLOR.amber }}>回首頁</a></p></div></div>
      </Shell>
    )
  }

  return (
    <Shell title={dim.label} dimKey={dimKey}>
      <div className="dp-body" data-testid="dim-page" data-dim={dimKey}>
        <div className="dp-wrap" style={{ ['--dim' as string]: color }}>
          <div className="dp-layout">
            <div className="dp-main">
              <section className="hm-card dp-hero" aria-label={`${dim.label}現況`}>
                <div className="dp-hero-top">
                  <span className="dp-ico" aria-hidden>{dim.icon}</span>
                  <h2 className="dp-name">{dim.label}</h2>
                  {isDrag && <span className="hm-chip hm-chip--warn" title="權重 × 離滿分的差最大，補它最能拉高總分">目前最大短板</span>}
                </div>
                <div className="dp-hero-row">
                  <StateFrame status={heroSt} source="幸福指數" onRequestUnlock={onRequestUnlock} skeleton={<Skeleton lines={2} />}
                    empty="這個面向現在沒有分數（來源系統還沒有資料）。" className="dp-hero-frame">
                    {row && row.value !== null && tone && (
                      <div className="dp-hero-body">
                        <div className="dp-score" aria-label={`${dim.label} ${Math.round(row.value)} 分，${tone.label}`}>
                          <span className="dp-score-n" style={{ color }}>{Math.round(row.value)}</span><span className="dp-score-of">/100</span>
                        </div>
                        <div className="dp-meta">
                          <span className="dp-tone" style={{ color: tone.color }}>{tone.label}</span>
                          {delta && <span className="dp-delta" title="與前一個有資料的日子相比" style={{ color: (series?.delta ?? 0) > 0 ? COLOR.ok : (series?.delta ?? 0) < 0 ? COLOR.concern : COLOR.steelDim }}>{delta}</span>}
                          <span className="dp-wt">權重 {row.weightPct}%・貢獻 {row.points ?? '—'} 分</span>
                        </div>
                      </div>
                    )}
                  </StateFrame>
                  <div className="dp-hero-text">
                    {about && <p className="dp-about"><b>衡量什麼：</b>{about.measures}<span className="dp-src">資料來源：{about.source}</span></p>}
                    <p className="dp-note">{SCORE_NOTE}</p>
                  </div>
                </div>
              </section>

              {dimKey === 'calm' && <TaskGantt pw={pw} now={now} color={color} onRequestUnlock={onRequestUnlock} />}

              <section className="hm-card dp-trend" aria-label={`${dim.label}走勢`}>
                <h2 className="hm-h">走勢<span className="hm-h-right">
                  {([30, 90] as const).map((n) => (
                    <button key={n} type="button" className={`dp-range${range === n ? ' is-on' : ''}`} aria-pressed={range === n} data-testid={`dp-range-${n}`} onClick={() => setRange(n)}>近 {n} 天</button>
                  ))}
                </span></h2>
                <StateFrame status={trendSt} source="幸福指數歷史" onRequestUnlock={onRequestUnlock} onRetry={history.reload} skeleton={<Skeleton lines={3} />} className="dp-trend-frame">
                  {series && stats ? (
                    <>
                      <DimChart series={series} color={color} avg={stats.avg} />
                      <dl className="dp-stats" data-testid="dp-stats">
                        <div><dt>平均</dt><dd>{stats.avg}</dd></div>
                        <div><dt>最高</dt><dd>{stats.max.value}<small>{stats.max.date.slice(5)}</small></dd></div>
                        <div><dt>最低</dt><dd>{stats.min.value}<small>{stats.min.date.slice(5)}</small></dd></div>
                        <div><dt>區間變化</dt><dd style={{ color: stats.change === null ? undefined : stats.change > 0 ? COLOR.ok : stats.change < 0 ? COLOR.concern : undefined }}>{stats.change === null ? '—' : stats.change > 0 ? `+${stats.change}` : String(stats.change)}<small>{stats.firstDate.slice(5)} 起</small></dd></div>
                      </dl>
                      <p className="dp-note">有資料 {stats.count} 天；沒有資料的日子斷線，不補 0。</p>
                    </>
                  ) : (
                    <p className="hm-note" data-testid="dp-trend-pending">走勢還沒有資料：每個面向的每日分數要等後端的歷史接口（components）有資料才畫得出來，目前有效的天數不到 2 天。</p>
                  )}
                </StateFrame>
              </section>

              <section className="hm-card dp-heat" aria-label={`${dim.label}近一年每天`} data-testid="dp-heat">
                <h2 className="hm-h">近一年每天</h2>
                <StateFrame status={trendSt} source="幸福指數歷史" onRequestUnlock={onRequestUnlock} onRetry={history.reload} skeleton={<Skeleton lines={3} />} className="dp-heat-frame">
                  {heat && heat.withData >= 2 ? (
                    <YearHeat heat={heat} toneOf={toneOf} label={dim.label} />
                  ) : (
                    <p className="hm-note" data-testid="dp-heat-pending">這個面向近一年有紀錄的日子還不到 2 天（目前 {heat?.withData ?? 0} 天），累積後才畫年熱圖；沒有紀錄的日子是空格，不是 0。</p>
                  )}
                </StateFrame>
              </section>

              {/* 「分數怎麼來」不常看（使用者 2026-10-25）：預設收起、放最下面；展開狀態記在這台瀏覽器 */}
              <details className="hm-card dp-detail" open={detailOpen} onToggle={(e) => setDetailOpen(e.currentTarget.open)} aria-label={`${dim.label}的分數怎麼來`}>
                <summary className="dp-detail-sum" data-testid="dp-detail-toggle">
                  <span className="dp-caret" aria-hidden>▸</span><span className="dp-detail-t">分數怎麼來</span><span className="dp-detail-hint">原始數據與算法</span>
                </summary>
                {!pw ? (
                  <button type="button" className="hm-lock dp-lock" onClick={onRequestUnlock}>🔒 解鎖後顯示</button>
                ) : detail ? <div className="dp-detail-body" data-testid="dp-detail">{detail}</div> : <p className="hm-note">這個面向的來源系統還沒有送出資料。</p>}
              </details>
            </div>

            <div className="dp-aside">
              <aside className="dp-side dp-side--l" aria-label="六個面向一覽">
                <section className="hm-card dp-ov" data-testid="dp-overview">
                  <h2 className="hm-h">六個面向{breakdown && <span className="hm-h-right">幸福指數 <b className="dp-ov-total">{Math.round(breakdown.displayed)}</b></span>}</h2>
                  <StateFrame status={heroSt} source="幸福指數" onRequestUnlock={onRequestUnlock} skeleton={<Skeleton lines={4} />} className="dp-ov-frame">
                    {overview && (
                      <>
                        <ul className="dp-ov-list">
                          {overview.rows.map((r) => {
                            const d = dimensionOf(r.key)
                            const on = r.key === dimKey
                            return (
                              <li key={r.key}>
                                <a href={`#${dimHash(r.key)}`} className={`dp-ov-row${on ? ' is-on' : ''}`} aria-current={on ? 'page' : undefined} style={{ ['--dim' as string]: d?.color ?? DIMENSION_FALLBACK_COLOR }}
                                  title={r.gap === null ? `${r.label}：沒有分數` : `${r.label} ${Math.round(r.value!)} 分・權重 ${r.weightPct}%・還能補 ${r.gap} 分`}
                                  onClick={(e) => { e.preventDefault(); window.location.hash = dimHash(r.key) }}>
                                  <span className="dp-ov-name"><span aria-hidden>{d?.icon}</span>{r.label}{drag?.key === r.key && <em title="權重 × 離滿分的差最大">短板</em>}</span>
                                  <span className="dp-ov-n">{r.value === null ? '—' : Math.round(r.value)}</span>
                                  <span className="dp-ov-bar" aria-hidden><i style={{ width: `${r.value ?? 0}%` }} /></span>
                                  <span className="dp-ov-gap">{r.gap === null ? '' : `可補 ${r.gap}`}</span>
                                </a>
                              </li>
                            )
                          })}
                        </ul>
                        {overview.gain10 !== null && <p className="dp-note">{dim.label}再 +10 分，總分約 <b className="dp-hl">+{overview.gain10}</b>。「可補」＝權重 × 離滿分的差，越大越值得補。</p>}
                      </>
                    )}
                  </StateFrame>
                </section>
              </aside>

              <aside className="dp-side dp-side--r" aria-label="近況與相關">
                <section className="hm-card dp-recent" data-testid="dp-recent">
                  <h2 className="hm-h">近況</h2>
                  <StateFrame status={trendSt} source="幸福指數歷史" onRequestUnlock={onRequestUnlock} onRetry={history.reload} skeleton={<Skeleton lines={4} />} className="dp-recent-frame">
                    {digest ? (
                      <dl className="dp-kv">
                        <div><dt>近 7 天平均</dt><dd>{digest.last7 ?? '—'}{digest.weekChange !== null && <small style={{ color: digest.weekChange > 0 ? COLOR.ok : digest.weekChange < 0 ? COLOR.concern : undefined }}>{digest.weekChange > 0 ? `▲ ${digest.weekChange}` : digest.weekChange < 0 ? `▼ ${-digest.weekChange}` : '持平'}　前 7 天 {digest.prev7}</small>}</dd></div>
                        <div><dt>最新一天在近 90 天</dt><dd>第 {digest.rank.pos} 高<small>共 {digest.rank.of} 天・{digest.rank.date.slice(5)} 為 {digest.rank.value}</small></dd></div>
                        <div><dt>連續{digest.streak.side === 'above' ? '高於' : '低於'}平均</dt><dd style={{ color: digest.streak.side === 'above' ? COLOR.ok : COLOR.concern }}>{digest.streak.days} 天<small>90 天平均 {digest.avg90}</small></dd></div>
                        {digest.weekday && <div><dt>星期幾規律</dt><dd className="dp-kv-wd">週{digest.weekday.best.day}最高<small>{digest.weekday.best.avg}・週{digest.weekday.worst.day}最低 {digest.weekday.worst.avg}</small></dd></div>}
                      </dl>
                    ) : (
                      <p className="hm-note">每日歷史累積到 2 天以上才算得出近況。</p>
                    )}
                  </StateFrame>
                </section>
                {links.length > 0 && (
                  <section className="hm-card dp-links" aria-label="相關連結">
                    <h2 className="hm-h">相關</h2>
                    <div className="dp-link-row">
                      {links.map((l) => (
                        <a key={l.label} className="dp-link" href={l.hash !== undefined ? `#${l.hash}` : '#'} onClick={(e) => { e.preventDefault(); if (l.onClick) l.onClick(); else if (l.hash !== undefined) window.location.hash = l.hash }}>{l.label}</a>
                      ))}
                    </div>
                  </section>
                )}
              </aside>
            </div>
          </div>
          {nb && (
            <nav className="dp-pager" aria-label="切換面向">
              <a href={`#${dimHash(nb.prev)}`} data-testid="dp-prev" onClick={(e) => { e.preventDefault(); window.location.hash = dimHash(nb.prev) }}>← {dimensionOf(nb.prev)?.label}</a>
              <a href={`#${dimHash(nb.next)}`} data-testid="dp-next" onClick={(e) => { e.preventDefault(); window.location.hash = dimHash(nb.next) }}>{dimensionOf(nb.next)?.label} →</a>
            </nav>
          )}
        </div>
      </div>
    </Shell>
  )
}

function Shell({ title, dimKey, children }: { title: string; dimKey: string; children: ReactNode }) {
  return (
    <div className="dp-page" style={{ position: 'fixed', inset: 0, background: COLOR.panelDeep, display: 'flex', flexDirection: 'column', zIndex: 200, color: COLOR.ink, fontFamily: FONT.body }}>
      <header className="dp-head">
        <a href="#" data-testid="dp-back" className="dp-back" onClick={(e) => { e.preventDefault(); window.location.hash = '' }}>← 首頁</a>
        <nav className="dp-nav" aria-label="六個面向">
          {DIMENSIONS.map((d) => (
            <a key={d.key} href={`#${dimHash(d.key)}`} data-testid={`dp-nav-${d.key}`} className={`dp-chip${d.key === dimKey ? ' is-on' : ''}`} style={{ ['--dim' as string]: d.color }}
              aria-current={d.key === dimKey ? 'page' : undefined} aria-label={d.label} title={d.label}
              onClick={(e) => { e.preventDefault(); window.location.hash = dimHash(d.key) }}>
              <span aria-hidden>{d.icon}</span><span className="dp-chip-t">{d.label}</span>
            </a>
          ))}
        </nav>
        <span className="dp-title" aria-hidden>{title}</span>
      </header>
      {children}
    </div>
  )
}

// 走勢圖：縱軸依區間內的最小／最大值縮放（至少 20 分寬，免得幾乎持平的線被放大成劇烈起伏）；沒資料的日子斷線；虛線＝區間平均。
// 寬度跟著卡片量（ResizeObserver），文字維持 10px、高度固定，寬螢幕不會被等比例放成一大塊
const PL = 30, PR = 12, PT = 12, PB = 22
function DimChart({ series, color, avg }: { series: DimSeries; color: string; avg: number }) {
  const ref = useRef<SVGSVGElement>(null)
  const [W, setW] = useState(640)
  useEffect(() => {
    const el = ref.current
    if (!el || typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver(([e]) => { const w = Math.round(e!.contentRect.width); if (w > 0) setW(Math.max(280, w)) })
    ro.observe(el)
    return () => ro.disconnect()
  }, [])
  const H = W < 520 ? 170 : 220
  const g = sparkGeometry(series, 20)
  const x = (nx: number) => PL + nx * (W - PL - PR)
  const y = (ny: number) => PT + ny * (H - PT - PB)
  const yOf = (v: number) => y(1 - (v - g.lo) / (g.hi - g.lo))
  const first = series.days[0]!.date
  const lastDay = series.days[series.days.length - 1]!.date
  return (
    <svg ref={ref} className="dp-chart" viewBox={`0 0 ${W} ${H}`} style={{ aspectRatio: `${W} / ${H}` }} role="img" aria-label={`近 ${series.days.length} 天走勢，最新 ${Math.round(series.last.value)} 分`} data-testid="dp-chart">
      {[g.hi, (g.hi + g.lo) / 2, g.lo].map((v, i) => (
        <g key={i}>
          <line x1={PL} x2={W - PR} y1={yOf(v)} y2={yOf(v)} stroke="#2a2d36" strokeWidth={1} />
          <text x={PL - 6} y={yOf(v) + 3} fontSize="10" textAnchor="end" fill="#5b6270" fontFamily="IBM Plex Mono, monospace">{Math.round(v)}</text>
        </g>
      ))}
      <line x1={PL} x2={W - PR} y1={yOf(avg)} y2={yOf(avg)} stroke={color} strokeOpacity={0.55} strokeWidth={1} strokeDasharray="4 4" />
      {g.lines.map((ln, i) => (
        <polyline key={i} points={ln.map((p) => `${x(p.x).toFixed(1)},${y(p.y).toFixed(1)}`).join(' ')} fill="none" stroke={color} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
      ))}
      {g.dots.map((p, i) => <circle key={i} cx={x(p.x)} cy={y(p.y)} r={2.5} fill={color} />)}
      <circle cx={x(g.end.x)} cy={y(g.end.y)} r={4.5} fill={color} stroke="#1a1c22" strokeWidth={2} />
      <text x={PL} y={H - 6} fontSize="10" fill="#5b6270" fontFamily="IBM Plex Mono, monospace">{first.slice(5)}</text>
      <text x={W - PR} y={H - 6} fontSize="10" textAnchor="end" fill="#5b6270" fontFamily="IBM Plex Mono, monospace">{lastDay.slice(5)}</text>
    </svg>
  )
}
