import { useCallback, useEffect, useMemo, useState, type CSSProperties, type ReactNode } from 'react'
import { COLOR, FONT } from './theme'
import { apiFetchHermesGraph, type HermesGraphData } from './hermesGraphApi'
import {
  apiFetchBoardPipeline, apiFetchBoardStatus, apiFetchUsage, apiPostBalance,
  type BoardPipeline, type BoardStatus, type UsageData,
} from './boardApi'
import { balanceChartGeometry, biggestDrag, buildHhiBreakdown, dailyBars, formatCalls, formatEmptyDay, formatUsd } from './boardView'

// 桌面首頁（≥1100px）的「一個畫面放得下」儀表板。資料都沿用既有端點；完整細節（關係網路圖、硬碟、排程、容器…）
// 仍在這塊下面照舊，這裡只放「進來第一眼要看」的：Ollama 用量與預估、幸福指數怎麼來、關係網路、管線、主機。

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

function Card({ title, tag, area, children }: { title: string; tag?: ReactNode; area: string; children: ReactNode }) {
  return (
    <section className={`bd-card ${area}`} style={{ background: COLOR.panel, border: `1px solid ${COLOR.line}`, borderRadius: 8 }}>
      <h2 style={{ margin: 0, display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 8, fontFamily: FONT.display, fontWeight: 700, fontSize: '0.8rem', color: COLOR.ink }}>
        <span>{title}</span>
        {tag}
      </h2>
      {children}
    </section>
  )
}

const Label = ({ children }: { children: ReactNode }) => (
  <span style={{ fontFamily: FONT.mono, fontSize: '0.58rem', letterSpacing: '0.14em', textTransform: 'uppercase', color: COLOR.steelDim }}>{children}</span>
)

const Chip = ({ children, color = COLOR.steelDim }: { children: ReactNode; color?: string }) => (
  <span style={{ fontFamily: FONT.mono, fontSize: '0.56rem', letterSpacing: '0.06em', color, border: `1px solid ${color}`, borderRadius: 4, padding: '2px 5px', whiteSpace: 'nowrap' }}>{children}</span>
)

const Muted = ({ children }: { children: ReactNode }) => <div style={{ fontSize: '0.72rem', color: COLOR.steelDim }}>{children}</div>

/** 量元素實際像素大小，圖表用它算座標（不用 preserveAspectRatio="none" 拉伸，字才不會變形）。 */
function useBox(): [(el: HTMLDivElement | null) => void, { w: number; h: number }] {
  const [el, setEl] = useState<HTMLDivElement | null>(null)
  const [size, setSize] = useState({ w: 600, h: 150 })
  useEffect(() => {
    if (!el) return
    const ro = new ResizeObserver(entries => {
      const r = entries[0]?.contentRect
      if (r) setSize({ w: Math.max(240, Math.round(r.width)), h: Math.max(90, Math.round(r.height)) })
    })
    ro.observe(el)
    return () => ro.disconnect()
  }, [el])
  return [setEl, size]
}

function useLoad<T>(pw: string | null, fetcher: (pw: string) => Promise<T>): { data: T | null; error: boolean; reload: () => void } {
  const [data, setData] = useState<T | null>(null)
  const [error, setError] = useState(false)
  const [tick, setTick] = useState(0)
  useEffect(() => {
    if (!pw) return
    let cancelled = false
    fetcher(pw).then(d => { if (!cancelled) { setData(d); setError(false) } }).catch(() => { if (!cancelled) setError(true) })
    return () => { cancelled = true }
  }, [pw, tick, fetcher])
  const reload = useCallback(() => setTick(t => t + 1), [])
  return { data, error, reload }
}

