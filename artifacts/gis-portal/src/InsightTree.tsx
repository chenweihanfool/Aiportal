import { memo, useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react'
import { apiFetchInsightDetail, apiFetchInsights } from './insightApi'
import {
  PROVENANCE_LABEL, RELATION_LABEL, clusterSummaries, focusViewBox, insightIdFromHash, insightStats, layoutInsightTree, leafShape,
  monthSeries, suggestTreeHeight, taipeiDay, type Insight, type InsightClusterOut, type InsightData, type InsightDetail, type InsightLeaf, type InsightLimb, type InsightRelation, type InsightTreeLayout,
} from './insightTree'
import { clusterSlots, paletteColor, type PaletteTheme } from './insightPalette'
import { useAsync } from './homeHooks'
import { blockState } from './homeView'
import { StateFrame } from './StateFrame'
import { PinButton } from './PinButton'
import { pinTargetFor } from './pushTriggers'
import { createPortal } from 'react-dom'
import { DayReportDialog } from './DayReportDialog'
import { buildTimelineDayLink } from './timelineLink'
import { dossierHref } from './dossier'
import { FOCUS_ICON, STAGE_COLOR, STAGE_ICON, STAGE_LABEL, isFocus, stageOf } from './ideasView'
import type { IdeaItem } from './boardApi'
import { rootAction, rootPaths, rootSlots, type RootAction } from './insightLinks'
import { HIGH, LOW, bornBand, insightsByBand } from './hhiBorn'

// 首頁「我的心得樹」（3.0.0）：一棵樹＝人生，每條主枝是一個主題，時間沿主枝往外走（越外越新）；印證的脈絡變粗、修正分岔、推翻轉灰，近 30 天的新葉發光，可逐月重播。
// 總覽時主題多會自動精簡（葉叢、標籤縮成色點），滑過／聚焦才放大；聚焦一個主題會畫出全部脈絡與沿枝的時間。
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
      d={l.d} pathLength={1} data-level={l.level} data-ci={l.clusterIndex} data-withered={l.withered ? '1' : undefined}
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
      role="button" tabIndex={0} aria-label={ins ? `${ins.date} ${ins.text}` : lf.id} data-ci={lf.clusterIndex} data-age={lf.age}
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

/** 主題標籤：放得下就是膠囊；放不下縮成色點，滑過／聚焦／點清單時放大成完整膠囊 */
const Cap = memo(function Cap({ c, ci, scale, color, open, dimc, on, onPick, onEnter }: { c: InsightClusterOut; ci: number; scale: number; color: string; open: boolean; dimc: boolean; on: boolean; onPick: () => void; onEnter: () => void }) {
  return (
    <g className={`it-cap${dimc ? ' it-dimc' : ''}${on ? ' it-cap-on' : ''}${open ? '' : ' it-cap-dotmode'}`} style={{ color }} role="button" tabIndex={0} data-ci={ci}
      aria-label={`${c.name} ${c.count} 則，點一下聚焦這個主題`} aria-pressed={on} data-testid={open ? 'insight-cap' : 'insight-dot'}
      onClick={onPick} onFocus={onEnter} onMouseEnter={onEnter} onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onPick() } }}>
      {open && c.leader && <line className="it-leader" x1={c.x} y1={c.y} x2={c.lx} y2={c.ly} />}
      <circle className="it-tipdot" cx={c.x} cy={c.y} r={open ? 2.6 : 5.5} />
      {!open && <circle className="it-cap-hit" cx={c.x} cy={c.y} r={Math.max(11, 16 / scale)} />}
      {open && (
        <>
          <rect className="it-cap-hit" x={c.lx - Math.max(c.lw, 32 / scale) / 2} y={c.ly - Math.max(c.lh, 32 / scale) / 2} width={Math.max(c.lw, 32 / scale)} height={Math.max(c.lh, 32 / scale)} />
          <rect className="it-cap-bg" x={c.lx - c.lw / 2} y={c.ly - c.lh / 2} width={c.lw} height={c.lh} rx={c.lh / 2} />
          <circle className="it-cap-dot" cx={c.lx - c.lw / 2 + 10} cy={c.ly} r={3.6} />
          <text className="it-cap-t" x={c.lx - c.lw / 2 + 19} y={c.ly + 4}>{c.text}</text>
          {c.showCount && <text className="it-cap-n" x={c.lx + c.lw / 2 - 9} y={c.ly + 4} textAnchor="end">{c.count}</text>}
        </>
      )}
    </g>
  )
})

