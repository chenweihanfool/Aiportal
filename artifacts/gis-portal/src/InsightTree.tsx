import { memo, useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react'
import { apiFetchInsightDetail, apiFetchInsights } from './insightApi'
import {
  PROVENANCE_LABEL, RELATION_LABEL, clusterSummaries, dateToY, focusViewBox, insightIdFromHash, insightStats, layoutInsightTree, leafShape,
  monthSeries, suggestTreeHeight, taipeiDay, type Insight, type InsightData, type InsightDetail, type InsightLeaf, type InsightLimb, type InsightRelation, type InsightTreeLayout,
} from './insightTree'
import { clusterSlots, paletteColor, type PaletteTheme } from './insightPalette'
import { useAsync } from './homeHooks'
import { blockState } from './homeView'
import { StateFrame } from './StateFrame'
import { PinButton } from './PinButton'
import { pinTargetFor } from './pushTriggers'
import { SearchDiaryReport } from './SearchDiaryReport'

// 首頁「我的心得樹」（2.99.0）：樹高＝時間，心得照日期長成枝葉；印證的脈絡變粗、修正分岔、推翻轉灰，近 30 天的新葉發光，可逐月重播。
// 排版是純函式（insightTree.ts／insightPalette.ts，有測試），這裡只畫 SVG、群清單側欄與側邊面板。樣式 it- 前綴在 portal.css。

const REPLAY_MS = 6000
const MIN_STEP_MS = 60
const ZOOM_MS = 450
const EMPTY_SET: ReadonlySet<string> = new Set<string>()
const reducedMotion = (): boolean => typeof window !== 'undefined' && !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches

function useWidth(active: boolean) {
  const ref = useRef<HTMLDivElement>(null)
  const [w, setW] = useState(0)
  useEffect(() => {
    const el = ref.current
    if (!el) return
    const f = () => setW(Math.floor(el.clientWidth))
    f()
    if (typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver(f)
    ro.observe(el)
    return () => ro.disconnect()
  }, [active])
  return { ref, w }
}

/** 目前的深／淺主題（data-theme 優先，沒有就跟系統） */
function useTheme(): PaletteTheme {
  const read = (): PaletteTheme => {
    if (typeof document === 'undefined') return 'dark'
    const a = document.documentElement.getAttribute('data-theme')
    if (a === 'light' || a === 'dark') return a
    return window.matchMedia?.('(prefers-color-scheme: light)').matches ? 'light' : 'dark'
  }
  const [t, setT] = useState<PaletteTheme>(read)
  useEffect(() => {
    const f = () => setT(read())
    const mo = new MutationObserver(f)
    mo.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] })
    const mq = window.matchMedia?.('(prefers-color-scheme: light)')
    mq?.addEventListener?.('change', f)
    return () => { mo.disconnect(); mq?.removeEventListener?.('change', f) }
  }, [])
  return t
}

// ─────────────────────────────────────────────
// 枝與葉（memo：滑過一片葉子時只有亮起的那幾個重畫）
// ─────────────────────────────────────────────

const Limb = memo(function Limb({ l, color, lit, dimc, fresh }: { l: InsightLimb; color: string; lit: boolean; dimc: boolean; fresh: boolean }) {
  return (
    <path
      d={l.d} pathLength={1} data-level={l.level} data-withered={l.withered ? '1' : undefined}
      className={`it-limb${l.withered ? ' it-dead' : ''}${lit ? ' it-lit' : ''}${dimc ? ' it-dimc' : ''}${fresh ? ' it-fresh' : ''}`}
      style={{ fill: l.withered ? undefined : color, color: l.withered ? undefined : color }} />
  )
})

