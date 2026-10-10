import { Component, createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react'
import { COLOR, FONT } from './theme'
import { apiFetchHermesGraph, type HermesGraphData } from './hermesGraphApi'
import {
  apiFetchBoardDiskHistory, apiFetchBoardPipeline, apiFetchBoardStatus, apiFetchHhiHistory, apiFetchIdeas, apiFetchUsage, apiPostBalance,
  type BoardDiskPoint, type HhiHistoryPoint, type BoardPipeline, type BoardStatus, type PusherHealth, type IdeaItem, type IdeasData, type IdeasMind, type UsageData,
} from './boardApi'
import { STATUS_ACTION, STATUS_ICON, STATUS_LABEL, STATUS_MARK, categoryColor, categoryCounts, filterIdeas, nextStatuses, pips, sortForList, statusCounts, statusMessage, topIdeas, type StatusFilter } from './ideasView'
import { UsedChart } from './HermesDiskPanel'
import { describeForecast, formatBytes, storageShares } from './diskView'
import { balanceChartGeometry, biggestDrag, buildHhiBreakdown, dailyBars, formatCalls, formatEmptyDay, formatUsd } from './boardView'

// 桌面首頁（≥1100px 寬、≥640px 高）的「一個畫面放得下」儀表板，首頁電腦版就只有這一塊，不必捲動。
// 舊版下方的完整面板（幸福指數雷達／30 天洞察／趨勢、六維度子系統、HERMES 戰情室的關係網路圖／管線歷史／排程／活動／容器／趨勢）
// 不再接在下面，而是收進卡片右上「詳細」打開的側邊抽屜（Drawer），功能一個都沒少，主畫面不用捲。
// 抽屜內容由 App.tsx 傳進來（那些元件都在 App.tsx，這裡不 import 它，避免循環匯入）。

const levelColor = (l: 'ok' | 'warn' | 'crit') => (l === 'crit' ? COLOR.crit : l === 'warn' ? COLOR.warn : COLOR.ok)
const pctColor = (p: number | null) => (p === null ? COLOR.steelDim : p >= 90 ? COLOR.crit : p >= 75 ? COLOR.warn : COLOR.ok)

function minutesAgo(ts: number | null): string {
  if (ts === null) return '—'
  const m = Math.max(0, Math.round((Date.now() - ts) / 60000))
  if (m < 1) return '剛剛'
  if (m < 60) return `${m} 分鐘前`
  if (m < 60 * 36) return `${Math.round(m / 60)} 小時前`
  return `${Math.round(m / 1440)} 天前`
}

function Card({ title, tag, area, action, style, children }: { title: string; tag?: ReactNode; area: string; action?: ReactNode; style?: CSSProperties; children: ReactNode }) {
  return (
    <section className={`bd-card ${area}`} style={{ background: COLOR.panel, border: `1px solid ${COLOR.line}`, borderRadius: 10, ...style }}>
      <h2 style={{ margin: 0, display: 'flex', alignItems: 'center', gap: 8, fontFamily: FONT.display, fontWeight: 700, fontSize: '0.84rem', color: COLOR.ink, letterSpacing: '0.02em' }}>
        <span className="bd-dot" aria-hidden />
        <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{title}</span>
        {tag}
        {action}
      </h2>
      {children}
    </section>
  )
}

/** 卡片右上的「詳細 ›」：打開側邊抽屜 */
const MoreBtn = ({ onClick, children = '詳細' }: { onClick: () => void; children?: ReactNode }) => (
  <button type="button" className="bd-more" onClick={onClick}>{children} ›</button>
)

type DrawerKey = 'hhi' | 'ops' | 'oll' | 'ideas'
const DrawerCtx = createContext<(k: DrawerKey) => void>(() => {})

/** 抽屜內容（App.tsx 的舊面板）若有元件出錯，只在抽屜裡顯示訊息，不拖垮整個首頁 */
class DrawerBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false }
  static getDerivedStateFromError() { return { failed: true } }
  render() {
    return this.state.failed
      ? <div style={{ color: COLOR.steelDim, fontSize: '0.85rem', padding: '1rem 0' }}>這一區暫時無法顯示（資料格式不完整），關掉抽屜不影響首頁其他卡片。</div>
      : this.props.children
  }
}

function Drawer({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  const closeRef = useRef<HTMLButtonElement>(null)
  useEffect(() => {
    const prev = document.activeElement as HTMLElement | null
    closeRef.current?.focus()
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => { window.removeEventListener('keydown', onKey); prev?.focus?.() }
  }, [onClose])
  return (
    <div className="bd-drawer-backdrop" onMouseDown={e => { if (e.target === e.currentTarget) onClose() }}>
      <aside className="bd-drawer" role="dialog" aria-modal="true" aria-label={title}>
        <header style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '0.9rem 1.2rem', borderBottom: `1px solid ${COLOR.line}` }}>
          <span className="bd-dot" aria-hidden />
          <h2 style={{ margin: 0, flex: 1, fontFamily: FONT.display, fontSize: '1.05rem', color: COLOR.ink }}>{title}</h2>
          <span style={{ fontFamily: FONT.mono, fontSize: '0.62rem', color: COLOR.steelDim }}>ESC 關閉</span>
          <button ref={closeRef} type="button" className="bd-more" onClick={onClose} aria-label="關閉">✕</button>
        </header>
        <div style={{ flex: 1, overflowY: 'auto', padding: '1.1rem 1.3rem 2rem' }}><DrawerBoundary>{children}</DrawerBoundary></div>
      </aside>
    </div>
  )
}

/** 數字從 0 跑到目標值（使用者設定「減少動態」時直接顯示） */
function useCountUp(target: number, ms = 900): number {
  const [v, setV] = useState(target)
  useEffect(() => {
    if (typeof window === 'undefined' || window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) { setV(target); return }
    let raf = 0
    const t0 = performance.now()
    const step = (t: number) => {
      const k = Math.min(1, (t - t0) / ms)
      setV(Math.round(target * (1 - Math.pow(1 - k, 3))))
      if (k < 1) raf = requestAnimationFrame(step)
    }
    raf = requestAnimationFrame(step)
    return () => cancelAnimationFrame(raf)
  }, [target, ms])
  return v
}

const Label = ({ children }: { children: ReactNode }) => (
  <span style={{ fontFamily: FONT.mono, fontSize: '0.58rem', letterSpacing: '0.14em', textTransform: 'uppercase', color: COLOR.steelDim }}>{children}</span>
)

const Chip = ({ children, color = COLOR.steelDim }: { children: ReactNode; color?: string }) => (
  <span style={{ fontFamily: FONT.mono, fontSize: '0.56rem', letterSpacing: '0.06em', color, border: `1px solid ${color}`, borderRadius: 4, padding: '2px 5px', whiteSpace: 'nowrap' }}>{children}</span>
)

const Muted = ({ children }: { children: ReactNode }) => <div style={{ fontSize: '0.72rem', color: COLOR.steelDim }}>{children}</div>

/** 量元素實際像素大小，圖表用它算座標（不用 preserveAspectRatio="none" 拉伸，字才不會變形）。 */
function useBox(minW = 240, minH = 90): [(el: HTMLDivElement | null) => void, { w: number; h: number }] {
  const [el, setEl] = useState<HTMLDivElement | null>(null)
  const [size, setSize] = useState({ w: 600, h: 150 })
  useEffect(() => {
    if (!el) return
    const ro = new ResizeObserver(entries => {
      const r = entries[0]?.contentRect
      if (r) setSize({ w: Math.max(minW, Math.round(r.width)), h: Math.max(minH, Math.round(r.height)) })
    })
    ro.observe(el)
    return () => ro.disconnect()
  }, [el, minW, minH])
  return [setEl, size]
}

function useLoad<T>(pw: string | null, fetcher: (pw: string) => Promise<T>, refreshKey = 0): { data: T | null; error: boolean; reload: () => void } {
  const [data, setData] = useState<T | null>(null)
  const [error, setError] = useState(false)
  const [tick, setTick] = useState(0)
  useEffect(() => {
    if (!pw) return
    let cancelled = false
    fetcher(pw).then(d => { if (!cancelled) { setData(d); setError(false) } }).catch(() => { if (!cancelled) setError(true) })
    return () => { cancelled = true }
  }, [pw, tick, fetcher, refreshKey])
  const reload = useCallback(() => setTick(t => t + 1), [])
  return { data, error, reload }
}