/** 圖例用的小葉形 */
const ROOT_DEPTH = 56
const idea6 = (t: string): string => { const a = Array.from(t); return a.length > 6 ? `${a.slice(0, 6).join('')}…` : t }

/** 地面下的根：滑過葉子後留著，連到這則心得相關的人物頭像與想法小卡；點人開卷宗、點想法開想法庫、點 +N 開心得面板 */
function Roots({ ins, cx, top, width, canIdea, onPick }: {
  ins: Insight; cx: number; top: number; width: number; canIdea: boolean; onPick: (a: RootAction) => void
}) {
  const slots = rootSlots(ins)
  if (slots.length === 0) return null
  const paths = rootPaths(cx, width, slots.length, ROOT_DEPTH)
  return (
    <svg className="it-roots" data-testid="insight-roots" width={width} height={ROOT_DEPTH + 14} style={{ top }} role="group" aria-label="這則心得連到的人與想法">
      {paths.map((p, k) => {
        const sl = slots[k]!
        const act = sl.kind === 'idea' && !canIdea ? null : rootAction(sl)
        const label = sl.kind === 'person' ? `開啟人物卷宗：${sl.name}` : sl.kind === 'idea' ? `在想法庫開啟：${sl.title}` : '看這則心得的全部連結'
        const node = sl.kind === 'person' ? (
          <g className="it-root-n" data-testid="insight-root-person">
            <circle cx={p.x} cy={p.y} r={9} /><text x={p.x} y={p.y + 3.5} textAnchor="middle">{Array.from(sl.name)[0] ?? ''}</text>
          </g>
        ) : sl.kind === 'idea' ? (
          <g className="it-root-i" data-testid="insight-root-idea">
            <rect x={Math.min(Math.max(p.x, 52), Math.max(52, width - 52)) - 50} y={p.y - 9} width={100} height={18} rx={6} />
            <text x={Math.min(Math.max(p.x, 52), Math.max(52, width - 52))} y={p.y + 3.5} textAnchor="middle">{`💡${idea6(sl.title)}`}</text>
          </g>
        ) : (
          <text className="it-root-more" data-testid="insight-root-more" x={p.x} y={p.y + 3.5} textAnchor="middle">+{sl.n}</text>
        )
        return (
          <g key={`n${k}`} className={`it-root-go${act ? '' : ' it-root-off'}`} data-testid="insight-root-go"
            {...(act
              ? { role: act.kind === 'dossier' ? 'link' : 'button', 'aria-label': label, tabIndex: -1, onClick: () => onPick(act) }
              : { title: sl.kind === 'person' ? '還沒有人物卷宗' : undefined })}>
            <path className="it-root-hit" d={p.d} />
            <path className="it-root-p" d={p.d} />
            {node}
          </g>
        )
      })}
    </svg>
  )
}

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