const Leaf = memo(function Leaf({ lf, ins, color, lit, dimc, fresh, onOpen, onHover, onKey }: {
  lf: InsightLeaf; ins: Insight | undefined; color: string; lit: boolean; dimc: boolean; fresh: boolean
  onOpen: (id: string) => void; onHover: (id: string | null) => void; onKey: (e: ReactKeyboardEvent, id: string) => void
}) {
  const sh = leafShape(lf.relation)
  return (
    <g
      className={`it-leaf${lf.withered ? ' it-dead' : ''}${lf.glow && !lf.withered ? ' it-glow' : ''}${lit ? ' it-lit' : ''}${dimc ? ' it-dimc' : ''}`} data-relation={lf.relation} data-testid="insight-leaf"
      role="button" tabIndex={0} aria-label={ins ? `${ins.date} ${ins.text}` : lf.id}
      onClick={() => onOpen(lf.id)} onKeyDown={(e) => onKey(e, lf.id)}
      onMouseEnter={() => onHover(lf.id)} onMouseLeave={() => onHover(null)} onFocus={() => onHover(lf.id)} onBlur={() => onHover(null)}
    >
      <g transform={`translate(${lf.x},${lf.y})`}>
        <g className={fresh ? 'it-pop' : undefined}>
          {lf.glow && !lf.withered && <circle className="it-halo" r={lf.r * 1.9} style={{ fill: color }} />}
          <circle r={lf.r * 1.5} className="it-hit" />
          <g transform={`rotate(${lf.angle}) scale(${lf.r})`}>
            <path className="it-shape" d={sh.d} style={{ fill: lf.withered ? undefined : color }} data-kind={sh.kind} />
            {sh.vein && <path className="it-vein" d={sh.vein} vectorEffect="non-scaling-stroke" />}
          </g>
        </g>
      </g>
    </g>
  )
})

/** 圖例用的小葉形 */
function LegendLeaf({ relation }: { relation: InsightRelation }) {
  const sh = leafShape(relation)
  return (
    <svg className="it-lg-ic" viewBox="-2.4 -2.4 4.8 4.8" width="16" height="16" aria-hidden focusable="false">
      <path className={`it-shape it-lg-${sh.kind}`} d={sh.d} />
      {sh.vein && <path className="it-vein" d={sh.vein} vectorEffect="non-scaling-stroke" />}
    </svg>
  )
}

function MiniBars({ months, max, color }: { months: number[]; max: number; color: string }) {
  return (
    <svg className="it-bars" viewBox="0 0 60 16" width="60" height="16" aria-hidden focusable="false">
      {months.map((n, i) => {
        const h = n === 0 ? 1 : 2 + (n / Math.max(1, max)) * 13
        return <rect key={i} x={i * 5} y={16 - h} width={3.6} height={h} rx={1} style={{ fill: n === 0 ? undefined : color }} className={n === 0 ? 'it-bar0' : undefined} />
      })}
    </svg>
  )
}

const dateShort = (d: string | null, year: string): string => (d === null ? '—' : d.slice(0, 4) === year ? d.slice(5).replace('-', '/') : d.replace(/-/g, '/'))