// ── Ollama 用量與預估 ───────────────────────────────
// 2026-10-09 使用者裁定「縮 Ollama」讓位給想法庫：首頁只留小卡（餘額、每天花費、用完日），
// 完整的走勢圖、每日請求數、模型分佈與「更新餘額」表單搬進抽屜（OllamaPanel），功能一個都沒少。
function OllamaPanel({ pw }: { pw: string }) {
  const { data, error, reload } = useLoad<UsageData>(pw, apiFetchUsage)
  const [formOpen, setFormOpen] = useState(false)
  const [saving, setSaving] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)
  const [fBal, setFBal] = useState('')
  const [fUsed, setFUsed] = useState('')
  const [fRefill, setFRefill] = useState('')
  const [fCap, setFCap] = useState('60')

  const openForm = () => {
    setFormError(null)
    setFBal(data?.balance ? String(data.balance.balanceUsd) : '')
    setFUsed(data?.balance?.monthUsedUsd != null ? String(data.balance.monthUsedUsd) : '')
    setFRefill(data?.balance?.refillAt ?? '')
    setFCap(String(data?.balance?.capUsd ?? 60))
    setFormOpen(true)
  }

  const submit = async () => {
    const bal = Number(fBal)
    if (fBal.trim() === '' || !Number.isFinite(bal)) { setFormError('請填目前餘額（美元）'); return }
    const body: Parameters<typeof apiPostBalance>[1] = { balanceUsd: bal }
    if (fCap.trim() !== '') body.capUsd = Number(fCap)
    if (fRefill.trim() !== '') body.refillAt = fRefill.trim()
    if (fUsed.trim() !== '') body.monthUsedUsd = Number(fUsed)
    setSaving(true)
    const err = await apiPostBalance(pw, body)
    setSaving(false)
    if (err) { setFormError(err); return }
    setFormOpen(false)
    reload()
  }

  const f = data?.forecast
  const bal = data?.balance
  const cap = bal?.capUsd ?? 60
  const [chartRef, box] = useBox()
  const PAD = { l: 38, r: 14, t: 12, b: 22 }
  const geo = useMemo(() => {
    if (!data || !f) return null
    return balanceChartGeometry({
      entries: data.entries, balanceUsd: f.balanceUsd, usdPerDay: f.usdPerDay, daysUntilEmpty: f.daysUntilEmpty,
      daysToRefill: f.daysToRefill, capUsd: cap, now: new Date(), width: box.w, height: box.h, pad: PAD,
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, f, cap, box.w, box.h])
  const bars = useMemo(() => dailyBars(data?.days ?? [], 14), [data])
  const models = useMemo(() => Object.entries(data?.last7Days ?? {}).sort((a, b) => b[1] - a[1]).slice(0, 4), [data])
  const maxModel = models.length ? Math.max(...models.map(m => m[1])) : 0

  const sourceTag = f?.source === 'observed' ? <Chip color={COLOR.ok}>依餘額實測</Chip>
    : f?.source === 'estimated' ? <Chip color={COLOR.warn}>粗估（請求數×單價）</Chip>
    : <Chip>尚無預估</Chip>

  return (
    <Card title="Ollama 雲端用量與預估" tag={sourceTag} area="bd-oll-full" style={{ height: 520, display: 'flex', flexDirection: 'column', gap: 8, padding: '0.75rem 0.9rem' }}>
      {error ? <Muted>暫時無法取得用量資料</Muted> : data === null ? <Muted>載入中…</Muted> : (
        <div className="bd-oll-body">
          <div style={{ minWidth: 0, display: 'flex', flexDirection: 'column', gap: 6 }}>
            <Label>Usage credits 餘額</Label>
            {bal ? (
              <>
                <div style={{ fontFamily: FONT.mono, fontWeight: 600, fontSize: '2.6rem', lineHeight: 1, color: levelColor(f?.level ?? 'ok') }}>
                  {formatUsd(bal.balanceUsd)}<span style={{ fontSize: '0.8rem', color: COLOR.steelDim, fontWeight: 400 }}> / ${cap}</span>
                </div>
                <div style={{ height: 6, borderRadius: 3, background: COLOR.panelRaised, overflow: 'hidden' }}>
                  <div style={{ width: `${Math.min(100, Math.max(0, (bal.balanceUsd / cap) * 100))}%`, height: '100%', background: levelColor(f?.level ?? 'ok') }} />
                </div>
                <div style={{ fontSize: '0.64rem', color: COLOR.steelDim }}>
                  {minutesAgo(Date.parse(bal.enteredAt))}輸入{bal.refillAt ? ` · ${bal.refillAt} 補點` : ''}
                </div>
              </>
            ) : (
              <div style={{ fontSize: '0.78rem', color: COLOR.steel, lineHeight: 1.6 }}>還沒輸入餘額。ollama.com 沒有可自動讀取的額度，輸入一次就能算出每天花多少、哪天用完。</div>
            )}
            <div className="bd-kv">
              <div><span>HERMES 近 7 日 / 日</span><b>{f?.callsPerDay != null ? `${formatCalls(f.callsPerDay)} 次` : '—'}</b></div>
              <div><span>預估每天花費</span><b>{f?.usdPerDay != null ? `${formatUsd(f.usdPerDay)}${f.source === 'estimated' ? '（粗估）' : ''}` : '—'}</b></div>
              <div><span>預估用完日</span><b>{formatEmptyDay(f?.emptyDate ?? null, f?.daysUntilEmpty ?? null)}</b></div>
              {bal?.monthUsedUsd != null && <div><span>本月已用</span><b>{formatUsd(bal.monthUsedUsd)}</b></div>}
            </div>
            {f && f.daysUntilEmpty !== null && (
              <div style={{ border: `1px solid ${levelColor(f.level)}`, borderRadius: 6, padding: '7px 9px', fontSize: '0.76rem', lineHeight: 1.55, color: COLOR.steel }}>
                {f.shortfallUsd !== null
                  ? <><b style={{ color: levelColor(f.level) }}>會在補點前用完。</b>照這個速度補點日前約缺 {formatUsd(f.shortfallUsd, 0)}；自動補點每次 +$5。</>
                  : <><b style={{ color: COLOR.ok }}>用量安全。</b>照這個速度，餘額撐得過補點日。</>}
              </div>
            )}
            {!formOpen ? (
              <button type="button" onClick={openForm} style={btn}>{bal ? '更新餘額' : '輸入目前餘額'}</button>
            ) : (
              <form onSubmit={e => { e.preventDefault(); void submit() }} style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6 }}>
                <label style={fld}>餘額 $<input id="bd-bal" value={fBal} onChange={e => setFBal(e.target.value)} inputMode="decimal" style={inp} autoFocus /></label>
                <label style={fld}>本月已用 $<input id="bd-used" value={fUsed} onChange={e => setFUsed(e.target.value)} inputMode="decimal" style={inp} /></label>
                <label style={fld}>補點日<input id="bd-refill" value={fRefill} onChange={e => setFRefill(e.target.value)} placeholder="2026-10-29" style={inp} /></label>
                <label style={fld}>補點上限 $<input id="bd-cap" value={fCap} onChange={e => setFCap(e.target.value)} inputMode="decimal" style={inp} /></label>
                {formError && <div style={{ gridColumn: '1 / -1', color: COLOR.crit, fontSize: '0.68rem' }}>{formError}</div>}
                <div style={{ gridColumn: '1 / -1', display: 'flex', gap: 6 }}>
                  <button type="submit" disabled={saving} style={{ ...btn, background: COLOR.amber, color: COLOR.panelDeep, borderColor: COLOR.amber }}>{saving ? '儲存中…' : '儲存'}</button>
                  <button type="button" onClick={() => setFormOpen(false)} style={btn}>取消</button>
                </div>
              </form>
            )}
          </div>

          <div style={{ minWidth: 0, display: 'flex', flexDirection: 'column', gap: 6 }}>
            <Label>餘額走勢與預測（虛線＝照目前速度）</Label>
            <div ref={chartRef} style={{ flex: '1 1 0', minHeight: 90, position: 'relative' }}>
              {geo ? (
                <svg width={box.w} height={box.h} viewBox={`0 0 ${box.w} ${box.h}`} role="img" aria-label="餘額走勢與預測" style={{ position: 'absolute', inset: 0, display: 'block' }}>
                  {geo.yTicks.map(t => (
                    <g key={t.v}>
                      <line x1={PAD.l} x2={box.w - PAD.r} y1={t.y} y2={t.y} stroke={COLOR.line} strokeWidth={1} />
                      <text x={PAD.l - 6} y={t.y + 3} textAnchor="end" fontSize={10} fontFamily={FONT.mono} fill={COLOR.steelDim}>${Math.round(t.v)}</text>
                    </g>
                  ))}
                  <line x1={geo.todayX} x2={geo.todayX} y1={PAD.t} y2={box.h - PAD.b} stroke={COLOR.steelDim} strokeDasharray="2 3" />
                  <text x={geo.todayX} y={box.h - 6} textAnchor="middle" fontSize={10} fontFamily={FONT.mono} fill={COLOR.steelDim}>今天</text>
                  {geo.refillX !== null && (
                    <>
                      <line x1={geo.refillX} x2={geo.refillX} y1={PAD.t} y2={box.h - PAD.b} stroke={COLOR.ok} strokeDasharray="2 3" />
                      <text x={geo.refillX - 4} y={PAD.t + 10} textAnchor="end" fontSize={10} fontFamily={FONT.mono} fill={COLOR.ok}>補點</text>
                    </>
                  )}
                  {geo.forecast && <line x1={geo.forecast.x1} y1={geo.forecast.y1} x2={geo.forecast.x2} y2={geo.forecast.y2} stroke={levelColor(f?.level ?? 'ok')} strokeWidth={2.5} strokeDasharray="6 4" />}
                  {geo.dots.map((d, i) => <circle key={i} cx={d.x} cy={d.y} r={4} fill={COLOR.amber} />)}
                  {geo.zero && (
                    <>
                      <circle cx={geo.zero.x} cy={geo.zero.y} r={5} fill={COLOR.crit} />
                      <text x={geo.zero.x - 8} y={geo.zero.y - 9} textAnchor="end" fontSize={11} fontFamily={FONT.mono} fill={COLOR.crit}>用完</text>
                    </>
                  )}
                </svg>
              ) : <Muted>輸入餘額後會畫出走勢</Muted>}
            </div>

            <Label>HERMES 近 14 天每日請求數</Label>
            <div style={{ display: 'flex', alignItems: 'flex-end', gap: 3, height: '16%', minHeight: 40 }} role="img" aria-label="近 14 天每日請求數">
              {bars.length === 0 ? <Muted>尚無資料（pusher 還沒推）</Muted> : bars.map(b => (
                <div key={b.date} title={`${b.date}：${b.calls} 次`} style={{ flex: 1, height: `${Math.max(4, b.ratio * 100)}%`, background: b.date === data.today ? COLOR.amber : COLOR.steelDim, borderRadius: '2px 2px 0 0', opacity: b.date === data.today ? 1 : 0.8 }} />
              ))}
            </div>

            <div style={{ display: 'grid', gap: 3, fontFamily: FONT.mono, fontSize: '0.64rem' }}>
              {models.map(([name, n]) => (
                <div key={name} style={{ display: 'grid', gridTemplateColumns: 'minmax(0,150px) minmax(0,1fr) 52px', gap: 8, alignItems: 'center', color: COLOR.steelDim }}>
                  <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{name}</span>
                  <span style={{ height: 5, background: COLOR.panelRaised, borderRadius: 3 }}><i style={{ display: 'block', height: '100%', width: `${maxModel ? Math.max(2, (n / maxModel) * 100) : 0}%`, background: '#5f9bf0', borderRadius: 3 }} /></span>
                  <span style={{ textAlign: 'right', color: COLOR.ink }}>{n.toLocaleString()}</span>
                </div>
              ))}
            </div>
            <div style={{ fontSize: '0.58rem', color: COLOR.steelDim, lineHeight: 1.4 }}>請求數只含 HERMES 這台 VPS（近 7 天）；Ollama 帳號還有其他用量來源，所以餘額與金額以你輸入的為準。</div>
          </div>
        </div>
      )}
    </Card>
  )
}