// ── Ollama 用量與預估 ───────────────────────────────
function OllamaCard({ pw }: { pw: string }) {
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
    <Card title="Ollama 雲端用量與預估" tag={sourceTag} area="bd-oll">
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

const btn: CSSProperties = { fontFamily: FONT.mono, fontSize: '0.68rem', padding: '5px 10px', borderRadius: 5, cursor: 'pointer', background: 'transparent', color: COLOR.amber, border: `1px solid ${COLOR.amberDim}` }
const fld: CSSProperties = { display: 'flex', flexDirection: 'column', gap: 2, fontSize: '0.62rem', color: COLOR.steelDim, fontFamily: FONT.mono }
const inp: CSSProperties = { width: '100%', background: COLOR.panelDeep, border: `1px solid ${COLOR.line}`, borderRadius: 4, color: COLOR.ink, padding: '4px 6px', fontFamily: FONT.mono, fontSize: '0.72rem' }

// ── 幸福指數：這個分數怎麼來 ───────────────────────
function HhiCard({ data, toneOf }: { data: Record<string, unknown> | undefined; toneOf: (s: number) => { color: string; label: string } }) {
  const b = useMemo(() => buildHhiBreakdown(data), [data])
  const C = 2 * Math.PI * 48
  if (!b) {
    return <Card title="翰翰仔幸福指數：這個分數怎麼來" area="bd-hhi"><Muted>資料準備中…</Muted></Card>
  }
  const tone = toneOf(b.displayed)
  const drag = biggestDrag(b.rows)
  return (
    <Card title="翰翰仔幸福指數：這個分數怎麼來" area="bd-hhi" tag={!b.isFinal ? <Chip color={COLOR.warn}>今日暫定</Chip> : b.stale ? <Chip color={COLOR.warn}>部分為最近可用值</Chip> : undefined}>
      <div className="bd-hhi-body">
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2 }}>
          <svg viewBox="0 0 120 120" width={132} height={132} role="img" aria-label={`幸福指數 ${b.displayed}`}>
            <circle cx={60} cy={60} r={48} fill="none" stroke={COLOR.panelRaised} strokeWidth={10} />
            <circle cx={60} cy={60} r={48} fill="none" stroke={tone.color} strokeWidth={10} strokeLinecap="round" strokeDasharray={`${(C * Math.min(100, Math.max(0, b.displayed))) / 100} ${C}`} transform="rotate(-90 60 60)" />
            <text x={60} y={60} textAnchor="middle" fontFamily={FONT.mono} fontWeight={600} fontSize={28} fill={COLOR.ink}>{b.displayed}</text>
            <text x={60} y={78} textAnchor="middle" fontFamily={FONT.mono} fontSize={9} fill={COLOR.steelDim} letterSpacing={1.5}>/ 100</text>
          </svg>
          <div style={{ fontSize: '0.78rem', fontWeight: 600, color: tone.color }}>{tone.label}</div>
        </div>
        <div style={{ minWidth: 0 }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.78rem' }}>
            <thead>
              <tr style={{ fontFamily: FONT.mono, fontSize: '0.54rem', letterSpacing: '0.1em', color: COLOR.steelDim, textAlign: 'right' }}>
                <th style={{ textAlign: 'left', fontWeight: 500, paddingBottom: 3 }}>維度</th><th style={{ fontWeight: 500 }}>今日值</th><th style={{ fontWeight: 500 }}>權重</th><th style={{ fontWeight: 500 }}>貢獻分</th>
              </tr>
            </thead>
            <tbody>
              {b.rows.map(r => (
                <tr key={r.key} style={{ borderTop: `1px solid ${COLOR.line}`, fontFamily: FONT.mono, textAlign: 'right' }}>
                  <td style={{ textAlign: 'left', fontFamily: FONT.body, padding: '4px 0', color: drag?.key === r.key ? COLOR.warn : COLOR.steel }}>{r.label}</td>
                  <td>{r.value !== null ? r.value : '—'}</td>
                  <td style={{ color: COLOR.steelDim }}>{r.weightPct}%</td>
                  <td style={{ color: COLOR.ink }}>{r.points !== null ? r.points.toFixed(1) : '—'}</td>
                </tr>
              ))}
              <tr style={{ borderTop: `1px solid ${COLOR.lineBright}`, fontFamily: FONT.mono, textAlign: 'right', color: COLOR.ink }}>
                <td style={{ textAlign: 'left', fontFamily: FONT.body }}>加總</td><td /><td style={{ color: COLOR.steelDim }}>100%</td><td>{b.pointsSum.toFixed(1)}</td>
              </tr>
            </tbody>
          </table>
          <div style={{ marginTop: 8, display: 'grid', gap: 3, fontSize: '0.72rem', color: COLOR.steelDim }}>
            <div style={{ display: 'flex', justifyContent: 'space-between' }}><span>基礎分（加權平均）</span><b style={{ fontFamily: FONT.mono, color: COLOR.steel, fontWeight: 500 }}>{b.base !== null ? b.base.toFixed(2) : '—'}</b></div>
            <div style={{ display: 'flex', justifyContent: 'space-between' }}><span>最弱項{b.weakestLabel ? `（${b.weakestLabel}）` : ''}</span><b style={{ fontFamily: FONT.mono, color: COLOR.steel, fontWeight: 500 }}>{b.weakestScore !== null ? b.weakestScore.toFixed(2) : '—'}</b></div>
            <div style={{ display: 'flex', justifyContent: 'space-between' }}><span>短板修正後 → 平滑後（顯示值）</span><b style={{ fontFamily: FONT.mono, color: COLOR.steel, fontWeight: 500 }}>{b.afterPenalty !== null ? b.afterPenalty : '—'} → {b.displayed}</b></div>
          </div>
          {drag && <div style={{ marginTop: 8, fontSize: '0.72rem', color: COLOR.steel }}>拉低總分最多：<b style={{ color: COLOR.warn }}>{drag.label}</b>（離滿分差 {100 - (drag.value ?? 0)} × 權重 {drag.weightPct}% ＝ 少 {(((100 - (drag.value ?? 0)) * drag.weightPct) / 100).toFixed(1)} 分）</div>}
        </div>
      </div>
    </Card>
  )
}