export function InsightTree({ pw, now, onRequestUnlock, ideas, onOpenIdea, hhiScores = null }: {
  pw: string | null; now: Date; onRequestUnlock: () => void; ideas?: IdeaItem[] | null; onOpenIdea?: (id: string) => void
  hhiScores?: Map<string, number> | null
}) {
  const ins = useAsync(pw, apiFetchInsights)
  const data: InsightData | null = ins.data
  const hasTree = !!data && data.insights.length > 0
  const nowMs = now.getTime()
  const st = blockState({ unlocked: !!pw, loading: ins.loading, error: ins.error, hasData: !!data, empty: !!data && data.insights.length === 0, nowMs })
  const { ref: stageRef, w: measured } = useWidth(hasTree && st.state !== 'locked')
  const width = measured > 0 ? measured : 640
  const theme = useTheme()

  const [selected, setSelected] = useState<string | null>(() => (typeof window === 'undefined' ? null : insightIdFromHash(window.location.hash)))
  const [bornPick, setBornPick] = useState<'high' | 'low' | null>(null)
  const [hover, setHover] = useState<string | null>(null)
  // 根系「黏住」：滑過／聚焦葉子時記下那片，離開葉子不清（否則根一移過去就消失、點不到）
  const [rootsFor, setRootsFor] = useState<string | null>(null)
  const [upto, setUpto] = useState<string | null>(null)
  const [playing, setPlaying] = useState(false)
  const [focusId, setFocusId] = useState<string | null>(null)
  const [capHover, setCapHover] = useState<number | null>(null)
  const [vh, setVh] = useState<number>(() => (typeof window === 'undefined' ? 900 : window.innerHeight))
  useEffect(() => {
    const f = () => setVh(window.innerHeight)
    window.addEventListener('resize', f)
    return () => window.removeEventListener('resize', f)
  }, [])
  const idxRef = useRef(0)

  // #insight/<id>（搜尋、釘選、推送卡的連結）→ 打開那一則的面板
  useEffect(() => {
    // 網址回到沒有 #insight/ 的狀態（例如瀏覽器上一頁）就關面板，避免網址空了面板還開著
    const f = () => { const id = insightIdFromHash(window.location.hash); setSelected(id) }
    window.addEventListener('hashchange', f)
    return () => window.removeEventListener('hashchange', f)
  }, [])

  const day = taipeiDay(now)
  const months = useMemo(() => (data ? monthSeries(data, now) : []), [data, day]) // eslint-disable-line react-hooks/exhaustive-deps
  const height = suggestTreeHeight(width, vh)
  const layout: InsightTreeLayout | null = useMemo(
    () => (data && hasTree ? layoutInsightTree(data, { width, height, now, upto: upto ?? undefined, focus: focusId }) : null),
    [data, hasTree, width, height, day, upto, focusId], // eslint-disable-line react-hooks/exhaustive-deps
  )
  const stats = useMemo(() => (data ? insightStats(data, now) : null), [data, day]) // eslint-disable-line react-hooks/exhaustive-deps
  const summaries = useMemo(() => (data ? clusterSummaries(data, now) : []), [data, day]) // eslint-disable-line react-hooks/exhaustive-deps
  const byId = useMemo(() => new Map((data?.insights ?? []).map((i) => [i.id, i])), [data])
  const bands = useMemo(() => (data && hhiScores ? insightsByBand(data.insights, hhiScores) : null), [data, hhiScores])
  const slots = useMemo(() => clusterSlots((data?.insights ?? []).length === 0 ? [] : [...new Set([...(data?.clusters ?? []).map((c) => c.id), ...(data?.insights ?? []).map((i) => i.cluster)])]), [data]) // eslint-disable-line react-hooks/exhaustive-deps
  const slotOf = (cid: string): number => slots.get(cid) ?? 0
  const clusterIdx = useMemo(() => new Map((layout?.clusters ?? []).map((c, i) => [c.id, i])), [layout])
  const focus: number | null = focusId !== null && layout && clusterIdx.has(focusId) && layout.clusters[clusterIdx.get(focusId)!]!.count > 0 ? clusterIdx.get(focusId)! : null

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
  const toggleFocus = (ci: number) => { const id = layout?.clusters[ci]?.id ?? null; setFocusId((f) => (f === id ? null : id)) }

  const closePanel = useCallback(() => {
    setSelected(null)
    if (insightIdFromHash(window.location.hash)) {
      try { window.history.replaceState(null, '', window.location.pathname + window.location.search) } catch { /* 取不到 history 就維持原網址 */ }
    }
  }, [])
  // 開面板時寫入 #insight/<id>（一般 hash 導航會留歷史），從時間軸按瀏覽器上一頁才回得到這則心得
  const open = useCallback((id: string) => {
    setHover(null); setRootsFor(null); setSelected(id)
    if (insightIdFromHash(window.location.hash) !== id) window.location.hash = `insight/${encodeURIComponent(id)}`
  }, [])
  const onLeafKey = useCallback((e: ReactKeyboardEvent, id: string) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open(id) } }, [open])
  // 滑過／聚焦葉子：提示跟 hover，根系換成那片；離開葉子只收提示，根留著讓人移過去點
  const onLeafHover = useCallback((id: string | null) => { setHover(id); if (id !== null) setRootsFor(id) }, [])
  const onRootPick = useCallback((a: RootAction) => {
    const id = rootsFor
    setHover(null); setRootsFor(null)
    if (a.kind === 'dossier') window.location.hash = a.href
    else if (a.kind === 'idea') onOpenIdea?.(a.id)
    else if (id !== null) open(id)
  }, [rootsFor, onOpenIdea, open])

  // ── 滑過／聚焦一片葉子：從樹幹到它的整條路徑亮起 ──
  const hovered = hover && layout ? layout.leaves.find((l) => l.id === hover) ?? null : null
  const hoveredIns = hovered ? byId.get(hovered.id) : undefined
  const rootsLeaf = rootsFor && layout ? layout.leaves.find((l) => l.id === rootsFor) ?? null : null
  const rootsIns = rootsLeaf ? byId.get(rootsLeaf.id) : undefined
  const lit = useMemo<ReadonlySet<string>>(() => (hovered ? new Set(hovered.path) : EMPTY_SET), [hovered])
  const view = vb ?? { x: 0, y: 0, w: layout?.width ?? width, h: layout?.height ?? height }
  const scale = layout ? layout.width / view.w : 1
  const col = (ci: number, shade = 0, age = 0): string => paletteColor(slotOf(layout?.clusters[ci]?.id ?? ''), theme, shade, age)
  const year = day.slice(0, 4)
  const focusC = focus !== null && layout ? layout.clusters[focus] ?? null : null
  const maxBar = Math.max(1, ...summaries.flatMap((s) => s.months))
  const bornList = bands && bornPick ? (bornPick === 'high' ? bands.high : bands.low).slice(0, 8) : []

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
              <div className="it-stage" ref={stageRef} style={{ height: layout.height }} onMouseLeave={() => setRootsFor(null)}>
                <svg
                  className={`it-svg${hovered ? ' it-hl' : ''}${focus !== null ? ' it-fx' : ''}`} viewBox={`${view.x} ${view.y} ${view.w} ${view.h}`}
                  width={layout.width} height={layout.height} role="group" aria-label="我的心得樹：一棵樹是我的人生，每條主枝是一個主題，越外越新" data-focus={focus ?? undefined}
                  onMouseOver={(e) => { const t = (e.target as Element).closest?.('[data-ci]'); const v = t ? Number(t.getAttribute('data-ci')) : null; setCapHover((o) => (o === v ? o : v)) }}
                  onMouseLeave={() => setCapHover(null)}
                  onClick={(e) => { const t = (e.target as Element).closest?.('path.it-limb[data-level="cluster"]'); if (t) toggleFocus(Number(t.getAttribute('data-ci'))) }}
                >
                  <defs>
                    <linearGradient id="it-trunk-g" gradientUnits="userSpaceOnUse" x1="0" x2="0" y1={layout.axis.ground} y2={layout.axis.trunkTop}>
                      <stop offset="0" className="it-trunk-s0" />
                      <stop offset="1" className="it-trunk-s1" />
                    </linearGradient>
                    <radialGradient id="it-ground-g"><stop offset="0" className="it-ground-s0" /><stop offset="1" className="it-ground-s1" /></radialGradient>
                    <linearGradient id="it-hline-g" x1="0" x2="1" y1="0" y2="0"><stop offset="0" className="it-hline-s1" /><stop offset="0.5" className="it-hline-s0" /><stop offset="1" className="it-hline-s1" /></linearGradient>
                  </defs>
                  {/* 地面：帶柔光的地平線（沒有時間刻度：主枝在樹幹上的先後是出現的順序，時間沿著每條主枝往外走） */}
                  <ellipse className="it-ground" cx={layout.axis.cx} cy={layout.axis.ground + 2} rx={layout.width * 0.46} ry={14} fill="url(#it-ground-g)" />
                  <rect x={6} y={layout.axis.ground} width={layout.width - 12} height={1.4} fill="url(#it-hline-g)" />
                  <path className="it-trunk" d={layout.trunk.d} fill="url(#it-trunk-g)" />
                  {layout.limbs.map((l) => {
                    const ci = l.clusterIndex ?? 0
                    let color = col(ci, l.shade ?? 0)
                    if (l.level === 'cluster') { const k = Number(l.id.slice(l.id.lastIndexOf('#') + 1)); color = `color-mix(in srgb, ${col(ci)} ${40 + 20 * k}%, var(--it-trunk1))` }
                    return <Limb key={l.id} l={l} color={color} lit={lit.has(l.id)} dimc={focus !== null && ci !== focus} fresh={fresh.has(l.id)} />
                  })}
                  {layout.clumps.map((cl) => (
                    <g key={cl.id} className={`it-clump${focus !== null && cl.clusterIndex !== focus ? ' it-dimc' : ''}`} data-testid="insight-clump" data-ci={cl.clusterIndex} role="button" tabIndex={0}
                      aria-label={`${layout.clusters[cl.clusterIndex]?.name ?? ''} 另有 ${cl.count} 則，點一下聚焦這一群看全部`} style={{ color: col(cl.clusterIndex) }}
                      onClick={() => toggleFocus(cl.clusterIndex)} onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggleFocus(cl.clusterIndex) } }}>
                      <circle className="it-hit" cx={cl.x} cy={cl.y} r={cl.r * 1.25} />
                      {[[-0.55, -0.1, -55], [0.5, -0.2, 40], [-0.15, 0.45, -15], [0.3, 0.4, 70], [0, -0.55, 8]].slice(0, cl.count >= 5 ? 5 : cl.count >= 3 ? 4 : 3).map(([ox, oy, rot], q) => (
                        <path key={q} className="it-clump-leaf" d={leafShape('new').d} transform={`translate(${cl.x + ox! * cl.r},${cl.y + oy! * cl.r}) rotate(${rot}) scale(${cl.r * 0.5})`} />
                      ))}
                      <circle className="it-clump-b" cx={cl.x + cl.r * 0.75} cy={cl.y - cl.r * 0.65} r={cl.r * 0.62} />
                      <text className="it-clump-t" x={cl.x + cl.r * 0.75} y={cl.y - cl.r * 0.65 + 3.5} textAnchor="middle">{cl.count}</text>
                    </g>
                  ))}
                  {layout.leaves.map((lf) => (
                    <Leaf key={lf.id} lf={lf} ins={byId.get(lf.id)} color={col(lf.clusterIndex, lf.shade, lf.age)} lit={lit.has(lf.id) && hovered?.id === lf.id}
                      dimc={focus !== null && lf.clusterIndex !== focus} fresh={fresh.has(lf.id)} onOpen={open} onHover={onLeafHover} onKey={onLeafKey} />
                  ))}
                  {focusC && focusC.ticks.map((t, k) => (
                    <g key={`${t.label}${k}`} className="it-btick" data-testid="insight-btick" style={{ color: col(focus!) }}>
                      <line x1={t.px} y1={t.py} x2={t.x} y2={t.y - t.h / 2} />
                      <rect x={t.x - t.w / 2} y={t.y - t.h / 2} width={t.w} height={t.h} rx={t.h / 4} />
                      <text x={t.x} y={t.y + t.fs * 0.35} textAnchor="middle" fontSize={t.fs}>{t.label}</text>
                    </g>
                  ))}
                  {layout.clusters.map((c, ci) => c.count > 0 && (
                    <Cap key={c.id} c={c} ci={ci} scale={scale} color={col(ci)} open={c.labelShown || capHover === ci || focus === ci} dimc={focus !== null && ci !== focus} on={focus === ci}
                      onPick={() => toggleFocus(ci)} onEnter={() => setCapHover(ci)} />
                  ))}
                  {upto && <text className="it-bigmonth" x={16} y={36}>{upto}</text>}
                </svg>
                {rootsLeaf && rootsIns && <Roots ins={rootsIns} cx={(layout.axis.cx - view.x) * scale} top={(layout.axis.ground - view.y) * scale} width={layout.width} canIdea={!!onOpenIdea} onPick={onRootPick} />}
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
                  <li><span className="it-lg-age" aria-hidden />越舊越深沉</li>
                </ul>
              </div>
            </div>
            <aside className="it-side" aria-label="心得的領域清單">
              <p className="it-stats" data-testid="insight-stats">
                心得 {stats.total} 則・本月 +{stats.thisMonth}・脈絡 {stats.threads} 條{stats.topReinforced ? `・最常印證：〈${stats.topReinforced.text}〉` : ''}
              </p>
              {bands && bands.known > 0 && (
                <p className="it-born-bands" data-testid="insight-born-bands">
                  高分日子（≥{HIGH}）長出{' '}
                  <button type="button" className={`it-born-n${bornPick === 'high' ? ' it-born-on' : ''}`} aria-pressed={bornPick === 'high'} aria-label={`篩選高分日子長出的 ${bands.high.length} 則心得`}
                    onClick={() => setBornPick((v) => (v === 'high' ? null : 'high'))}>{bands.high.length}</button>
                  {' '}則・低分日子（&lt;{LOW}）{' '}
                  <button type="button" className={`it-born-n${bornPick === 'low' ? ' it-born-on' : ''}`} aria-pressed={bornPick === 'low'} aria-label={`篩選低分日子長出的 ${bands.low.length} 則心得`}
                    onClick={() => setBornPick((v) => (v === 'low' ? null : 'low'))}>{bands.low.length}</button>
                  {' '}則
                </p>
              )}
              {bornList.length > 0 && (
                <ul className="it-born-list" data-testid="insight-born-list" aria-label={bornPick === 'high' ? '高分日子長出的心得' : '低分日子長出的心得'}>
                  {bornList.map((it) => (
                    <li key={it.id}>
                      <button type="button" className="it-born-item" onClick={() => open(it.id)}>
                        <span className="it-born-item-d">{it.date}</span>
                        <span className="it-born-item-x">{it.text}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
              <ul className="it-rows" data-testid="insight-rows">
                <li>
                  <button type="button" className={`it-row it-row-all${focus === null ? ' it-row-on' : ''}`} data-testid="insight-all" aria-pressed={focus === null} onClick={() => setFocusId(null)}>
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
      {selected && <InsightPanel pw={pw} id={selected} fallback={byId.get(selected) ?? null} onClose={closePanel} onSelect={open} ideas={ideas ?? null} onOpenIdea={onOpenIdea ? (iid) => { closePanel(); onOpenIdea(iid) } : undefined} hhiScores={hhiScores} />}
    </section>
  )
}

// ─────────────────────────────────────────────
// 側邊面板
// ─────────────────────────────────────────────

type DetailState = { id: string; state: 'loading' | 'ok' | 'missing' | 'error'; data: InsightDetail | null }

const DAY_HEADINGS_SHOWN = 4

export function InsightPanel({ pw, id, fallback, onClose, onSelect, ideas = null, onOpenIdea, hhiScores = null }: {
  pw: string | null; id: string; fallback: Insight | null; onClose: () => void; onSelect: (id: string) => void
  ideas?: IdeaItem[] | null; onOpenIdea?: (id: string) => void; hhiScores?: Map<string, number> | null
}) {
  const [det, setDet] = useState<DetailState | null>(null)
  const [showDay, setShowDay] = useState(false)
  const [moreDay, setMoreDay] = useState(false)
  const closeRef = useRef<HTMLButtonElement>(null)
  useEffect(() => { closeRef.current?.focus() }, [])
  useEffect(() => {
    // 日報視窗開著時 Esc 只關視窗，不連心得面板一起關
    const f = (e: KeyboardEvent) => { if (e.key === 'Escape' && !showDay) onClose() }
    window.addEventListener('keydown', f)
    return () => window.removeEventListener('keydown', f)
  }, [onClose, showDay])
  const dateBtnRef = useRef<HTMLButtonElement>(null)
  const closeDay = useCallback(() => { setShowDay(false); setTimeout(() => dateBtnRef.current?.focus(), 0) }, [])
  useEffect(() => { setShowDay(false); setMoreDay(false) }, [id])
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
  const bornScore = date ? hhiScores?.get(date.slice(0, 10)) : undefined
  const born = bornScore === undefined ? null : bornBand(bornScore)
  const relation = d?.relation ?? fallback?.relation ?? null
  const provenance = d?.provenance ?? fallback?.provenance ?? null
  const items = d && d.threadItems.length > 0 ? d.threadItems : fallback ? [fallback] : []
  const links = d?.links ?? fallback?.links ?? null
  const people = [...(links?.people ?? [])].sort((a, b) => Number(b.sameSegment) - Number(a.sameSegment))
  const ideaLinks = links?.ideas ?? []
  const topics = links?.topics ?? []
  const noLinks = !!d && people.length === 0 && ideaLinks.length === 0 && topics.length === 0
  const headings = d?.day.headings ?? []
  const ideaById = new Map((ideas ?? []).map((i) => [i.id, i] as const))
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
            <button ref={dateBtnRef} type="button" className="it-date" data-testid="insight-date" aria-haspopup="dialog" onClick={() => setShowDay(true)}>
              {date}{d?.time ?? fallback?.time ? ` ${d?.time ?? fallback?.time}` : ''}・看那天日報
            </button>
          )}
          {relation && <span className={`it-rel it-rel-${relation}`}>{RELATION_LABEL[relation]}</span>}
          {bornScore !== undefined && (
            <span className={`it-born it-born-${born}`} data-testid="insight-born-score">
              那天幸福指數 {bornScore}{born === 'high' ? ' 高' : born === 'low' ? ' 低' : ''}
            </span>
          )}
          {provenance && <span className="it-prov">{PROVENANCE_LABEL[provenance]}</span>}
        </div>
        {(d || date) && <h4 className="it-lb">那一天</h4>}
        {headings.length > 0 && (
          <div data-testid="insight-day-headings">
            <p className="it-dim it-day-lead">那天的幾件事</p>
            <ul className="it-day-list">
              {(moreDay ? headings : headings.slice(0, DAY_HEADINGS_SHOWN)).map((h) => <li key={h}>{h}</li>)}
            </ul>
            {headings.length > DAY_HEADINGS_SHOWN && !moreDay && (
              <button type="button" className="it-more" data-testid="insight-day-more" onClick={() => setMoreDay(true)}>還有 {headings.length - DAY_HEADINGS_SHOWN} 件</button>
            )}
          </div>
        )}
        {people.length > 0 && (
          <div className="it-grp" data-testid="insight-people">
            <p className="it-dim it-day-lead">見了誰</p>
            <ul className="it-chips">
              {people.map((p) => (
                <li key={p.id}>
                  {p.dossier !== null
                    ? <a className="it-chip" href={dossierHref('person', p.dossier)} aria-label={`開啟人物卷宗：${p.name}`}>{p.name}{p.sameSegment && <span className="it-chip-tag">同一段</span>}</a>
                    : <span className="it-chip it-chip-off" title="還沒有人物卷宗" aria-label={`${p.name}（還沒有人物卷宗）`}>{p.name}{p.sameSegment && <span className="it-chip-tag">同一段</span>}</span>}
                </li>
              ))}
            </ul>
          </div>
        )}
        {ideaLinks.length > 0 && (
          <div className="it-grp" data-testid="insight-ideas">
            <p className="it-dim it-day-lead">在做的想法</p>
            <ul className="it-chips">
              {ideaLinks.map((it) => {
                const found = ideaById.get(it.id)
                const stage = found ? stageOf(found.status) : null
                const inner = (
                  <>
                    {stage && <i className="it-chip-dot" style={{ background: STAGE_COLOR[stage] }} aria-hidden />}
                    <span className="it-chip-x">{it.title}</span>
                    {found && stage && <span className="it-chip-tag">{STAGE_ICON[stage]} {STAGE_LABEL[stage]}{isFocus(found.status) ? ` ${FOCUS_ICON}` : ''}</span>}
                    {it.mentioned && <span className="it-chip-tag">有提到</span>}
                  </>
                )
                return (
                  <li key={it.id}>
                    {onOpenIdea
                      ? <button type="button" className="it-chip" aria-label={`在想法庫開啟：${it.title}`} onClick={() => onOpenIdea(it.id)}>{inner}</button>
                      : <span className="it-chip it-chip-off" aria-label={it.title}>{inner}</span>}
                  </li>
                )
              })}
            </ul>
          </div>
        )}
        {noLinks && <p className="it-dim it-nolinks" data-testid="insight-nolinks">這則還沒連上人、想法或知識</p>}
        <h4 className="it-lb">日記原文</h4>
        {!cur || cur.state === 'loading' ? <p className="it-dim">載入中…</p>
          : cur.state === 'error' ? <p className="it-dim" role="status">原文暫時讀不到，稍後再試。</p>
          : cur.state === 'missing' || !d ? <p className="it-dim">這一則沒有原文資料。</p>
          : <>
            <blockquote className="it-evidence" data-testid="insight-evidence">{d.evidence || '（沒有原文）'}</blockquote>
            {d.source && <div className="it-src">出處：{d.source}</div>}
          </>}
        <h4 className="it-lb">後來怎麼變</h4>
        {items.length <= 1 && <p className="it-dim" data-testid="insight-alone">還沒有後續的印證或修正</p>}
        <ol className="it-thread" data-testid="insight-thread" aria-label="後來怎麼變的時間線">
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
        {topics.length > 0 && (
          <>
            <h4 className="it-lb">相關知識</h4>
            <ul className="it-chips" data-testid="insight-topics">
              {topics.map((t) => (
                <li key={t.id}><a className="it-chip" href={`#knowledge/${encodeURIComponent(t.id)}`} aria-label={`開啟知識頁：${t.name}`}>{t.name}</a></li>
              ))}
            </ul>
          </>
        )}
        <div className="it-act"><PinButton pw={pw} target={pinTarget} /></div>
      </aside>
      {showDay && date && pw && createPortal(
        <DayReportDialog date={date} password={pw} onClose={closeDay} timelineHref={buildTimelineDayLink(date, `insight/${encodeURIComponent(id)}`)} />,
        document.body,
      )}
    </>
  )
}