function OllamaMiniCard({ pw, refreshKey }: { pw: string; refreshKey: number }) {
  const open = useContext(DrawerCtx)
  const { data, error } = useLoad<UsageData>(pw, apiFetchUsage, refreshKey)
  const f = data?.forecast
  const bal = data?.balance
  const cap = bal?.capUsd ?? 60
  const tone = levelColor(f?.level ?? 'ok')
  return (
    <Card title="Ollama" area="bd-oll" tag={f?.source === 'estimated' ? <Chip color={COLOR.warn}>粗估</Chip> : undefined} action={<MoreBtn onClick={() => open('oll')}>更新</MoreBtn>}>
      {error ? <Muted>暫時無法取得用量資料</Muted> : data === null ? <Muted>載入中…</Muted> : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6, flex: 1, minHeight: 0, justifyContent: 'center' }}>
          {bal ? (
            <>
              <div className="bd-big" style={{ color: tone, fontSize: 'clamp(1.4rem, 3.4vh, 2.3rem)' }}>
                {formatUsd(bal.balanceUsd)}<span style={{ fontSize: '0.45em', color: COLOR.steelDim, fontWeight: 400 }}> / ${cap}</span>
              </div>
              <div style={{ height: 6, borderRadius: 3, background: COLOR.panelRaised, overflow: 'hidden' }}>
                <div style={{ width: `${Math.min(100, Math.max(0, (bal.balanceUsd / cap) * 100))}%`, height: '100%', background: tone }} />
              </div>
            </>
          ) : (
            <div style={{ fontSize: '0.72rem', color: COLOR.steel, lineHeight: 1.5 }}>還沒輸入餘額。按「更新」輸入一次就能預估哪天用完。</div>
          )}
          <div className="bd-kv">
            <div><span>預估每天</span><b>{f?.usdPerDay != null ? formatUsd(f.usdPerDay) : '—'}</b></div>
            <div><span>預估用完</span><b>{formatEmptyDay(f?.emptyDate ?? null, f?.daysUntilEmpty ?? null)}</b></div>
          </div>
          {f && f.daysUntilEmpty !== null && (
            <div style={{ fontSize: '0.7rem', lineHeight: 1.45, color: f.shortfallUsd !== null ? tone : COLOR.ok }}>
              {f.shortfallUsd !== null ? `會在補點前用完（約缺 ${formatUsd(f.shortfallUsd, 0)}）` : '用量安全，撐得過補點日'}
            </div>
          )}
        </div>
      )}
    </Card>
  )
}

// ── 💡 想法庫（2026-10-09）─────────────────────────────
// 日記管線萃取、HERMES 推上來，入口網只顯示。前三名由 kb-pipeline 的公式算（價值×可行×新鮮度×被想起×進行中），
// api-server 再乘「補短板」；系統／工作改善類也一起排，只用徽章標出類別（使用者 2026-10-09 裁定）。
const CatBadge = ({ category }: { category: string | null }) => {
  const c = categoryColor(category)
  return <span className="bd-cat" style={{ color: c, borderColor: c, background: `${c}1a` }}>{category ?? '未分類'}</span>
}