// ── 事人物關係網路 ────────────────────────────────
function NetworkCard({ pw }: { pw: string }) {
  const { data, error } = useLoad<HermesGraphData>(pw, apiFetchHermesGraph)
  const m = data?.metrics
  const tiles: Array<[string, string, string?]> = m ? [
    ['人物', String(m.peopleCount)], ['事件', String(m.eventsCount)], ['案件', String(m.casesCount), `${m.activeCasesCount} 進行中`],
    ['物件', String(m.objectsCount)], ['平均關聯人數', m.avgParticipantsPerEvent.toFixed(1), '每事件'], ['真孤兒事件率', `${m.trueOrphanEventRatioPct}%`, '無人物且無案件'],
  ] : []
  return (
    <Card title="事人物關係網路" area="bd-net">
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
  L1: ['日記快掃', '10:30 · 16:30 · 20:30'], L2: ['人名消歧／事件合併', '12:00 · 21:15'], L3: ['落地事件檔', '00:10（01:10 補跑）'],
  L4: ['RAW 文件消化', '11:35 · 17:35'], L5: ['圖譜編織', '02:00（隔日一班）'],
}
function PipelineCard({ pw }: { pw: string }) {
  const { data, error } = useLoad<BoardPipeline>(pw, apiFetchBoardPipeline)
  const layers = (['L1', 'L2', 'L3', 'L4', 'L5'] as const)
  return (
    <Card title="知識萃取管線 L1–L5" area="bd-pipe">
      {error ? <Muted>暫時無法取得資料</Muted> : data === null ? <Muted>載入中…</Muted> : !data.available ? <Muted>尚無管線資料</Muted> : (
        <div className="bd-pipe-list">
          {layers.map(k => {
            const l = data.layers[k]
            const sched = l.schedule && l.schedule.length ? l.schedule.join(' · ') : PIPE_STATIC[k][1]
            const color = l.health === 'ok' ? COLOR.ok : l.health === 'crit' ? COLOR.crit : COLOR.steelDim
            return (
              <div key={k} style={{ display: 'grid', gridTemplateColumns: '24px minmax(0,1fr) auto', gap: 8, alignItems: 'center', background: COLOR.panelRaised, borderRadius: 6, padding: '5px 8px' }}>
                <b style={{ fontFamily: FONT.mono, fontSize: '0.84rem', color: COLOR.amber }}>{k}</b>
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontSize: '0.76rem', color: COLOR.steel, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{PIPE_STATIC[k][0]} · {sched}</div>
                  <div style={{ fontSize: '0.64rem', color: l.errorSummary ? COLOR.crit : COLOR.steelDim, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{l.errorSummary ?? `上次 ${minutesAgo(l.lastRunTs !== null ? l.lastRunTs : null)}`}</div>
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

// ── 主機健康 ──────────────────────────────────────
function SystemCard({ pw }: { pw: string }) {
  const { data, error } = useLoad<BoardStatus>(pw, apiFetchBoardStatus)
  const ok = data && data.available ? data : null
  const worst = ok?.disks.reduce<BoardStatus['disks'][number] | null>((w, d) => (!w || d.percentUsed > w.percentUsed ? d : w), null) ?? null
  const cOk = ok ? ok.containers.filter(c => !/exit|dead|unhealthy/i.test(`${c.status} ${c.health ?? ''}`)).length : 0
  const cells: Array<[string, string, string, string?]> = ok ? [
    ['CPU', ok.cpuPercent !== null ? `${Math.round(ok.cpuPercent)}%` : '—', pctColor(ok.cpuPercent)],
    ['記憶體', ok.memPercent !== null ? `${Math.round(ok.memPercent)}%` : '—', pctColor(ok.memPercent)],
    [worst ? `磁碟 ${worst.drive}` : '磁碟', worst ? `${Math.round(worst.percentUsed)}%` : '—', pctColor(worst?.percentUsed ?? null), worst ? `剩 ${worst.freeGb.toFixed(1)} GB${ok.diskForecast?.daysUntilFull != null ? ` · 約 ${ok.diskForecast.daysUntilFull} 天滿` : ''}` : undefined],
    ['容器健康', ok.containers.length ? `${cOk} / ${ok.containers.length}` : '—', ok.containers.length === 0 ? COLOR.steelDim : cOk < ok.containers.length ? COLOR.warn : COLOR.ok],
  ] : []
  return (
    <Card title="主機健康" area="bd-sys" tag={ok?.stale ? <Chip color={COLOR.warn}>資料已過期</Chip> : undefined}>
      {error ? <Muted>暫時無法取得資料</Muted> : data === null ? <Muted>載入中…</Muted> : !ok ? <Muted>尚無主機資料</Muted> : (
        <div className="bd-sys-grid" style={{ opacity: ok.stale ? 0.55 : 1 }}>
          {cells.map(([k, v, c, s]) => (
            <div key={k} className="bd-tile" style={{ background: COLOR.panelRaised, borderRadius: 6 }}>
              <Label>{k}</Label>
              <div className="bd-big" style={{ color: c }}>{v}</div>
              {s && <div style={{ fontSize: '0.62rem', color: COLOR.steelDim }}>{s}</div>}
            </div>
          ))}
        </div>
      )}
    </Card>
  )
}

export function DesktopBoard({ unlocked, unlockedPassword, hhiData, toneOf, onRequestUnlock }: {
  unlocked: boolean
  unlockedPassword: string | null
  hhiData: Record<string, unknown> | undefined
  toneOf: (s: number) => { color: string; label: string }
  onRequestUnlock: () => void
}) {
  if (!unlocked || !unlockedPassword) {
    return (
      <div className="ip-board" style={{ display: 'grid', placeItems: 'center' }}>
        <button type="button" onClick={onRequestUnlock} style={{ ...btn, fontSize: '0.8rem', padding: '10px 18px' }}>🔒 解鎖後顯示儀表板（用量、幸福指數、管線、主機）</button>
      </div>
    )
  }
  return (
    <div className="ip-board">
      <OllamaCard pw={unlockedPassword} />
      <HhiCard data={hhiData} toneOf={toneOf} />
      <NetworkCard pw={unlockedPassword} />
      <PipelineCard pw={unlockedPassword} />
      <SystemCard pw={unlockedPassword} />
    </div>
  )
}