export function InsightTree({ pw, now, onRequestUnlock }: { pw: string | null; now: Date; onRequestUnlock: () => void }) {
  const ins = useAsync(pw, apiFetchInsights)
  const data: InsightData | null = ins.data
  const hasTree = !!data && data.insights.length > 0
  const nowMs = now.getTime()
  const st = blockState({ unlocked: !!pw, loading: ins.loading, error: ins.error, hasData: !!data, empty: !!data && data.insights.length === 0, nowMs })
  const { ref: stageRef, w: measured } = useWidth(hasTree && st.state !== 'locked')
  const width = measured > 0 ? measured : 640
  const theme = useTheme()

  const [selected, setSelected] = useState<string | null>(() => (typeof window === 'undefined' ? null : insightIdFromHash(window.location.hash)))
  const [hover, setHover] = useState<string | null>(null)
  const [upto, setUpto] = useState<string | null>(null)
  const [playing, setPlaying] = useState(false)
  const [focus, setFocus] = useState<number | null>(null)
  const idxRef = useRef(0)

  // #insight/<id>（搜尋、釘選、推送卡的連結）→ 打開那一則的面板
  useEffect(() => {
    const f = () => { const id = insightIdFromHash(window.location.hash); if (id) setSelected(id) }
    window.addEventListener('hashchange', f)
    return () => window.removeEventListener('hashchange', f)
  }, [])

  const day = taipeiDay(now)
  const months = useMemo(() => (data ? monthSeries(data, now) : []), [data, day]) // eslint-disable-line react-hooks/exhaustive-deps
  const height = suggestTreeHeight(width, data?.insights.length ?? 0, months.length)
  const layout: InsightTreeLayout | null = useMemo(
    () => (data && hasTree ? layoutInsightTree(data, { width, height, now, upto: upto ?? undefined }) : null),
    [data, hasTree, width, height, day, upto], // eslint-disable-line react-hooks/exhaustive-deps
  )
  const stats = useMemo(() => (data ? insightStats(data, now) : null), [data, day]) // eslint-disable-line react-hooks/exhaustive-deps
  const summaries = useMemo(() => (data ? clusterSummaries(data, now) : []), [data, day]) // eslint-disable-line react-hooks/exhaustive-deps
  const byId = useMemo(() => new Map((data?.insights ?? []).map((i) => [i.id, i])), [data])
  const slots = useMemo(() => clusterSlots((layout?.clusters ?? []).map((c) => c.id)), [layout?.clusters.length]) // eslint-disable-line react-hooks/exhaustive-deps
  const slotOf = (cid: string): number => slots.get(cid) ?? 0
  const clusterIdx = useMemo(() => new Map((layout?.clusters ?? []).map((c, i) => [c.id, i])), [layout])

  // ── 重播：約 6 秒逐月推進到今天（枝逐段描邊長出、葉子彈出）──
  const endTimer = useRef<number | null>(null)
  useEffect(() => () => { if (endTimer.current !== null) window.clearTimeout(endTimer.current) }, [])
  useEffect(() => {
    if (!playing) return
    if (months.length < 2) { setPlaying(false); return }
    const step = Math.max(MIN_STEP_MS, Math.round(REPLAY_MS / months.length))
    const t = window.setInterval(() => {
      idxRef.current += 1
      if (idxRef.current >= months.length - 1) {
        window.clearInterval(t)
        setUpto(null)
        endTimer.current = window.setTimeout(() => setPlaying(false), 800)
        return
      }
      setUpto(months[idxRef.current]!)
    }, step)
    return () => window.clearInterval(t)
  }, [playing, months])
  const togglePlay = () => {
    if (playing) { setPlaying(false); return }
    if (reducedMotion()) { setUpto(null); return } // 減少動態：直接是結果
    idxRef.current = 0
    setUpto(months[0] ?? null)
    setPlaying(true)
  }
  const monthLabel = upto ?? months[months.length - 1] ?? ''
  // 重播時新出現的枝與葉（不在上一步畫面裡的）才播出現動畫
  const prevIds = useRef<Set<string> | null>(null)
  const fresh = useMemo<ReadonlySet<string>>(() => {
    if (!layout || !playing || !prevIds.current) return EMPTY_SET
    const f = new Set<string>()
    for (const l of layout.limbs) if (!prevIds.current.has(l.id)) f.add(l.id)
    for (const l of layout.leaves) if (!prevIds.current.has(l.id)) f.add(l.id)
    return f
  }, [layout, playing])
  useEffect(() => {
    if (!layout) return
    const s = new Set<string>()
    for (const l of layout.limbs) s.add(l.id)
    for (const l of layout.leaves) s.add(l.id)
    prevIds.current = s
  }, [layout])

  // ── 聚焦某一群：viewBox 平滑放大到那一枝 ──
  const [vb, setVb] = useState<{ x: number; y: number; w: number; h: number } | null>(null)
  const vbRef = useRef<{ x: number; y: number; w: number; h: number } | null>(null)
  const target = useMemo(() => (layout ? focusViewBox(layout, focus) : null), [layout, focus])
  const lastKey = useRef('')
  useEffect(() => {
    if (!target || !layout) return
    // 只有「聚焦的群」改變才播放放大動畫；畫布大小改變（載入、視窗縮放）直接換成新的 viewBox
    const key = `${layout.width}x${layout.height}`
    const sizeChanged = lastKey.current !== key
    lastKey.current = key
    const from = vbRef.current
    if (!from || sizeChanged || reducedMotion()) { vbRef.current = target; setVb(target); return }
    let raf = 0
    const t0 = performance.now()
    const step = (t: number) => {
      const k = Math.min(1, (t - t0) / ZOOM_MS)
      const e = k < 0.5 ? 2 * k * k : 1 - Math.pow(-2 * k + 2, 2) / 2
      const cur = { x: from.x + (target.x - from.x) * e, y: from.y + (target.y - from.y) * e, w: from.w + (target.w - from.w) * e, h: from.h + (target.h - from.h) * e }
      vbRef.current = cur
      setVb(cur)
      if (k < 1) raf = requestAnimationFrame(step)
    }
    raf = requestAnimationFrame(step)
    return () => cancelAnimationFrame(raf)
  }, [target]) // eslint-disable-line react-hooks/exhaustive-deps
  const toggleFocus = (ci: number) => setFocus((f) => (f === ci ? null : ci))

  const closePanel = useCallback(() => {
    setSelected(null)
    if (insightIdFromHash(window.location.hash)) {
      try { window.history.replaceState(null, '', window.location.pathname + window.location.search) } catch { /* 取不到 history 就維持原網址 */ }
    }
  }, [])
  const open = useCallback((id: string) => { setHover(null); setSelected(id) }, [])
  const onLeafKey = useCallback((e: ReactKeyboardEvent, id: string) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open(id) } }, [open])

  // ── 滑過／聚焦一片葉子：從樹幹到它的整條路徑亮起 ──
  const hovered = hover && layout ? layout.leaves.find((l) => l.id === hover) ?? null : null
  const hoveredIns = hovered ? byId.get(hovered.id) : undefined
  const lit = useMemo<ReadonlySet<string>>(() => (hovered ? new Set(hovered.path) : EMPTY_SET), [hovered])
  const view = vb ?? { x: 0, y: 0, w: layout?.width ?? width, h: layout?.height ?? height }
  const scale = layout ? layout.width / view.w : 1
  const col = (ci: number, shade = 0): string => paletteColor(slotOf(layout?.clusters[ci]?.id ?? ''), theme, shade)
  const year = day.slice(0, 4)
  const maxBar = Math.max(1, ...summaries.flatMap((s) => s.months))

  return (
    <section className="it-root" aria-labelledby="it-h" data-testid="insight-tree" data-theme-mode={theme}>
      <div className="it-head">
        <h2 id="it-h" className="it-title">我的心得樹</h2>
        {hasTree && (
          <button type="button" className="it-play" data-testid="insight-play" onClick={togglePlay} disabled={months.length < 2} aria-pressed={playing}>
            {playing ? '⏸ 停' : '▶ 看它怎麼長'}
          </button>
        )}
      </div>
      <StateFrame
        status={st} source="我的心得" onRequestUnlock={onRequestUnlock} onRetry={ins.reload} className="it-frame"
        empty={<span data-testid="insight-empty">心得累積中：HERMES 每晚會從日記抽出你的體會，長成這棵樹</span>}
        errorText="心得暫時讀不到"
        skeleton={<div className="it-skel" data-testid="insight-skeleton" aria-hidden />}
      >
        {layout && stats && (
          <div className="it-body">
            <div className="it-main">
              <div className="it-stage" ref={stageRef} style={{ height: layout.height }}>
                <svg
                  className={`it-svg${hovered ? ' it-hl' : ''}${focus !== null ? ' it-fx' : ''}`} viewBox={`${view.x} ${view.y} ${view.w} ${view.h}`}
                  width={layout.width} height={layout.height} role="group" aria-label="我的心得樹：樹越高越新" data-focus={focus ?? undefined}
                >
                  <defs>
                    <linearGradient id="it-trunk-g" gradientUnits="userSpaceOnUse" x1="0" x2="0" y1={layout.axis.ground} y2={layout.axis.top}>
                      <stop offset="0" className="it-trunk-s0" />
                      <stop offset="1" className="it-trunk-s1" />
                    </linearGradient>
                    <radialGradient id="it-ground-g"><stop offset="0" className="it-ground-s0" /><stop offset="1" className="it-ground-s1" /></radialGradient>
                    <linearGradient id="it-hline-g" x1="0" x2="1" y1="0" y2="0"><stop offset="0" className="it-hline-s1" /><stop offset="0.5" className="it-hline-s0" /><stop offset="1" className="it-hline-s1" /></linearGradient>
                  </defs>
                  {/* 地面：帶柔光的地平線 */}
                  <ellipse className="it-ground" cx={layout.width / 2 + 20} cy={layout.axis.ground + 2} rx={layout.width * 0.46} ry={14} fill="url(#it-ground-g)" />
                  <rect x={layout.axis.x + 6} y={layout.axis.ground} width={layout.width - layout.axis.x - 12} height={1.4} fill="url(#it-hline-g)" />
                  {/* 時間刻度（年輪）：左側一條淡淡的軸，標年／季，並有很淡的水平參考線 */}
                  <g className="it-axis" aria-hidden>
                    <line x1={layout.axis.x} x2={layout.axis.x} y1={layout.axis.top} y2={layout.axis.ground} />
                    {layout.ticks.map((t) => (
                      <g key={`${t.label}${t.y}`} className={t.major ? 'it-tick it-tick-major' : 'it-tick'}>
                        <line className="it-ref" x1={layout.axis.x} x2={layout.width - 10} y1={t.y} y2={t.y} />
                        <line x1={layout.axis.x - 4} x2={layout.axis.x} y1={t.y} y2={t.y} />
                        <text x={layout.axis.x - 7} y={t.y + 3.5} textAnchor="end">{layout.compact && !t.major ? t.label.slice(2) : t.label}</text>
                      </g>
                    ))}
                  </g>
                  {upto && <text className="it-bigmonth" x={layout.axis.x + 12} y={Math.max(layout.axis.top + 18, dateToY(layout.axis, `${upto}-28`) - 6)} aria-hidden>{upto}</text>}
                  <path className="it-trunk" d={layout.trunk.d} fill="url(#it-trunk-g)" />
                  {layout.limbs.map((l) => {
                    const ci = l.clusterIndex ?? 0
                    let color = col(ci, l.shade ?? 0)
                    if (l.level === 'cluster') { const k = Number(l.id.slice(l.id.lastIndexOf('#') + 1)); color = `color-mix(in srgb, ${col(ci)} ${40 + 15 * k}%, var(--it-trunk1))` }
                    return <Limb key={l.id} l={l} color={color} lit={lit.has(l.id)} dimc={focus !== null && ci !== focus} fresh={fresh.has(l.id)} />
                  })}
                  {layout.clusters.map((c, ci) => c.count > 0 && c.labelShown && (
                    <g key={c.id} className={`it-cap${focus !== null && ci !== focus ? ' it-dimc' : ''}${focus === ci ? ' it-cap-on' : ''}`} style={{ color: col(ci) }} role="button" tabIndex={0}
                      aria-label={`${c.name} ${c.count} 則，點一下聚焦這一群`} aria-pressed={focus === ci} data-testid="insight-cap"
                      onClick={() => toggleFocus(ci)} onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggleFocus(ci) } }}>
                      {c.leader && <line className="it-leader" x1={c.x} y1={c.y} x2={c.lx} y2={c.ly} />}
                      <circle className="it-tipdot" cx={c.x} cy={c.y} r={2.6} />
                      <rect className="it-cap-bg" x={c.lx - c.lw / 2} y={c.ly - c.lh / 2} width={c.lw} height={c.lh} rx={c.lh / 2} />
                      <circle className="it-cap-dot" cx={c.lx - c.lw / 2 + 10} cy={c.ly} r={3.6} />
                      <text className="it-cap-t" x={c.lx - c.lw / 2 + (c.abbr ? 17 : 19)} y={c.ly + 4}>{c.text}</text>
                      {c.showCount && <text className="it-cap-n" x={c.lx + c.lw / 2 - 9} y={c.ly + 4} textAnchor="end">{c.count}</text>}
                    </g>
                  ))}
                  {layout.leaves.map((lf) => (
                    <Leaf key={lf.id} lf={lf} ins={byId.get(lf.id)} color={col(lf.clusterIndex, lf.shade)} lit={lit.has(lf.id) && hovered?.id === lf.id}
                      dimc={focus !== null && lf.clusterIndex !== focus} fresh={fresh.has(lf.id)} onOpen={open} onHover={setHover} onKey={onLeafKey} />
                  ))}
                </svg>
                {hovered && hoveredIns && (
                  <div className="it-tip" role="tooltip" data-testid="insight-tip"
                    style={{ left: Math.min(Math.max((hovered.x - view.x) * scale, 120), Math.max(120, layout.width - 120)), top: (hovered.y - view.y - hovered.r * 1.5) * scale - 6 }}>
                    <span className="it-tip-d">{hoveredIns.date}<span className={`it-rel it-rel-${hoveredIns.relation}`}>{RELATION_LABEL[hoveredIns.relation]}</span></span>
                    {hoveredIns.text}
                  </div>
                )}
                {upto && <span className="it-sr" data-testid="insight-month-big">{upto}</span>}
              </div>
              {stats.total <= 5 && <p className="it-seedling" data-testid="insight-seedling">小樹苗：HERMES 每晚會從日記補上你的心得</p>}
              <div className="it-foot">
                <span className="it-month" data-testid="insight-month" aria-live="polite">
                  {upto ? `${playing ? '重播中' : '停在'} ${monthLabel}` : `${monthLabel}・至今`}
                </span>
                {upto && !playing && <button type="button" className="it-back" onClick={() => setUpto(null)}>回到今天</button>}
                <ul className="it-legend" aria-label="圖例">
                  <li><LegendLeaf relation="new" />新生</li>
                  <li><LegendLeaf relation="reinforce" />印證</li>
                  <li><LegendLeaf relation="refine" />修正</li>
                  <li><LegendLeaf relation="overturn" />推翻</li>
                  <li><span className="it-lg-glow" aria-hidden />近 30 天發光</li>
                </ul>
              </div>
            </div>
            <aside className="it-side" aria-label="心得的領域清單">
              <p className="it-stats" data-testid="insight-stats">
                心得 {stats.total} 則・本月 +{stats.thisMonth}・脈絡 {stats.threads} 條{stats.topReinforced ? `・最常印證：〈${stats.topReinforced.text}〉` : ''}
              </p>
              <ul className="it-rows" data-testid="insight-rows">
                <li>
                  <button type="button" className={`it-row it-row-all${focus === null ? ' it-row-on' : ''}`} data-testid="insight-all" aria-pressed={focus === null} onClick={() => setFocus(null)}>
                    <span className="it-row-name">全部</span><span className="it-row-n">{stats.total}</span>
                  </button>
                </li>
                {summaries.map((s) => {
                  const ci = clusterIdx.get(s.id)
                  const c = ci === undefined ? col(0) : col(ci)
                  const on = ci !== undefined && focus === ci
                  return (
                    <li key={s.id}>
                      <button type="button" className={`it-row${on ? ' it-row-on' : ''}`} data-testid="insight-row" aria-pressed={on} disabled={ci === undefined}
                        onClick={() => { if (ci !== undefined) toggleFocus(ci) }} title={`${s.name}：${s.count} 則，最近 ${s.lastDate ?? '—'}`}>
                        <i className="it-row-dot" style={{ background: c }} aria-hidden />
                        <span className="it-row-name">{s.name}</span>
                        <span className="it-row-n">{s.count}</span>
                        <span className="it-row-d">{dateShort(s.lastDate, year)}</span>
                        <MiniBars months={s.months} max={maxBar} color={c} />
                      </button>
                    </li>
                  )
                })}
              </ul>
            </aside>
          </div>
        )}
      </StateFrame>
      {selected && <InsightPanel pw={pw} id={selected} fallback={byId.get(selected) ?? null} onClose={closePanel} onSelect={open} />}
    </section>
  )
}