function IdeasCard({ pw }: { pw: string }) {
  const open = useContext(DrawerCtx)
  const { data, error } = useLoad<IdeasData>(pw, apiFetchIdeas)
  const counts = data ? statusCounts(data.ideas) : null
  const top = data ? topIdeas(data.ideas, data.top) : []
  const weeks = data?.weeks ?? []
  const thisWeek = weeks[weeks.length - 1]
  const maxW = Math.max(1, ...weeks.map(w => Math.max(w.born, w.done)))
  return (
    <Card title="想法庫：最值得先做的前三名" area="bd-idea"
      tag={counts ? <Chip color={COLOR.amber}>{counts.open} 個開放中</Chip> : undefined}
      action={<MoreBtn onClick={() => open('ideas')}>全部想法</MoreBtn>}>
      {error ? <Muted>暫時無法取得想法庫</Muted> : data === null ? <Muted>載入中…</Muted> : !data.available || data.ideas.length === 0 ? (
        <div style={{ fontSize: '0.78rem', color: COLOR.steel, lineHeight: 1.6 }}>
          還沒有想法。HERMES 在日記寫下 <code>### HH:MM 💡 標題</code> 後，下一班 L1（10:30／20:30）就會出現在這裡。
        </div>
      ) : (
        <div className="bd-idea-body">
          <ol className="bd-idea-top">
            {top.length === 0 && <Muted>目前沒有開放中的想法</Muted>}
            {top.map((it, i) => (
              <li key={it.id} className="bd-idea-row" title={it.scoreWhy.join('\n')}>
                <span className="bd-idea-rank" style={{ color: i === 0 ? COLOR.amber : COLOR.steel }}>{i + 1}</span>
                <div style={{ minWidth: 0, display: 'flex', flexDirection: 'column', gap: 3 }}>
                  <div className="bd-idea-title">{it.status === 'doing' && <span aria-label="進行中">🚀 </span>}{it.title}</div>
                  <div className="bd-idea-meta">
                    <CatBadge category={it.category} />
                    <span title="價值">價值 <b>{pips(it.value)}</b></span>
                    <span title="難度">難度 <b>{pips(it.effort)}</b></span>
                    {it.weakBoost && <Chip color={COLOR.ok}>補短板</Chip>}
                  </div>
                  {it.why && <div className="bd-idea-why">{it.why}</div>}
                </div>
                <span className="bd-idea-score">{it.score?.toFixed(1) ?? '—'}</span>
              </li>
            ))}
          </ol>
          <div className="bd-idea-foot">
            <div style={{ display: 'flex', alignItems: 'flex-end', gap: 3, height: 34, flex: '0 0 46%' }} role="img" aria-label="近 8 週新想法與實行數">
              {weeks.map(w => (
                <div key={w.weekStart} title={`${w.weekStart} 起一週：新想法 ${w.born}、實行 ${w.done}`} style={{ flex: 1, height: '100%', display: 'flex', alignItems: 'flex-end', gap: 1 }}>
                  <i style={{ flex: 1, height: `${Math.max(4, (w.born / maxW) * 100)}%`, background: COLOR.amber, opacity: w.born ? 0.9 : 0.25, borderRadius: '2px 2px 0 0' }} />
                  <i style={{ flex: 1, height: `${Math.max(4, (w.done / maxW) * 100)}%`, background: COLOR.ok, opacity: w.done ? 0.9 : 0.25, borderRadius: '2px 2px 0 0' }} />
                </div>
              ))}
            </div>
            <div style={{ fontSize: '0.68rem', color: COLOR.steelDim, lineHeight: 1.5 }}>
              本週 新想法 <b style={{ color: COLOR.amber, fontFamily: FONT.mono }}>{thisWeek?.born ?? 0}</b> · 實行 <b style={{ color: COLOR.ok, fontFamily: FONT.mono }}>{thisWeek?.done ?? 0}</b>
              <br />共 {counts!.total} 個 · 進行中 {counts!.doing} · 已實行 {counts!.done}
              {data.mind && <><br /><span title={`${data.mind.formula}（並行記錄中，尚未計入幸福指數）`}>心智（想法版・並行中）<b style={{ color: COLOR.ink, fontFamily: FONT.mono }}>{data.mind.score.toFixed(1)}</b></span></>}
            </div>
          </div>
        </div>
      )}
    </Card>
  )
}

/** 複製到剪貼簿；舊瀏覽器或非安全來源沒有 navigator.clipboard 時改用隱藏 textarea */
async function copyText(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) { await navigator.clipboard.writeText(text); return true }
  } catch { /* 改用下面的備援 */ }
  try {
    const ta = document.createElement('textarea')
    ta.value = text
    ta.setAttribute('readonly', '')
    ta.style.position = 'fixed'
    ta.style.opacity = '0'
    document.body.appendChild(ta)
    ta.select()
    const ok = document.execCommand('copy')
    document.body.removeChild(ta)
    return ok
  } catch { return false }
}

/** 「複製給 HERMES」：入口網不改狀態，只把要貼到 Telegram 的那句話複製好，HERMES 再寫進日記 */
function CopyToHermes({ idea }: { idea: IdeaItem }) {
  const [note, setNote] = useState('')
  const [copied, setCopied] = useState<{ text: string; ok: boolean } | null>(null)
  const copy = async (s: Parameters<typeof statusMessage>[1]) => {
    const text = statusMessage(idea, s, note)
    setCopied({ text, ok: await copyText(text) })
  }
  return (
    <div className="bd-idea-copy">
      <div style={{ color: COLOR.ink, fontWeight: 500 }}>要更新進度？按一下複製，貼到 Telegram 給 HERMES：</div>
      <input value={note} onChange={e => setNote(e.target.value)} placeholder="（選填）想補充的話，例如：花了三個晚上，效果不錯" style={{ ...inp, maxWidth: 520 }} aria-label="補充說明" />
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
        {nextStatuses(idea.status).map(s => (
          <button key={s} type="button" style={btn} onClick={() => void copy(s)}>{STATUS_MARK[s]} {STATUS_ACTION[s]}</button>
        ))}
      </div>
      {copied && (
        <div role="status" style={{ fontSize: '0.72rem', color: copied.ok ? COLOR.ok : COLOR.warn }}>
          {copied.ok ? '已複製，貼到 Telegram 給 HERMES 即可：' : '瀏覽器不允許自動複製，請手動選取下面這段：'}
          <pre className="bd-idea-copytext">{copied.text}</pre>
        </div>
      )}
    </div>
  )
}

/** 心智分數（想法版）並行期間的說明：算式、兩個分項的原始數字、與現行「日記篇數版」的對照 */
function IdeasMindSection({ mind, shadow, report }: { mind: IdeasMind; shadow: IdeasData['mindShadow']; report: IdeasData['mindReport'] }) {
  const [ref, box] = useBox(240, 70)
  const pts = shadow.filter(d => d.ideas !== null || d.diary !== null)
  const lastCombined = [...shadow].reverse().find(d => d.combined != null)
  const line = (key: 'ideas' | 'diary' | 'combined') => {
    const xs = pts.map((d, i) => [i, d[key] ?? null] as const).filter((p): p is readonly [number, number] => p[1] !== null)
    if (xs.length < 2) return null
    const W = box.w - 8, H = box.h - 8
    return xs.map(([i, v]) => `${4 + (i / Math.max(1, pts.length - 1)) * W},${4 + H - (v / 100) * H}`).join(' ')
  }
  const li = line('ideas'), ld = line('diary'), lc = line('combined')
  return (
    <section style={{ border: `1px solid ${COLOR.line}`, borderRadius: 8, padding: '10px 12px', display: 'grid', gridTemplateColumns: 'minmax(0, 1.2fr) minmax(0, 1fr)', gap: 14 }}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: '0.76rem', color: COLOR.steel, lineHeight: 1.6 }}>
        <div style={{ color: COLOR.ink, fontWeight: 600 }}>心智分數（想法版）<span style={{ fontFamily: FONT.mono, color: COLOR.amber, fontSize: '1.2rem', marginLeft: 8 }}>{mind.score.toFixed(1)}</span>
          <Chip color={COLOR.warn}>並行中・尚未計入幸福指數</Chip></div>
        <div>產生 {mind.birth.score.toFixed(0)} × 40%：近 7 天新想法 <b style={{ color: COLOR.ink }}>{mind.birth.born7}</b> 個 ÷ 過去 8 週每週中位數 <b style={{ color: COLOR.ink }}>{mind.birth.baseline}</b></div>
        <div>實行 {mind.action.score.toFixed(0)} × 60%：近 28 天實行 <b style={{ color: COLOR.ink }}>{mind.action.done28}</b> 個 ÷ 有機會實行的 <b style={{ color: COLOR.ink }}>{mind.action.eligible}</b> 個（{(mind.action.rate * 100).toFixed(1)}%，達 {Math.round(mind.action.target * 100)}% 算滿分）</div>
        {lastCombined && (
          <div data-testid="mind-combined">🧮 合成版 <b style={{ fontFamily: FONT.mono, color: COLOR.ok }}>{lastCombined.combined!.toFixed(1)}</b>
            （{lastCombined.date.slice(5)}：想法 {lastCombined.ideas!.toFixed(1)} × 80%{lastCombined.report != null ? ` ＋ 日報 ${lastCombined.report} × 20%` : '，當天沒有日報分數'}）</div>
        )}
        {report && (
          <div data-testid="mind-report" title={report.parts.map(p => `${p.label} ${p.value}：${p.note}`).join('\n')}>
            📊 日報分數 <b style={{ color: COLOR.ink }}>{report.total}</b>（{report.date.slice(5)}；{report.parts.map(p => `${p.label} ${p.value}`).join('・')}）</div>
        )}
        <div style={{ color: COLOR.steelDim }}>並行兩週，看數字合理再決定是否取代現在的「近 3 天日記篇數」。</div>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        <Label>近 30 天：想法版／合成版 vs 現行日記篇數版（原始分數）</Label>
        <div ref={ref} style={{ flex: 1, minHeight: 70, position: 'relative' }}>
          {li || ld || lc ? (
            <svg width={box.w} height={box.h} style={{ position: 'absolute', inset: 0 }} role="img" aria-label="心智分數各版對照">
              {ld && <polyline points={ld} fill="none" stroke={COLOR.steelDim} strokeWidth={1.5} strokeDasharray="4 3" />}
              {li && <polyline points={li} fill="none" stroke={COLOR.amber} strokeWidth={2} />}
              {lc && <polyline points={lc} fill="none" stroke={COLOR.ok} strokeWidth={1.5} />}
            </svg>
          ) : <Muted>每晚 23:55 記一筆，累積兩天以上會畫出線</Muted>}
        </div>
        <div style={{ fontSize: '0.62rem', color: COLOR.steelDim }}><span style={{ color: COLOR.amber }}>━</span> 想法版　<span style={{ color: COLOR.ok }}>━</span> 合成版　<span>┅</span> 日記篇數版</div>
      </div>
    </section>
  )
}

function IdeasPanel({ pw }: { pw: string }) {
  const { data, error } = useLoad<IdeasData>(pw, apiFetchIdeas)
  const [cat, setCat] = useState<string | null>(null)
  const [st, setSt] = useState<StatusFilter>('open')
  const cats = useMemo(() => categoryCounts(data?.ideas ?? []), [data])
  const list = useMemo(() => sortForList(filterIdeas(data?.ideas ?? [], cat, st)), [data, cat, st])
  const topSet = new Set(data?.top ?? [])
  if (error) return <Muted>暫時無法取得想法庫</Muted>
  if (data === null) return <Muted>載入中…</Muted>
  const pill = (active: boolean, color: string = COLOR.amber): CSSProperties => ({
    ...btn, color: active ? COLOR.panelDeep : color, background: active ? color : 'transparent', borderColor: color,
  })
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      {data.mind && <IdeasMindSection mind={data.mind} shadow={data.mindShadow ?? []} report={data.mindReport ?? null} />}
      <div style={{ fontSize: '0.78rem', color: COLOR.steel, lineHeight: 1.6 }}>
        優先分＝價值 ×（6−難度）× 新鮮度（45 天減半，最低 0.4）× 被想起加成 × 補短板{data.weakest ? `（目前最弱：${data.weakest} ×1.3）` : ''} × 進行中 1.1。
        入口網只顯示；要更新進度，展開任一筆按「✅ 已實行」等按鈕複製一句話，貼到 Telegram 給 HERMES，由 HERMES 寫進日記（下一班 L1 後卡片更新）。
        {data.receivedAt && <> · 最後更新 {minutesAgo(Date.parse(data.receivedAt))}</>}
      </div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
        {([['open', '開放中'], ['done', '已實行'], ['closed', '擱置／放棄'], ['all', '全部']] as Array<[StatusFilter, string]>).map(([k, l]) => (
          <button key={k} type="button" style={pill(st === k)} onClick={() => setSt(k)}>{l}</button>
        ))}
      </div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
        <button type="button" style={pill(cat === null, COLOR.steel)} onClick={() => setCat(null)}>全部類別</button>
        {cats.map(([c, n]) => (
          <button key={c} type="button" style={pill(cat === c, categoryColor(c === '未分類' ? null : c))} onClick={() => setCat(cat === c ? null : c)}>{c} {n}</button>
        ))}
      </div>
      {list.length === 0 ? <Muted>沒有符合的想法</Muted> : (
        <div className="bd-idea-list">
          {list.map((it: IdeaItem) => (
            <details key={it.id} className="bd-idea-item">
              <summary>
                <span className="bd-idea-id">{it.id}</span>
                <span style={{ minWidth: 0, display: 'flex', flexDirection: 'column', gap: 3 }}>
                  <span style={{ color: COLOR.ink, fontWeight: 600 }}>{topSet.has(it.id) && <span style={{ color: COLOR.amber }}>★ </span>}{it.title}</span>
                  <span className="bd-idea-meta">
                    <CatBadge category={it.category} />
                    <span>{STATUS_ICON[it.status]} {STATUS_LABEL[it.status]}</span>
                    <span>價值 <b>{pips(it.value)}</b></span>
                    <span>難度 <b>{pips(it.effort)}</b></span>
                    {it.mentions > 1 && <span>想起 {it.mentions} 次</span>}
                    {it.source && <span>來源 {it.source}</span>}
                    {it.backfill && <Chip>舊日記回補</Chip>}
                  </span>
                </span>
                <span className="bd-idea-score">{it.score !== null ? it.score.toFixed(1) : '—'}</span>
              </summary>
              <div className="bd-idea-detail">
                {it.why && <p><b>為什麼想做：</b>{it.why}</p>}
                {it.scoreWhy.length > 0 && <p><b>優先分：</b>{it.scoreWhy.join(' × ')}</p>}
                <p><b>出現在日記：</b>{it.days.join('、') || '—'}</p>
                <p><b>狀態歷程：</b>{it.history.map(h => `${h.at.slice(0, 16).replace('T', ' ')} ${STATUS_LABEL[h.status as keyof typeof STATUS_LABEL] ?? h.status}`).join(' → ')}</p>
                <CopyToHermes idea={it} />
              </div>
            </details>
          ))}
        </div>
      )}
    </div>
  )
}

const btn: CSSProperties = { fontFamily: FONT.mono, fontSize: '0.68rem', padding: '5px 10px', borderRadius: 5, cursor: 'pointer', background: 'transparent', color: COLOR.amber, border: `1px solid ${COLOR.amberDim}` }
const fld: CSSProperties = { display: 'flex', flexDirection: 'column', gap: 2, fontSize: '0.62rem', color: COLOR.steelDim, fontFamily: FONT.mono }
const inp: CSSProperties = { width: '100%', background: COLOR.panelDeep, border: `1px solid ${COLOR.line}`, borderRadius: 4, color: COLOR.ink, padding: '4px 6px', fontFamily: FONT.mono, fontSize: '0.72rem' }