// ─────────────────────────────────────────────
// 側邊面板
// ─────────────────────────────────────────────

type DetailState = { id: string; state: 'loading' | 'ok' | 'missing' | 'error'; data: InsightDetail | null }

export function InsightPanel({ pw, id, fallback, onClose, onSelect }: {
  pw: string | null; id: string; fallback: Insight | null; onClose: () => void; onSelect: (id: string) => void
}) {
  const [det, setDet] = useState<DetailState | null>(null)
  const [showDay, setShowDay] = useState(false)
  const closeRef = useRef<HTMLButtonElement>(null)
  useEffect(() => { closeRef.current?.focus() }, [])
  useEffect(() => {
    const f = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', f)
    return () => window.removeEventListener('keydown', f)
  }, [onClose])
  useEffect(() => { setShowDay(false) }, [id])
  useEffect(() => {
    if (!pw) { setDet(null); return }
    const ctl = new AbortController()
    setDet({ id, state: 'loading', data: null })
    apiFetchInsightDetail(pw, id, ctl.signal)
      .then((d) => { if (!ctl.signal.aborted) setDet({ id, state: d ? 'ok' : 'missing', data: d }) })
      .catch(() => { if (!ctl.signal.aborted) setDet({ id, state: 'error', data: null }) })
    return () => ctl.abort()
  }, [pw, id])

  const cur = det && det.id === id ? det : null
  const d = cur?.state === 'ok' ? cur.data : null
  const text = d?.text ?? fallback?.text ?? ''
  const date = d?.date ?? fallback?.date ?? ''
  const relation = d?.relation ?? fallback?.relation ?? null
  const provenance = d?.provenance ?? fallback?.provenance ?? null
  const items = d && d.threadItems.length > 0 ? d.threadItems : fallback ? [fallback] : []
  const pinTarget = text ? pinTargetFor({ kind: 'insight', id, title: text.length > 60 ? `${text.slice(0, 59)}…` : text }) : null

  return (
    <>
      <div className="it-back-drop" onClick={onClose} aria-hidden />
      <aside className="it-panel" role="dialog" aria-label="心得詳情" data-testid="insight-panel">
        <div className="it-panel-top">
          <span className="it-kd">心得{d ? `・${d.cluster.name}` : ''}</span>
          <button ref={closeRef} type="button" className="it-x" onClick={onClose} aria-label="關閉心得面板">關閉 ✕</button>
        </div>
        <h3 className="it-panel-text" data-testid="insight-panel-text">{text || '（找不到這則心得）'}</h3>
        <div className="it-meta">
          {date && (
            <button type="button" className="it-date" data-testid="insight-date" aria-expanded={showDay} onClick={() => setShowDay((v) => !v)}>
              {date}{d?.time ?? fallback?.time ? ` ${d?.time ?? fallback?.time}` : ''}・看那天日報
            </button>
          )}
          {relation && <span className={`it-rel it-rel-${relation}`}>{RELATION_LABEL[relation]}</span>}
          {provenance && <span className="it-prov">{PROVENANCE_LABEL[provenance]}</span>}
        </div>
        {showDay && date && <div className="it-day" data-testid="insight-day"><SearchDiaryReport date={date} pw={pw} /></div>}
        <h4 className="it-lb">日記原文</h4>
        {!cur || cur.state === 'loading' ? <p className="it-dim">載入中…</p>
          : cur.state === 'error' ? <p className="it-dim" role="status">原文暫時讀不到，稍後再試。</p>
          : cur.state === 'missing' || !d ? <p className="it-dim">這一則沒有原文資料。</p>
          : <>
            <blockquote className="it-evidence" data-testid="insight-evidence">{d.evidence || '（沒有原文）'}</blockquote>
            {d.source && <div className="it-src">出處：{d.source}</div>}
          </>}
        <h4 className="it-lb">整條脈絡</h4>
        <ol className="it-thread" data-testid="insight-thread" aria-label="整條脈絡的時間線">
          {items.map((t) => (
            <li key={t.id} className={t.id === id ? 'it-cur' : undefined} aria-current={t.id === id ? 'true' : undefined}>
              <button type="button" onClick={() => { if (t.id !== id) onSelect(t.id) }}>
                <span className="it-t-d">{t.date}</span>
                <span className={`it-rel it-rel-${t.relation}`}>{RELATION_LABEL[t.relation]}</span>
                <span className="it-t-x">{t.text}</span>
              </button>
            </li>
          ))}
        </ol>
        <div className="it-act"><PinButton pw={pw} target={pinTarget} /></div>
      </aside>
    </>
  )
}