// ── 幸福指數：這個分數怎麼來（首頁主體）──────────────
function Ring({ value, color }: { value: number; color: string }) {
  const shown = useCountUp(value)
  const R = 50
  const C = 2 * Math.PI * R
  const frac = Math.min(100, Math.max(0, shown)) / 100
  const ticks = Array.from({ length: 40 }, (_, i) => i)
  return (
    <svg className="bd-ring" viewBox="0 0 140 140" role="img" aria-label={`幸福指數 ${value}`}>
      <defs>
        <linearGradient id="bdRingGrad" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity={0.55} />
          <stop offset="100%" stopColor={color} />
        </linearGradient>
        <filter id="bdRingGlow" x="-30%" y="-30%" width="160%" height="160%"><feGaussianBlur stdDeviation="3.2" /></filter>
      </defs>
      {ticks.map(i => {
        const a = (i / 40) * 2 * Math.PI - Math.PI / 2
        const on = i / 40 <= frac
        return <line key={i} x1={70 + 62 * Math.cos(a)} y1={70 + 62 * Math.sin(a)} x2={70 + 66 * Math.cos(a)} y2={70 + 66 * Math.sin(a)} stroke={on ? color : COLOR.line} strokeWidth={1.4} opacity={on ? 0.9 : 0.6} />
      })}
      <circle cx={70} cy={70} r={R} fill="none" stroke={COLOR.panelRaised} strokeWidth={11} />
      <circle cx={70} cy={70} r={R} fill="none" stroke={color} strokeWidth={11} strokeLinecap="round" strokeDasharray={`${C * frac} ${C}`} transform="rotate(-90 70 70)" filter="url(#bdRingGlow)" opacity={0.55} />
      <circle cx={70} cy={70} r={R} fill="none" stroke="url(#bdRingGrad)" strokeWidth={11} strokeLinecap="round" strokeDasharray={`${C * frac} ${C}`} transform="rotate(-90 70 70)" />
      <text x={70} y={78} textAnchor="middle" fontFamily={FONT.mono} fontWeight={600} fontSize={36} fill={COLOR.ink}>{shown}</text>
      <text x={70} y={97} textAnchor="middle" fontFamily={FONT.mono} fontSize={9} fill={COLOR.steelDim} letterSpacing={2}>/ 100</text>
    </svg>
  )
}

function Spark({ points, color }: { points: HhiHistoryPoint[]; color: string }) {
  const [ref, box] = useBox(60, 16)
  if (points.length < 2) return <div ref={ref} className="bd-spark"><Muted>近 30 天趨勢：資料累積中</Muted></div>
  const vals = points.map(p => p.displayedScore)
  const lo = Math.min(...vals) - 2
  const hi = Math.max(...vals) + 2
  const w = box.w
  const h = Math.min(box.h, 70)
  const xy = points.map((p, i) => [(i / (points.length - 1)) * (w - 6) + 3, 4 + (h - 8) * (1 - (p.displayedScore - lo) / (hi - lo || 1))] as const)
  const d = xy.map(([x, y], i) => `${i ? 'L' : 'M'}${x.toFixed(1)},${y.toFixed(1)}`).join(' ')
  const last = xy[xy.length - 1]!
  const first = points[0]!.displayedScore
  const lastV = points[points.length - 1]!.displayedScore
  const diff = lastV - first
  return (
    <div className="bd-spark">
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 6, fontFamily: FONT.mono, fontSize: '0.6rem', color: COLOR.steelDim }}>
        <span>近 {points.length} 天</span>
        <span style={{ color: diff > 0 ? COLOR.ok : diff < 0 ? COLOR.warn : COLOR.steelDim }}>{diff > 0 ? '▲' : diff < 0 ? '▼' : '—'} {Math.abs(diff)}</span>
      </div>
      <div ref={ref} style={{ flex: 1, minHeight: 16, position: 'relative', overflow: 'hidden' }}>
        <svg width={w} height={h} style={{ position: 'absolute', inset: 0 }} role="img" aria-label="幸福指數近 30 天趨勢">
          <path d={`${d} L${last[0].toFixed(1)},${h} L3,${h} Z`} fill={color} opacity={0.12} />
          <path d={d} fill="none" stroke={color} strokeWidth={1.6} />
          <circle cx={last[0]} cy={last[1]} r={2.6} fill={color} />
        </svg>
      </div>
    </div>
  )
}

function HhiCard({ pw, data, toneOf }: { pw: string; data: Record<string, unknown> | undefined; toneOf: (s: number) => { color: string; label: string } }) {
  const open = useContext(DrawerCtx)
  const b = useMemo(() => buildHhiBreakdown(data), [data])
  const hist = useLoad<HhiHistoryPoint[]>(pw, apiFetchHhiHistory)
  const more = <MoreBtn onClick={() => open('hhi')}>雷達・30 天洞察・六維度</MoreBtn>
  if (!b) {
    return <Card title="翰翰仔幸福指數：這個分數怎麼來" area="bd-hhi" action={more}><Muted>資料準備中…</Muted></Card>
  }
  const tone = toneOf(b.displayed)
  const drag = biggestDrag(b.rows)
  const barColor = (v: number) => toneOf(v).color
  return (
    <Card
      title="翰翰仔幸福指數：這個分數怎麼來" area="bd-hhi" action={more}
      tag={!b.isFinal ? <Chip color={COLOR.warn}>今日暫定</Chip> : b.stale ? <Chip color={COLOR.warn}>部分為最近可用值</Chip> : undefined}
      style={{ background: `radial-gradient(ellipse 55% 75% at 14% 45%, ${tone.color}1f, transparent 70%), ${COLOR.panel}` }}
    >
      <div className="bd-hhi-body">
        <div className="bd-hhi-left">
          <Ring value={b.displayed} color={tone.color} />
          <div style={{ fontSize: '0.92rem', fontWeight: 700, color: tone.color, letterSpacing: '0.04em' }}>{tone.label}</div>
          <div className="bd-chain">
            <span title="六個維度 今日值×權重 的加總">加權平均 <b>{b.base !== null ? b.base.toFixed(1) : '—'}</b></span>
            <i>→</i>
            <span title={`最弱項${b.weakestLabel ? `（${b.weakestLabel}）` : ''} ${b.weakestScore ?? '—'} 分拉低後`}>短板修正 <b>{b.afterPenalty ?? '—'}</b></span>
            <i>→</i>
            <span title="與前幾天平滑後的顯示值">顯示 <b style={{ color: tone.color }}>{b.displayed}</b></span>
          </div>
          <Spark points={hist.data ?? []} color={tone.color} />
        </div>

        <div className="bd-hhi-rows" role="table" aria-label="六維度：今日值 × 權重 ＝ 貢獻分">
          <div className="bd-hrow bd-hhead" role="row">
            <span role="columnheader">維度</span><span role="columnheader">今日值</span><span role="columnheader" /><span role="columnheader">權重</span><span role="columnheader">貢獻分</span>
          </div>
          {b.rows.map(r => {
            const isDrag = drag?.key === r.key
            return (
              <button key={r.key} type="button" className={`bd-hrow${isDrag ? ' is-drag' : ''}`} role="row" onClick={() => open('hhi')} title={`${r.label}：${r.value ?? '—'} × ${r.weightPct}% ＝ ${r.points !== null ? r.points.toFixed(1) : '—'} 分（點開看六維度詳情）`}>
                <span className="bd-hlabel" style={{ color: isDrag ? COLOR.warn : COLOR.ink }}>{r.label}</span>
                <span className="bd-hval" style={{ color: r.value !== null ? barColor(r.value) : COLOR.steelDim }}>{r.value !== null ? r.value : '—'}</span>
                <span className="bd-htrack"><i style={{ width: `${r.value !== null ? Math.max(2, r.value) : 0}%`, background: r.value !== null ? barColor(r.value) : COLOR.line }} /></span>
                <span className="bd-hw">×{r.weightPct}%</span>
                <span className="bd-hpts">{r.points !== null ? r.points.toFixed(1) : '—'}</span>
              </button>
            )
          })}
          <div className="bd-hrow bd-htotal" role="row">
            <span>加總</span><span /><span /><span className="bd-hw">100%</span><span className="bd-hpts">{b.pointsSum.toFixed(1)}</span>
          </div>
          {drag && (
            <div className="bd-hdrag">
              拉低總分最多：<b style={{ color: COLOR.warn }}>{drag.label}</b>　離滿分差 {100 - (drag.value ?? 0)} × 權重 {drag.weightPct}% ＝ 少 <b style={{ color: COLOR.warn }}>{(((100 - (drag.value ?? 0)) * drag.weightPct) / 100).toFixed(1)}</b> 分
            </div>
          )}
        </div>
      </div>
    </Card>
  )
}

// ── 事人物關係網路 ────────────────────────────────
function NetworkCard({ pw }: { pw: string }) {
  const open = useContext(DrawerCtx)
  const { data, error } = useLoad<HermesGraphData>(pw, apiFetchHermesGraph)
  const m = data?.metrics
  const tiles: Array<[string, string, string?]> = m ? [
    ['人物', String(m.peopleCount)], ['事件', String(m.eventsCount)], ['案件', String(m.casesCount), `${m.activeCasesCount} 進行中`],
    ['物件', String(m.objectsCount)], ['平均關聯人數', m.avgParticipantsPerEvent.toFixed(1), '每事件'], ['真孤兒事件率', `${m.trueOrphanEventRatioPct}%`, '無人物且無案件'],
  ] : []
  return (
    <Card title="事人物關係網路" area="bd-net" action={<MoreBtn onClick={() => open('ops')}>戰情室</MoreBtn>}>
      {error ? <Muted>暫時無法取得資料</Muted> : data === null ? <Muted>載入中…</Muted> : !m ? <Muted>資料準備中</Muted> : (
        <>
          <div className="bd-tiles">
            {tiles.map(([k, v, s]) => (
              <div key={k} className="bd-tile" style={{ background: COLOR.panelRaised, borderRadius: 6 }}>
                <Label>{k}</Label>
                <div className="bd-big" style={{ color: k === '真孤兒事件率' && m.trueOrphanEventRatioPct >= 50 ? COLOR.warn : COLOR.ink }}>{v}</div>
                {s && <div style={{ fontSize: '0.62rem', color: COLOR.steelDim }}>{s}</div>}
              </div>
            ))}
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, fontSize: '0.7rem', color: COLOR.steel }}>
            <span>{m.mostActivePerson ? <>這陣子最活躍：<b style={{ color: COLOR.amber }}>{m.mostActivePerson.name}</b><span style={{ color: COLOR.steelDim }}>（{m.mostActivePerson.eventCount} 個事件）</span></> : ''}</span>
            <button type="button" onClick={() => { window.location.hash = 'graph' }} style={btn}>完整關係宇宙 →</button>
          </div>
        </>
      )}
    </Card>
  )
}

// ── 知識萃取管線 ──────────────────────────────────
const PIPE_STATIC: Record<'L1' | 'L2' | 'L3' | 'L4' | 'L5', [string, string]> = {
  L1: ['日記快掃', '10:30 · 20:30'], L2: ['人名消歧／事件合併', '21:15'], L3: ['落地事件檔', '00:10（01:10 補跑）'],
  L4: ['RAW 文件消化', '11:35 · 17:35'], L5: ['圖譜編織', '02:00（隔日一班）'],
}
function PipelineCard({ pw }: { pw: string }) {
  const open = useContext(DrawerCtx)
  const { data, error } = useLoad<BoardPipeline>(pw, apiFetchBoardPipeline)
  const layers = (['L1', 'L2', 'L3', 'L4', 'L5'] as const)
  return (
    <Card title="知識萃取管線 L1–L5" area="bd-pipe" action={<MoreBtn onClick={() => open('ops')}>排程・歷史</MoreBtn>}>
      {error ? <Muted>暫時無法取得資料</Muted> : data === null ? <Muted>載入中…</Muted> : !data.available ? <Muted>尚無管線資料</Muted> : (
        <div className="bd-pipe-list">
          {layers.map(k => {
            const l = data.layers[k]
            const sched = l.schedule && l.schedule.length ? l.schedule.join(' · ') : PIPE_STATIC[k][1]
            const color = l.health === 'ok' ? COLOR.ok : l.health === 'crit' ? COLOR.crit : COLOR.steelDim
            return (
              <div key={k} className="bd-pipe-row" style={{ background: COLOR.panelRaised }}>
                <b className="bd-pipe-k" style={{ color: COLOR.amber }}>{k}</b>
                <div style={{ minWidth: 0 }}>
                  <div className="bd-pipe-main" style={{ color: COLOR.steel }}>{PIPE_STATIC[k][0]} · {sched}</div>
                  <div className="bd-pipe-sub" style={{ color: l.errorSummary ? COLOR.crit : COLOR.steelDim }}>{l.errorSummary ?? `上次 ${minutesAgo(l.lastRunTs !== null ? l.lastRunTs : null)}`}</div>
                </div>
                <span title={l.health} style={{ width: 9, height: 9, borderRadius: '50%', background: color, boxShadow: `0 0 6px ${color}` }} />
              </div>
            )
          })}
        </div>
      )}
    </Card>
  )
}

// ── 主機健康（含硬碟容量）─────────────────────────
function DiskBlock({ pw, status }: { pw: string; status: BoardStatus }) {
  const hist = useLoad<BoardDiskPoint[]>(pw, p => apiFetchBoardDiskHistory(p, 30))
  const worst = status.disks.reduce<BoardStatus['disks'][number] | null>((w, d) => (!w || d.percentUsed > w.percentUsed ? d : w), null)
  if (!worst) return null
  const usedGb = worst.totalGb - worst.freeGb
  const f = describeForecast(status.diskForecast ?? null)
  const tone = { ok: COLOR.ok, warn: COLOR.warn, crit: COLOR.crit, dim: COLOR.steelDim }[f.tone]
  const points = (hist.data ?? []).filter((h): h is BoardDiskPoint & { diskUsedGb: number } => h.diskUsedGb !== null).map(h => ({ date: h.date, value: h.diskUsedGb }))
  const shares = storageShares(status.storage ?? [], usedGb * 1e9, null).slice(0, 3)
  return (
    <div className="bd-disk" style={{ background: COLOR.panelRaised, borderRadius: 6, padding: '0.5rem 0.7rem', display: 'flex', flexDirection: 'column', gap: 6, minHeight: 0, overflow: 'hidden' }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: '0.3rem 0.8rem', flexWrap: 'wrap' }}>
        <Label>硬碟容量 {worst.drive}</Label>
        <span style={{ fontFamily: FONT.mono, fontSize: '1.15rem', fontWeight: 600, color: pctColor(worst.percentUsed) }}>{Math.round(worst.percentUsed)}%</span>
        <span style={{ fontFamily: FONT.mono, fontSize: '0.7rem', color: COLOR.steel }}>已用 {usedGb.toFixed(1)} / {worst.totalGb.toFixed(1)} GB · 剩 {worst.freeGb.toFixed(1)} GB</span>
      </div>
      <div style={{ fontSize: '0.7rem', color: tone, lineHeight: 1.45 }}>{f.text}</div>
      <div className="bd-disk-detail">
        <div style={{ minWidth: 0 }}><UsedChart points={points} /></div>
        <div style={{ minWidth: 0, display: 'grid', gap: 5, alignContent: 'start' }}>
          {shares.length === 0 ? <Muted>尚無分項資料</Muted> : shares.map(sh => (
            <div key={sh.label}>
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 6, fontFamily: FONT.mono, fontSize: '0.64rem' }}>
                <span style={{ color: COLOR.ink, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{sh.label}</span>
                <span style={{ color: COLOR.steel, flexShrink: 0 }}>{formatBytes(sh.bytes)}</span>
              </div>
              <div style={{ height: 4, background: COLOR.line, borderRadius: 2, marginTop: 2 }}>
                <div style={{ width: `${Math.min(100, Math.max(1, sh.share * 100))}%`, height: '100%', background: sh.label.startsWith('其他') ? COLOR.steelDim : COLOR.amber, borderRadius: 2 }} />
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

// 入口網推送健康：每種資料最後一次推送成功的時間、間隔與錯誤（kb-pipeline 的 kbcore/portal_push）
const FEED_LABEL: Record<string, string> = {
  'hermes-graph': '關係圖', 'hermes-doc': '事件內文', 'hermes-status': '主機狀態', 'hermes-activity': '近期活動',
  'hermes-pipeline': '管線狀態', 'social-index': '社交指標', 'mind-engagement': '心智（日記篇數）',
  'hermes-timeline': '時間軸', 'hermes-usage': 'Ollama 用量', 'hermes-ideas': '想法庫', 'life-score': '知識庫健康',
}
const fmtEvery = (m: number | null) => (m === null ? '有變動才送' : m < 60 ? `每 ${m} 分` : m < 1440 ? `約每 ${Math.round(m / 60)} 小時` : '每天')
const fmtAge = (m: number | null) => (m === null ? '—' : m < 60 ? `${Math.round(m)} 分鐘前` : m < 2880 ? `${Math.round(m / 60)} 小時前` : `${Math.round(m / 1440)} 天前`)

export function pusherSummary(rows: PusherHealth[] | null | undefined): { bad: number; total: number; level: 'ok' | 'warn' | 'crit' } | null {
  if (!rows || rows.length === 0) return null
  const bad = rows.filter(r => r.level !== 'ok').length
  return { bad, total: rows.length, level: rows.some(r => r.level === 'crit') ? 'crit' : bad ? 'warn' : 'ok' }
}

function PusherHealthPanel({ pw }: { pw: string }) {
  const { data } = useLoad<BoardStatus>(pw, apiFetchBoardStatus)
  const rows = data?.pushers
  if (!rows || rows.length === 0) return null
  const sum = pusherSummary(rows)!
  return (
    <section style={{ marginBottom: '1.4rem' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
        <h3 style={{ margin: 0, fontFamily: FONT.display, fontSize: '0.95rem', color: COLOR.ink }}>入口網推送健康</h3>
        <Chip color={levelColor(sum.level)}>{sum.bad ? `${sum.bad} 項需要注意` : `${sum.total} 項都正常`}</Chip>
        <span style={{ fontSize: '0.7rem', color: COLOR.steelDim }}>VPS 推給入口網的每種資料，最後一次成功的時間（主機狀態每 10 分鐘帶上來）</span>
      </div>
      <div className="bd-push-table" role="table" aria-label="入口網推送健康">
        {rows.map(r => (
          <div key={r.feed} role="row" className="bd-push-row">
            <span role="cell" className="bd-push-name"><i className="bd-push-dot" style={{ background: levelColor(r.level) }} />{FEED_LABEL[r.feed] ?? r.feed}</span>
            <span role="cell" className="bd-push-dim">{fmtEvery(r.expectedEveryMin)}</span>
            <span role="cell" className="bd-push-age" style={r.level === 'ok' ? (r.lastOk ? undefined : { color: COLOR.steel, fontWeight: 400 }) : { color: levelColor(r.level) }}>{r.lastOk ? fmtAge(r.ageMin) : '還沒推過'}</span>
            <span role="cell" className="bd-push-dim">成功 <b>{r.okCount}</b>・失敗 <b style={r.failCount ? { color: COLOR.crit } : undefined}>{r.failCount}</b></span>
            <span role="cell" className="bd-push-err" title={r.lastError ?? ''}>{r.lastError ?? ''}</span>
          </div>
        ))}
      </div>
    </section>
  )
}

function SystemCard({ pw }: { pw: string }) {
  const open = useContext(DrawerCtx)
  const { data, error } = useLoad<BoardStatus>(pw, apiFetchBoardStatus)
  const ok = data && data.available ? data : null
  const cOk = ok ? ok.containers.filter(c => !/exit|dead|unhealthy/i.test(`${c.status} ${c.health ?? ''}`)).length : 0
  const cells: Array<[string, string, string]> = ok ? [
    ['CPU', ok.cpuPercent !== null ? `${Math.round(ok.cpuPercent)}%` : '—', pctColor(ok.cpuPercent)],
    ['記憶體', ok.memPercent !== null ? `${Math.round(ok.memPercent)}%` : '—', pctColor(ok.memPercent)],
    ['容器健康', ok.containers.length ? `${cOk} / ${ok.containers.length}` : '—', ok.containers.length === 0 ? COLOR.steelDim : cOk < ok.containers.length ? COLOR.warn : COLOR.ok],
  ] : []
  return (
    <Card title="主機健康與硬碟容量" area="bd-sys"
      tag={ok?.stale ? <Chip color={COLOR.warn}>資料已過期</Chip> : (() => {
        const ps = pusherSummary(ok?.pushers)
        return ps && ps.level !== 'ok' ? <Chip color={levelColor(ps.level)}>推送 {ps.bad} 項落後</Chip> : undefined
      })()}
      action={<MoreBtn onClick={() => open('ops')}>容器・趨勢</MoreBtn>}>
      {error ? <Muted>暫時無法取得資料</Muted> : data === null ? <Muted>載入中…</Muted> : !ok ? <Muted>尚無主機資料</Muted> : (
        <div className="bd-sys-wrap" style={{ opacity: ok.stale ? 0.55 : 1 }}>
          <div className="bd-sys-grid">
            {cells.map(([k, v, c]) => (
              <div key={k} className="bd-tile" style={{ background: COLOR.panelRaised, borderRadius: 6 }}>
                <Label>{k}</Label>
                <div className="bd-big" style={{ color: c }}>{v}</div>
              </div>
            ))}
          </div>
          <DiskBlock pw={pw} status={ok} />
        </div>
      )}
    </Card>
  )
}

export function DesktopBoard({ unlocked, unlockedPassword, hhiData, toneOf, onRequestUnlock, hhiDetail, opsDetail }: {
  unlocked: boolean
  unlockedPassword: string | null
  hhiData: Record<string, unknown> | undefined
  toneOf: (s: number) => { color: string; label: string }
  onRequestUnlock: () => void
  /** 抽屜「幸福指數詳情」：雷達、30 天洞察、歷史趨勢、六維度子系統（App.tsx 組好傳進來） */
  hhiDetail: ReactNode
  /** 抽屜「HERMES 戰情室」：關係網路圖、管線歷史、硬碟分項、排程、近期活動、容器、趨勢 */
  opsDetail: ReactNode
}) {
  const [drawer, setDrawer] = useState<DrawerKey | null>(null)
  const [ollKey, setOllKey] = useState(0)
  // 抽屜裡可能更新過餘額，關掉時讓首頁 Ollama 小卡重抓（只是一個 GET）
  const close = useCallback(() => { setDrawer(null); setOllKey(k => k + 1) }, [])
  if (!unlocked || !unlockedPassword) {
    return (
      <div className="ip-board" style={{ display: 'grid', placeItems: 'center' }}>
        <button type="button" onClick={onRequestUnlock} style={{ ...btn, fontSize: '0.8rem', padding: '10px 18px' }}>🔒 解鎖後顯示儀表板（幸福指數、想法庫、管線、主機、用量）</button>
      </div>
    )
  }
  return (
    <DrawerCtx.Provider value={setDrawer}>
      <div className="ip-board">
        <HhiCard pw={unlockedPassword} data={hhiData} toneOf={toneOf} />
        <IdeasCard pw={unlockedPassword} />
        <OllamaMiniCard pw={unlockedPassword} refreshKey={ollKey} />
        <NetworkCard pw={unlockedPassword} />
        <PipelineCard pw={unlockedPassword} />
        <SystemCard pw={unlockedPassword} />
      </div>
      {drawer === 'hhi' && <Drawer title="幸福指數詳情：雷達・30 天洞察・趨勢・六維度子系統" onClose={close}>{hhiDetail}</Drawer>}
      {drawer === 'ideas' && <Drawer title="想法庫：全部想法・類別・狀態・優先分怎麼算" onClose={close}><IdeasPanel pw={unlockedPassword} /></Drawer>}
      {drawer === 'oll' && <Drawer title="Ollama 雲端用量：餘額走勢・每日請求・更新餘額" onClose={close}><OllamaPanel pw={unlockedPassword} /></Drawer>}
      {drawer === 'ops' && <Drawer title="HERMES 戰情室：推送健康・關係網路・管線・硬碟・排程・活動・容器・趨勢" onClose={close}><PusherHealthPanel pw={unlockedPassword} />{opsDetail}</Drawer>}
    </DrawerCtx.Provider>
  )
}
