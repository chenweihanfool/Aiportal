import type * as React from 'react'
import { forwardRef, useCallback, useEffect, useImperativeHandle, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { apiFetchInsightDetail, apiFetchInsights } from './insightApi'
import {
  GLOW_DAYS, RELATION_LABEL, insightIdFromHash, insightStats, taipeiDay,
  type Insight, type InsightData, type InsightDetail, type InsightLinks, type InsightRelation,
} from './insightTree'
import {
  ISLAND, TIMELINE, centerScroll, fitCamera, islandCamera, layoutIslands, layoutTimeline, monthBins, zoomAt, zoomLevel,
  type Camera, type Island, type IslandWorld,
} from './insightIslands'
import { clusterSlots, paletteColor, type PaletteTheme } from './insightPalette'
import { useAsync } from './homeHooks'
import { blockState } from './homeView'
import { StateFrame } from './StateFrame'
import { InsightPanel } from './InsightTree'
import { dossierHref } from './dossier'
import type { IdeaItem } from './boardApi'
import { HIGH, LOW, insightsByBand } from './hhiBorn'
import { weaveIndex } from './insightWeave'
import { IslandDrawer, WeaveColumn, WeaveProvider, WeaveToggle, paintWeave, useWeaveData, type IslandGeom, type WeaveCtx } from './InsightWeave'

// 首頁「我的心得」（3.15.0）：島嶼全景（每個主題一座島，語意縮放）→ 點島飛入 → 橫向時間軸（左舊右新，選到的置中、正下方顯示內容）。
// 手機（元件寬 < 760）逐層點進。排版與鏡頭是純函式（insightIslands.ts，有測試），這裡只畫畫面。樣式 ii- 前綴在 portal.css。

const FLY_MS = 520
const KMAX = 3.4
const MINI_W = 150
const MINI_H = 104
const MOBILE_W = 760
const reducedMotion = (): boolean => typeof window !== 'undefined' && !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
const dayN = (d: string): number => Date.UTC(+d.slice(0, 4), +d.slice(5, 7) - 1, +d.slice(8, 10)) / 86_400_000
const md = (d: string): string => `${d.slice(5, 7)}/${d.slice(8, 10)}`
const ym = (d: string): string => `${d.slice(0, 4)}/${d.slice(5, 7)}`
const WEEK = ['日', '一', '二', '三', '四', '五', '六']
const weekday = (d: string): string => WEEK[new Date(Date.UTC(+d.slice(0, 4), +d.slice(5, 7) - 1, +d.slice(8, 10))).getUTCDay()] ?? ''
const byDateId = (a: Insight, b: Insight): number => (a.date < b.date ? -1 : a.date > b.date ? 1 : a.id < b.id ? -1 : a.id > b.id ? 1 : 0)
const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v))
const LEVEL_TEXT = { overview: '全景：看主題', short: '主題：心得短句', full: '心得：可讀全文', read: '細讀' } as const

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

function writeHash(id: string | null): void {
  try {
    if (id) window.history.replaceState(null, '', `${window.location.pathname}${window.location.search}#insight/${encodeURIComponent(id)}`)
    else if (insightIdFromHash(window.location.hash)) window.history.replaceState(null, '', window.location.pathname + window.location.search)
  } catch { /* 取不到 history 就維持原網址 */ }
}

// ─────────────────────────────────────────────
// 單則詳情（桌面時間軸下方與手機單則共用）
// ─────────────────────────────────────────────

type DetailState = { id: string; state: 'loading' | 'ok' | 'missing' | 'error'; data: InsightDetail | null }

const DETAIL_CACHE = new Map<string, InsightDetail>()

function useInsightDetail(pw: string | null, id: string) {
  const cache = { current: DETAIL_CACHE }
  const [st, setSt] = useState<DetailState | null>(null)
  const [n, setN] = useState(0)
  useEffect(() => {
    if (!pw) { setSt(null); return }
    const hit = cache.current.get(`${pw}:${id}`)
    if (hit) { setSt({ id, state: 'ok', data: hit }); return }
    const ctl = new AbortController()
    setSt({ id, state: 'loading', data: null })
    apiFetchInsightDetail(pw, id, ctl.signal)
      .then((d) => { if (ctl.signal.aborted) return; if (d) cache.current.set(`${pw}:${id}`, d); setSt({ id, state: d ? 'ok' : 'missing', data: d }) })
      .catch(() => { if (!ctl.signal.aborted) setSt({ id, state: 'error', data: null }) })
    return () => ctl.abort()
  }, [pw, id, n])
  return { cur: st && st.id === id ? st : null, retry: () => setN((x) => x + 1) }
}

function Rel({ r }: { r: InsightRelation }) {
  return <span className={`it-rel it-rel-${r}`}>{RELATION_LABEL[r]}</span>
}

function DetailBody({ ins, pw, siblings, onSelect, ideas, onOpenIdea, onDossier, nav }: {
  ins: Insight; pw: string | null; siblings: readonly Insight[]; onSelect: (id: string) => void
  ideas: IdeaItem[] | null; onOpenIdea?: (id: string) => void; onDossier: (id: string) => void; nav?: React.ReactNode
}) {
  const { cur, retry } = useInsightDetail(pw, ins.id)
  const d = cur?.state === 'ok' ? cur.data : null
  const chain = useMemo(() => {
    const list = d && d.threadItems.length > 0 ? d.threadItems : siblings.filter((s) => s.thread === ins.thread)
    return [...list].sort(byDateId)
  }, [d, siblings, ins.thread])
  const known = useMemo(() => new Set(siblings.map((s) => s.id)), [siblings])
  const links: InsightLinks = d?.links ?? ins.links
  const people = [...links.people].sort((a, b) => Number(b.sameSegment) - Number(a.sameSegment))
  const ideaTitle = (id: string, fallback: string): string => ideas?.find((i) => i.id === id)?.title ?? fallback
  const text = d?.text ?? ins.text
  return (
    <div className="ii-detail-in">
      {nav}
      <h3 className="ii-d-text" data-testid="ii-detail-text">{text}</h3>
      <div className="ii-d-meta">
        <span>{ins.date}（{weekday(ins.date)}）{d?.time ?? ins.time ?? ''}</span>
        {d?.source && <span className="ii-d-src">{d.source.replace(/^日記\//, '')}</span>}
        <Rel r={d?.relation ?? ins.relation} />
      </div>
      <div className="ii-d-cols">
        <div>
          <h4 className="ii-lb">日記原文</h4>
          {!cur || cur.state === 'loading' ? <div className="ii-skel-lines" aria-hidden><i /><i /><i /></div>
            : cur.state === 'error' ? <p className="ii-dim" role="status">原文暫時讀不到。 <button type="button" className="ii-link" data-testid="ii-detail-retry" onClick={retry}>重試</button></p>
            : !d ? <p className="ii-dim">這一則沒有原文資料。</p>
            : <blockquote className="ii-evidence" data-testid="ii-detail-evidence">{d.evidence || '（沒有原文）'}</blockquote>}
        </div>
        <div>
          <h4 className="ii-lb">這條想法的演變</h4>
          {chain.length <= 1
            ? <p className="ii-dim" data-testid="ii-detail-alone">這則還沒有後續的印證、修正或推翻。之後的日記若再碰到同一件事，會接在它後面。</p>
            : (
              <ol className="ii-steps" data-testid="ii-detail-thread" aria-label="這條想法的演變">
                {chain.map((t) => (
                  <li key={t.id} className={t.id === ins.id ? 'ii-cur' : undefined} aria-current={t.id === ins.id ? 'true' : undefined}>
                    <button type="button" disabled={!known.has(t.id) || t.id === ins.id} onClick={() => onSelect(t.id)}>
                      <span className="ii-st-d">{t.date}</span><Rel r={t.relation} /><span className="ii-st-x">{t.text}</span>
                    </button>
                  </li>
                ))}
              </ol>
            )}
        </div>
      </div>
      {(people.length > 0 || links.ideas.length > 0) && (
        <ul className="ii-chips" data-testid="ii-detail-links" aria-label="關聯的人與想法">
          {people.map((p) => (
            <li key={`p${p.id}`}>
              {p.dossier !== null
                ? <a className="ii-chip" href={dossierHref('person', p.dossier)} aria-label={`開啟人物卷宗：${p.name}`}>{p.name}</a>
                : <span className="ii-chip ii-chip-off" aria-label={`${p.name}（還沒有人物卷宗）`}>{p.name}</span>}
            </li>
          ))}
          {links.ideas.map((it) => (
            <li key={`i${it.id}`}>
              {onOpenIdea
                ? <button type="button" className="ii-chip" aria-label={`在想法庫開啟：${it.title}`} onClick={() => onOpenIdea(it.id)}>💡{ideaTitle(it.id, it.title)}</button>
                : <span className="ii-chip ii-chip-off">💡{it.title}</span>}
            </li>
          ))}
        </ul>
      )}
      <div className="ii-d-act">
        <button type="button" className="ii-btn" data-testid="ii-dossier" onClick={() => onDossier(ins.id)}>全文與脈絡</button>
      </div>
      <WeaveColumn ins={ins} />
    </div>
  )
}

// ─────────────────────────────────────────────
// 島嶼全景
// ─────────────────────────────────────────────

const EMPTY_INDEX = weaveIndex({ generatedAt: '', lighthouses: [], insufficient: [], bridges: [], tensions: [], kbLinks: [] }, [])

interface PanoApi {
  flyOverview: () => void
  flyIsland: (id: string, instant: boolean, done?: () => void, minK?: number) => void
  screenOf: (id: string) => [number, number] | null
}
interface PanoProps {
  world: IslandWorld; byId: ReadonlyMap<string, Insight>; colorOf: (cid: string) => string; nameOf: (cid: string) => string
  todayN: number; startIsland: string | null; onEnter: (cid: string, id: string | null) => void
  /** 3.17.0：AI 編織層（沒有 feed 資料時是 null）；hoverOff＝時間軸開著，不畫滑過的編織 */
  weave: WeaveCtx | null; hoverOff: boolean
}

const Panorama = forwardRef<PanoApi, PanoProps>(function Panorama({ world, byId, colorOf, nameOf, todayN, startIsland, onEnter, weave, hoverOff }, apiRef) {
  const boxRef = useRef<HTMLDivElement>(null)
  const islRefs = useRef<(HTMLDivElement | null)[]>([])
  const labRefs = useRef<(HTMLButtonElement | null)[]>([])
  const cardRefs = useRef<(HTMLButtonElement | null)[]>([])
  const dotRefs = useRef<(HTMLElement | null)[]>([])
  const parRefs = useRef<(HTMLDivElement | null)[]>([])
  const lineRef = useRef<SVGSVGElement>(null)
  const vpRef = useRef<SVGRectElement>(null)
  const lvRef = useRef<HTMLDivElement>(null)
  const cam = useRef<Camera>({ x: 0, y: 0, k: 1 })
  const raf = useRef(0)
  const touched = useRef(false)
  const flying = useRef(false)
  // 3.17.0：滑過哪座島（只用 ref，不 re-render 整個全景）與編織圖層
  const hoverRef = useRef<string | null>(null)
  const weaveRef = useRef<WeaveCtx | null>(weave)
  weaveRef.current = weave
  const wvSvg = useRef<SVGSVGElement>(null)
  const wvLayer = useRef<HTMLDivElement>(null)
  // 3.16.0：一般滾輪只捲頁面，正中顯示一下提示；Ctrl／⌘＋滾輪才縮放
  const [wheelHint, setWheelHint] = useState(false)
  const hintTimer = useRef(0)
  const { bounds } = world

  const cards = useMemo(() => world.islands.flatMap((is, ii) => is.cells.flatMap((cell) => { const ins = byId.get(cell.id); return ins ? [{ ii, cell, ins }] : [] })), [world, byId])
  const cardIndex = useMemo(() => new Map(cards.map((c, i) => [c.cell.id, i])), [cards])
  const mini = useMemo(() => {
    const ms = Math.min(MINI_W / Math.max(1, bounds.w), MINI_H / Math.max(1, bounds.h)) * 0.86
    return { ms, ox: (MINI_W - bounds.w * ms) / 2 - bounds.x * ms, oy: (MINI_H - bounds.h * ms) / 2 - bounds.y * ms }
  }, [bounds])

  const size = (): { W: number; H: number } => ({ W: boxRef.current?.clientWidth ?? 0, H: boxRef.current?.clientHeight ?? 0 })
  const overviewCam = (): Camera => { const { W, H } = size(); const c = fitCamera(bounds, W, H, 0.9); return { x: c.x, y: c.y, k: Math.min(c.k, 1.6) } }
  const kMin = (): number => { const { W, H } = size(); return Math.min(fitCamera(bounds, W, H, 0.9).k * 0.7, 1.6 * 0.7) }
  const islandCam = (is: Island): Camera => { const { W, H } = size(); return islandCamera(is, W, H, kMin(), KMAX) }

  const draw = useCallback(() => {
    const box = boxRef.current
    if (!box) return
    const W = box.clientWidth
    const H = box.clientHeight
    const c = cam.current
    const k = c.k
    const sx = (x: number): number => (x - c.x) * k + W / 2
    const sy = (y: number): number => (y - c.y) * k + H / 2
    parRefs.current.forEach((p, i) => {
      if (!p) return
      const f = [0.12, 0.28, 0.5][i]!
      const sz = [46, 130, 900][i]!
      const s = Math.pow(k, [0.15, 0.3, 0.45][i]!)
      p.style.transform = `translate(${(-((c.x * k * f) % sz)).toFixed(1)}px,${(-((c.y * k * f) % sz)).toFixed(1)}px) scale(${s.toFixed(3)})`
    })
    const ch = (ISLAND.cellH - ISLAND.gap) * k
    const cw = (ISLAND.cellW - ISLAND.gap) * k
    const asDot = ch < 24
    const focusOn = k >= 0.95
    const ops: number[] = []
    const wv = weaveRef.current
    const hv = wv && hoverRef.current ? hoverRef.current : null
    const relSet = wv && hv ? wv.index.related(hv) : null
    const geom = new Map<string, IslandGeom>()
    world.islands.forEach((is, i) => {
      const L = sx(is.x), T = sy(is.y), Wd = is.w * k, Hd = is.h * k
      const dx = Math.max(L - W / 2, 0, W / 2 - (L + Wd))
      const dy = Math.max(T - H / 2, 0, H / 2 - (T + Hd))
      const op0 = focusOn ? Math.max(0.22, 1 - Math.hypot(dx, dy) / (Math.min(W, H) * 0.55)) : 1
      const op = relSet && !relSet.has(is.id) ? Math.min(op0, 0.35) : op0
      ops[i] = op
      const el = islRefs.current[i]
      if (el) { const s = el.style; s.left = `${L}px`; s.top = `${T}px`; s.width = `${Wd}px`; s.height = `${Hd}px`; s.opacity = String(op); s.borderRadius = `${Math.max(10, 28 * Math.min(1, k))}px` }
      const lab = labRefs.current[i]
      if (lab) {
        const s = lab.style
        const availH = ISLAND.label * k
        s.left = `${L + Wd / 2}px`; s.top = `${T - 4}px`; s.opacity = String(Math.max(0.35, op))
        s.fontSize = `${clamp(0.42 * availH, 11, 19)}px`; s.maxWidth = `${Math.max(40, (is.w + ISLAND.margin) * k)}px`
        const sub = lab.lastElementChild as HTMLElement | null
        if (sub) sub.style.display = availH < 48 ? 'none' : 'block'
        if (relSet) {
          const lw = lab.offsetWidth, lh = lab.offsetHeight
          geom.set(is.id, { cx: L + Wd / 2, cy: T + Hd / 2, L, T, R: L + Wd, B: T + Hd, lab: { x: L + Wd / 2 - lw / 2, y: T - 4 - lh, w: lw, h: lh } })
        }
      }
    })
    let lines = ''
    cards.forEach((cd, i) => {
      const L = sx(cd.cell.x), T = sy(cd.cell.y)
      const vis = L < W + 40 && L + cw > -40 && T < H + 40 && T + ch > -40
      const op = ops[cd.ii] ?? 1
      const el = cardRefs.current[i]
      const dot = dotRefs.current[i]
      if (!el || !dot) return
      if (asDot) {
        el.style.display = 'none'
        if (vis) { const r = Math.max(4, Math.min(10, ch * 0.55)); const s = dot.style; s.display = 'block'; s.left = `${L + cw / 2}px`; s.top = `${T + ch / 2}px`; s.width = `${r}px`; s.height = `${r}px`; s.opacity = String(op * (cd.cell.depth ? 0.6 : 1)) }
        else dot.style.display = 'none'
      } else {
        dot.style.display = 'none'
        if (!vis) el.style.display = 'none'
        else {
          const showD = ch >= 46
          const nl = Math.max(1, Math.floor((ch - 8 - (showD ? 16 : 0)) / 18))
          const s = el.style
          s.display = 'block'; s.left = `${L}px`; s.top = `${T}px`; s.width = `${cw}px`; s.height = `${ch}px`; s.opacity = String(op)
          const zd = el.firstElementChild as HTMLElement | null
          const zt = el.lastElementChild as HTMLElement | null
          if (zd) zd.style.display = showD ? 'flex' : 'none'
          if (zt) zt.style.webkitLineClamp = String(nl)
        }
      }
      const pj = cd.ins.parent === null ? undefined : cardIndex.get(cd.ins.parent)
      if (pj !== undefined && k >= 0.5) {
        const p = cards[pj]!
        const x1 = sx(p.cell.x) + cw / 2, y1 = sy(p.cell.y) + ch / 2, x2 = L + cw / 2, y2 = T + ch / 2
        lines += `<path class="ii-ln ii-ln-${cd.ins.relation}" d="M${x1},${y1} C${x1},${(y1 + y2) / 2} ${x2},${(y1 + y2) / 2} ${x2},${y2}" stroke-width="${Math.max(1.5, k)}" stroke-dasharray="${4 * k} ${3 * k}" opacity="${0.8 * op}"/>`
      }
    })
    if (lineRef.current) lineRef.current.innerHTML = lines
    if (wvLayer.current && wvSvg.current) paintWeave({ layer: wvLayer.current, svg: wvSvg.current, hover: relSet ? hv : null, ctx: wv ?? { index: EMPTY_INDEX, verdicts: new Map() }, geom })
    if (vpRef.current) {
      const v = vpRef.current
      v.setAttribute('x', String((c.x - W / 2 / k) * mini.ms + mini.ox)); v.setAttribute('y', String((c.y - H / 2 / k) * mini.ms + mini.oy))
      v.setAttribute('width', String((W / k) * mini.ms)); v.setAttribute('height', String((H / k) * mini.ms))
    }
    if (lvRef.current) { const lv = zoomLevel(k); lvRef.current.textContent = `${LEVEL_TEXT[lv]} · ${Math.round(k * 100)}%`; lvRef.current.dataset.level = lv }
  }, [world, cards, cardIndex, mini])

  const fly = useCallback((t: Camera, ms = FLY_MS, done?: () => void, instant = false) => {
    cancelAnimationFrame(raf.current)
    if (instant || reducedMotion()) { cam.current = t; flying.current = false; draw(); done?.(); return }
    const s = { ...cam.current }
    const t0 = performance.now()
    flying.current = true
    const step = (now: number) => {
      let p = Math.min(1, (now - t0) / ms)
      p = p < 0.5 ? 4 * p * p * p : 1 - Math.pow(-2 * p + 2, 3) / 2
      const lk = Math.log(s.k) + (Math.log(t.k) - Math.log(s.k)) * p
      const hop = Math.sin(Math.PI * p) * Math.min(0.45, (Math.hypot(t.x - s.x, t.y - s.y) * Math.min(s.k, t.k)) / 2400)
      cam.current = { x: s.x + (t.x - s.x) * p, y: s.y + (t.y - s.y) * p, k: Math.exp(lk) * (1 - hop) }
      draw()
      if (p < 1) raf.current = requestAnimationFrame(step)
      else { flying.current = false; cam.current = t; draw(); done?.() }
    }
    raf.current = requestAnimationFrame(step)
  }, [draw])

  useImperativeHandle(apiRef, () => ({
    flyOverview: () => fly(overviewCam(), 560),
    flyIsland: (id, instant, done, minK = 0) => {
      const is = world.islands.find((x) => x.id === id)
      if (!is) { done?.(); return }
      const t = islandCam(is)
      t.k = Math.max(t.k, minK)
      fly(t, FLY_MS, done, instant)
    },
    screenOf: (id) => {
      const is = world.islands.find((x) => x.id === id)
      const { W, H } = size()
      if (!is) return null
      return [(is.x + is.w / 2 - cam.current.x) * cam.current.k + W / 2, (is.y + is.h / 2 - cam.current.y) * cam.current.k + H / 2]
    },
  }))

  // 初始鏡頭與尺寸變化
  useLayoutEffect(() => {
    const is = startIsland ? world.islands.find((x) => x.id === startIsland) : undefined
    cam.current = is ? islandCam(is) : overviewCam()
    draw()
    const box = boxRef.current
    if (!box || typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver(() => { if (!touched.current && !flying.current && !startIsland) cam.current = overviewCam(); draw() })
    ro.observe(box)
    return () => ro.disconnect()
  }, [world]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { draw() }, [draw])
  useEffect(() => { draw() }, [weave]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (hoverOff && hoverRef.current) { hoverRef.current = null; draw() } }, [hoverOff]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => () => cancelAnimationFrame(raf.current), [])

  // 滾輪（需要 non-passive 才能擋掉頁面捲動）：一般滾輪不攔截，讓頁面正常捲動，只顯示提示；
  // Ctrl／⌘＋滾輪才縮放（觸控板雙指縮放瀏覽器會送 ctrlKey）
  useEffect(() => {
    const box = boxRef.current
    if (!box) return
    const f = (e: WheelEvent) => {
      if ((e.target as Element).closest?.('.ii-tools,.ii-mini,.ii-tlp')) return
      if (!e.ctrlKey && !e.metaKey) {
        setWheelHint(true)
        window.clearTimeout(hintTimer.current)
        hintTimer.current = window.setTimeout(() => setWheelHint(false), 1200)
        return
      }
      e.preventDefault()
      touched.current = true
      cancelAnimationFrame(raf.current); flying.current = false
      const r = box.getBoundingClientRect()
      const { W, H } = size()
      cam.current = zoomAt(cam.current, e.clientX - r.left, e.clientY - r.top, Math.exp(-e.deltaY * 0.01), W, H, kMin(), KMAX)
      draw()
    }
    box.addEventListener('wheel', f, { passive: false })
    return () => box.removeEventListener('wheel', f)
  }, [draw]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => () => window.clearTimeout(hintTimer.current), [])

  // 拖曳平移、雙指縮放
  const pts = useRef(new Map<number, [number, number]>())
  const moved = useRef(0)
  const pinch = useRef<{ d: number; m: [number, number] } | null>(null)
  const local = (e: React.PointerEvent): [number, number] => { const r = boxRef.current!.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top] }
  // 3.17.0：只有滑鼠（沒按鍵）滑過島本體、島名或該島的卡片才算；觸控與拖曳中不觸發
  const hoverAt = (e: React.PointerEvent) => {
    if (!weaveRef.current) return
    let k: string | null = null
    if (e.pointerType === 'mouse' && e.buttons === 0 && !hoverOff) {
      const t = e.target as Element
      if (!t.closest('.ii-tools,.ii-mini,.ii-tlp')) {
        const lab = t.closest('.ii-ilab')
        const zc = t.closest('.ii-zc')
        const isl = t.closest('.ii-isl')
        k = lab ? lab.getAttribute('data-id') : zc ? byId.get(zc.getAttribute('data-id') ?? '')?.cluster ?? null : isl ? isl.getAttribute('data-id') : null
      }
    }
    if (k !== hoverRef.current) { hoverRef.current = k; draw() }
  }
  const onDown = (e: React.PointerEvent) => {
    if (hoverRef.current) { hoverRef.current = null; draw() }
    if ((e.target as Element).closest('.ii-tools,.ii-mini,.ii-tlp')) return
    touched.current = true
    cancelAnimationFrame(raf.current); flying.current = false
    pts.current.set(e.pointerId, local(e)); moved.current = 0
    if (pts.current.size === 2) {
      const [a, b] = [...pts.current.values()] as [[number, number], [number, number]]
      pinch.current = { d: Math.hypot(a[0] - b[0], a[1] - b[1]), m: [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2] }
      moved.current += 99
      try { boxRef.current?.setPointerCapture(e.pointerId) } catch { /* 略過 */ }
    }
  }
  const onMove = (e: React.PointerEvent) => {
    hoverAt(e)
    if (!pts.current.has(e.pointerId)) return
    const p = local(e)
    const prev = pts.current.get(e.pointerId)!
    pts.current.set(e.pointerId, p)
    const { W, H } = size()
    if (pts.current.size === 2 && pinch.current) {
      const [a, b] = [...pts.current.values()] as [[number, number], [number, number]]
      const d = Math.hypot(a[0] - b[0], a[1] - b[1])
      const m: [number, number] = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2]
      const c = cam.current
      cam.current = zoomAt({ ...c, x: c.x - (m[0] - pinch.current.m[0]) / c.k, y: c.y - (m[1] - pinch.current.m[1]) / c.k }, m[0], m[1], d / pinch.current.d, W, H, kMin(), KMAX)
      pinch.current = { d, m }
      draw()
      return
    }
    const dx = p[0] - prev[0], dy = p[1] - prev[1]
    moved.current += Math.abs(dx) + Math.abs(dy)
    if (moved.current < 6) return
    if (!boxRef.current?.hasPointerCapture(e.pointerId)) { try { boxRef.current?.setPointerCapture(e.pointerId) } catch { /* 略過 */ } boxRef.current?.classList.add('ii-drag') }
    cam.current = { ...cam.current, x: cam.current.x - dx / cam.current.k, y: cam.current.y - dy / cam.current.k }
    draw()
  }
  const onUp = (e: React.PointerEvent) => {
    if (!pts.current.has(e.pointerId)) return
    pts.current.delete(e.pointerId)
    if (pts.current.size < 2) pinch.current = null
    if (pts.current.size === 0) boxRef.current?.classList.remove('ii-drag')
  }
  const onDbl = (e: React.MouseEvent) => {
    if ((e.target as Element).closest('button,.ii-isl,.ii-tools,.ii-mini,.ii-tlp')) return
    const r = boxRef.current!.getBoundingClientRect()
    const { W, H } = size()
    const c = cam.current
    const f = 2
    const k = clamp(c.k * f, kMin(), KMAX)
    fly({ x: c.x + ((e.clientX - r.left - W / 2) / c.k) * (1 - c.k / k), y: c.y + ((e.clientY - r.top - H / 2) / c.k) * (1 - c.k / k), k }, 400)
  }
  const zoomBy = (f: number) => { touched.current = true; fly({ ...cam.current, k: clamp(cam.current.k * f, kMin(), KMAX) }, 300) }
  const latest = world.islands[0]
  
  return (
    <div className="ii-box" ref={boxRef} data-testid="ii-box" onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={onUp}
      onPointerLeave={() => { if (hoverRef.current) { hoverRef.current = null; draw() } }} onDoubleClick={onDbl}>
      {[0, 1, 2].map((i) => <div key={i} className={`ii-par ii-p${3 - i}`} ref={(el) => { parRefs.current[i] = el }} aria-hidden />)}
      <div className="ii-layer">
        {world.islands.map((is, i) => (
          <div key={is.id} ref={(el) => { islRefs.current[i] = el }} className={`ii-isl${is.fresh > 0 ? ' ii-fresh' : ''}`} data-testid="ii-island" data-id={is.id} data-count={is.cells.length}
            style={{ ['--c' as string]: colorOf(is.id) }} onClick={() => onEnter(is.id, null)} />
        ))}
        <svg className="ii-lines" ref={lineRef} aria-hidden />
        {cards.map((cd, i) => (
          <i key={`d${cd.cell.id}`} ref={(el) => { dotRefs.current[i] = el }} className={`ii-dot${todayN - dayN(cd.ins.date) <= GLOW_DAYS ? ' ii-dot-fresh' : ''}`} style={{ ['--c' as string]: colorOf(cd.ins.cluster) }} aria-hidden />
        ))}
        {cards.map((cd, i) => (
          <button key={`c${cd.cell.id}`} type="button" ref={(el) => { cardRefs.current[i] = el }} className={`ii-zc${cd.cell.depth ? ' ii-child' : ''}`} data-testid="ii-card" data-id={cd.cell.id}
            aria-label={`${cd.ins.date} ${cd.ins.text}`} style={{ ['--c' as string]: colorOf(cd.ins.cluster) }} onClick={() => onEnter(cd.ins.cluster, cd.cell.id)}>
            <span className="ii-zd">{md(cd.ins.date)}{cd.ins.relation !== 'new' && <Rel r={cd.ins.relation} />}{todayN - dayN(cd.ins.date) <= GLOW_DAYS && <span className="ii-fresh-dot">●</span>}</span>
            <span className="ii-zt">{cd.ins.text}</span>
          </button>
        ))}
        {world.islands.map((is, i) => (
          <button key={`l${is.id}`} type="button" ref={(el) => { labRefs.current[i] = el }} className="ii-ilab" data-testid="ii-island-label" data-id={is.id}
            title={nameOf(is.id)} aria-label={`${nameOf(is.id)}，${is.cells.length} 則，點一下飛進去看時間軸`} style={{ ['--c' as string]: colorOf(is.id) }} onClick={() => onEnter(is.id, null)}>
            <span className="ii-ln-name">{nameOf(is.id)}</span>
            <span className="ii-ln-sub">{is.cells.length} 則 · {md(is.last)}{is.fresh > 0 && <span className="ii-ln-new"> · 近 30 天 +{is.fresh}</span>}</span>
          </button>
        ))}
        {weave && <svg className="ii-wv-svg" ref={wvSvg} aria-hidden />}
        {weave && <div className="ii-wv-l" ref={wvLayer} aria-hidden />}
      </div>
      <div className="ii-hint">Ctrl＋滾輪：縮放 · 拖曳：移動 · 點島：飛進去 · 雙擊：放大</div>
      <div className={`ii-wheel-hint${wheelHint ? ' ii-on' : ''}`} data-testid="ii-wheel-hint" aria-hidden>按住 Ctrl 再滾動來縮放</div>
      <div className="ii-tools">
        <button type="button" data-testid="ii-zoom-in" aria-label="放大" onClick={() => zoomBy(1.6)}>＋</button>
        <button type="button" data-testid="ii-zoom-out" aria-label="縮小" onClick={() => zoomBy(1 / 1.6)}>－</button>
        <button type="button" className="ii-txt" data-testid="ii-overview" aria-label="回到全景" onClick={() => { touched.current = true; fly(overviewCam(), 560) }}>全景</button>
        <button type="button" className="ii-txt" data-testid="ii-latest" aria-label="飛到最新的島" onClick={() => { touched.current = true; if (latest) fly(islandCam(latest), 600) }}>最新</button>
      </div>
      <div className="ii-mini" data-testid="ii-minimap" role="button" tabIndex={0} aria-label="小地圖：點一下跳過去" title="小地圖：點一下跳過去"
        onClick={(e) => { const r = e.currentTarget.getBoundingClientRect(); touched.current = true; fly({ x: (e.clientX - r.left - mini.ox) / mini.ms, y: (e.clientY - r.top - mini.oy) / mini.ms, k: Math.max(cam.current.k, 1.2) }, 450) }}>
        <svg width={MINI_W} height={MINI_H} aria-hidden>
          {world.islands.map((is) => <rect key={is.id} x={is.x * mini.ms + mini.ox} y={is.y * mini.ms + mini.oy} width={is.w * mini.ms} height={is.h * mini.ms} rx={3} style={{ fill: colorOf(is.id) }} opacity={0.55} />)}
          <rect ref={vpRef} className="ii-mini-vp" fill="none" rx={2} />
        </svg>
      </div>
      <div className="ii-level" data-testid="ii-level" ref={lvRef} aria-live="off" />
    </div>
  )
})

// ─────────────────────────────────────────────
// 時間軸面板
// ─────────────────────────────────────────────

function isTypingTarget(t: EventTarget | null): boolean {
  const el = t as HTMLElement | null
  if (!el || !el.tagName) return false
  return el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || el.isContentEditable
}

function TimelinePanel({ cid, name, color, items, sel, on, origin, fresh, prev, next, colorOf, pw, ideas, onOpenIdea, dossierOpen, drawerOpen, onDrawer, onSelect, onClose, onIsland, onDossier }: {
  cid: string; name: string; color: string; items: Insight[]; sel: string; on: boolean; origin: [number, number] | null; fresh: number
  prev: { id: string; name: string }; next: { id: string; name: string }; colorOf: (cid: string) => string
  pw: string | null; ideas: IdeaItem[] | null; onOpenIdea?: (id: string) => void; dossierOpen: boolean
  drawerOpen: boolean; onDrawer: (open: boolean) => void
  onSelect: (id: string) => void; onClose: () => void; onIsland: (cid: string) => void; onDossier: (id: string) => void
}) {
  const panelRef = useRef<HTMLDivElement>(null)
  const headRef = useRef<HTMLDivElement>(null)
  const scrollRef = useRef<HTMLDivElement>(null)
  const [viewW, setViewW] = useState(0)
  const [shown, setShown] = useState<boolean>(() => reducedMotion())
  useEffect(() => {
    if (shown) return
    let a = 0, b = 0
    a = requestAnimationFrame(() => { b = requestAnimationFrame(() => setShown(true)) })
    return () => { cancelAnimationFrame(a); cancelAnimationFrame(b) }
  }, [shown])
  useLayoutEffect(() => {
    const el = scrollRef.current
    if (!el) return
    const f = () => setViewW(Math.floor(el.clientWidth))
    f()
    if (typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver(f)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])
  const lay = useMemo(() => layoutTimeline(items, Math.max(viewW, 1)), [items, viewW])
  const idx = Math.max(0, items.findIndex((i) => i.id === sel))
  const cur = items[idx]!
  const lastCid = useRef(cid)
  const center = useCallback((instant: boolean) => {
    const el = scrollRef.current
    const x = lay.xs[idx]
    if (!el || x === undefined || el.clientWidth === 0) return
    el.scrollTo({ left: centerScroll(x, el.clientWidth), behavior: instant ? 'auto' : 'smooth' })
  }, [lay, idx])
  useLayoutEffect(() => {
    const instant = reducedMotion() || lastCid.current !== cid || !shown
    lastCid.current = cid
    center(instant)
  }, [center, cid]) // eslint-disable-line react-hooks/exhaustive-deps
  // 面板展開動畫結束再置中一次（動畫中量到的寬度可能是縮小的）
  const onTransEnd = (e: React.TransitionEvent) => { if (e.target === panelRef.current && e.propertyName === 'transform') center(true) }
  // 3.16.0：一般直向滾輪不攔截（讓頁面捲動）；Shift＋滾輪或觸控板橫滑才橫移時間軸
  const wheel = useCallback((e: WheelEvent) => {
    const el = scrollRef.current
    if (!el) return
    if (!e.shiftKey && Math.abs(e.deltaX) <= Math.abs(e.deltaY)) return
    e.preventDefault(); e.stopPropagation()
    el.scrollLeft += Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY
  }, [])
  useEffect(() => {
    const el = scrollRef.current
    if (!el) return
    el.addEventListener('wheel', wheel, { passive: false })
    return () => el.removeEventListener('wheel', wheel)
  }, [wheel])
  // 3.16.0：拖曳橫移——水平移動超過 5px 才開始拖；沒超過就照常當點擊（卡片仍能選取）
  const drag = useRef<{ id: number; x: number; left: number; active: boolean } | null>(null)
  const onPtrDown = (e: React.PointerEvent<HTMLDivElement>) => {
    const el = scrollRef.current
    if (!el || e.button !== 0 || !e.isPrimary) return
    drag.current = { id: e.pointerId, x: e.clientX, left: el.scrollLeft, active: false }
  }
  const onPtrMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const d = drag.current
    const el = scrollRef.current
    if (!d || !el || d.id !== e.pointerId) return
    const dx = e.clientX - d.x
    if (!d.active) {
      if (Math.abs(dx) < 5) return
      d.active = true
      try { e.currentTarget.setPointerCapture(e.pointerId) } catch { /* 略過 */ }
      e.currentTarget.classList.add('ii-tls-drag')
    }
    el.scrollLeft = d.left - dx
  }
  const onPtrEnd = (e: React.PointerEvent<HTMLDivElement>) => {
    const d = drag.current
    if (!d || d.id !== e.pointerId) return
    drag.current = null
    e.currentTarget.classList.remove('ii-tls-drag')
    if (d.active) { try { e.currentTarget.releasePointerCapture(e.pointerId) } catch { /* 略過 */ } }
  }
  const step = (d: number) => { const t = items[idx + d]; if (t) onSelect(t.id) }
  useEffect(() => {
    const f = (e: KeyboardEvent) => {
      if (dossierOpen || isTypingTarget(e.target)) return
      if (e.key === 'Escape') { e.preventDefault(); if (drawerOpen) onDrawer(false); else onClose() }
      else if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') { e.preventDefault(); step(e.key === 'ArrowRight' ? 1 : -1) }
    }
    window.addEventListener('keydown', f)
    return () => window.removeEventListener('keydown', f)
  })
  const pos = (i: number): number => lay.axisY - lay.lanes[i]! * (TIMELINE.cardH + TIMELINE.laneGap) - TIMELINE.cardH - 8
  const arcOn = (thread: string): boolean => thread === cur.thread
  return (
    <div ref={panelRef} className={`ii-tlp${shown && on ? ' ii-on' : ''}`} data-testid="ii-timeline" role="dialog" aria-label={`${name} 時間軸`}
      style={{ ['--c' as string]: color, transformOrigin: origin ? `${origin[0]}px ${origin[1]}px` : '50% 50%' }} onTransitionEnd={onTransEnd}>
      <div className="ii-tlh" ref={headRef}>
        <button type="button" className="ii-btn" data-testid="ii-back" onClick={onClose} aria-label="回到島嶼全景">‹ 全景</button>
        <div className="ii-tlt">
          <span className="ii-tl-nm" data-testid="ii-tl-name">{name}</span>
          <span className="ii-tl-ct">{items.length} 則 · {ym(items[0]!.date)} ～ {ym(items[items.length - 1]!.date)}{fresh > 0 && <span className="ii-ln-new"> · 近 30 天 +{fresh}</span>}</span>
        </div>
        <WeaveToggle cid={cid} open={drawerOpen} onToggle={() => onDrawer(!drawerOpen)} />
        <span className="ii-sp" />
        <span className="ii-keys">← → 切換心得 · 拖曳或 Shift＋滾輪橫移 · Esc 回全景</span>
        <button type="button" className="ii-isw" data-testid="ii-island-prev" aria-label={`上一座島：${prev.name}`} onClick={() => onIsland(prev.id)}><i style={{ background: colorOf(prev.id) }} aria-hidden />‹ {prev.name}</button>
        <button type="button" className="ii-isw" data-testid="ii-island-next" aria-label={`下一座島：${next.name}`} onClick={() => onIsland(next.id)}>{next.name} ›<i style={{ background: colorOf(next.id) }} aria-hidden /></button>
      </div>
      <div className="ii-tls" ref={scrollRef} data-testid="ii-tl-scroll"
        onPointerDown={onPtrDown} onPointerMove={onPtrMove} onPointerUp={onPtrEnd} onPointerCancel={onPtrEnd}>
        <div className="ii-tli" style={{ width: lay.width, height: lay.height }}>
          <svg className="ii-tlsvg" width={lay.width} height={lay.height} aria-hidden>
            <line className="ii-axis" x1={lay.xs[0]! - 40} y1={lay.axisY} x2={lay.xs[lay.xs.length - 1]! + 40} y2={lay.axisY} strokeWidth={3} strokeLinecap="round" />
            {lay.months.map((m, k) => (
              <g key={k}>
                <line className="ii-tick" x1={m.x} y1={lay.axisY - 6} x2={m.x} y2={lay.axisY + 6} />
                <text className={`ii-mon${m.year ? ' ii-mon-y' : ''}`} x={m.x} y={lay.axisY + 22} textAnchor="middle">{m.label}</text>
              </g>
            ))}
            {lay.arcs.map((a, k) => {
              const x1 = lay.xs[a.from]!, x2 = lay.xs[a.to]!
              const d = Math.min(46, 20 + Math.abs(x2 - x1) / 14)
              const o = arcOn(a.thread)
              return <path key={k} className={`ii-arc ii-ln-${a.relation}`} data-on={o ? '1' : '0'} d={`M${x1},${lay.axisY + 4} Q${(x1 + x2) / 2},${lay.axisY + 28 + d} ${x2},${lay.axisY + 4}`} strokeWidth={o ? 3 : 1.5} strokeDasharray="5 4" opacity={o ? 1 : 0.18} />
            })}
            {items.map((it, i) => (
              <g key={it.id}>
                <line className="ii-stem" x1={lay.xs[i]} y1={pos(i) + TIMELINE.cardH} x2={lay.xs[i]} y2={lay.axisY} />
                <circle className={`ii-node${it.relation === 'new' ? ' ii-node-new' : ''}`} cx={lay.xs[i]} cy={lay.axisY} r={i === idx ? 8 : it.relation === 'new' ? 5.5 : 4.5} />
              </g>
            ))}
          </svg>
          {items.map((it, i) => (
            <button key={it.id} type="button" className={`ii-tlc${it.relation !== 'new' ? ' ii-ev' : ''}${i === idx ? ' ii-sel' : ''}`} data-testid="ii-tl-card" data-id={it.id} data-selected={i === idx ? 'true' : undefined}
              aria-label={`${it.date} ${RELATION_LABEL[it.relation]} ${it.text}`} aria-current={i === idx ? 'true' : undefined}
              style={{ left: lay.xs[i]! - TIMELINE.cardW / 2, top: pos(i), width: TIMELINE.cardW, height: TIMELINE.cardH }} onClick={() => onSelect(it.id)}>
              <span className="ii-tc-d">{md(it.date)}{it.relation !== 'new' && <Rel r={it.relation} />}</span>
              <span className="ii-tc-t">{it.text}</span>
            </button>
          ))}
        </div>
      </div>
      <div className="ii-tlguide" aria-hidden />
      <div className="ii-tld">
        <div className="ii-tldc" data-testid="ii-detail" key={cur.id}>
          <DetailBody ins={cur} pw={pw} siblings={items} onSelect={onSelect} ideas={ideas} onOpenIdea={onOpenIdea} onDossier={onDossier}
            nav={(
              <div className="ii-nav">
                <button type="button" data-testid="ii-prev" disabled={idx === 0} onClick={() => step(-1)}>‹ 較早</button>
                <span>{idx + 1} / {items.length}</span>
                <button type="button" data-testid="ii-next" disabled={idx >= items.length - 1} onClick={() => step(1)}>較新 ›</button>
              </div>
            )} />
        </div>
      </div>
      {drawerOpen && <IslandDrawer cid={cid} top={headRef.current?.offsetHeight ?? 56} onClose={() => onDrawer(false)} />}
    </div>
  )
}

// ─────────────────────────────────────────────
// 手機逐層
// ─────────────────────────────────────────────

function MiniBars({ bins, color }: { bins: number[]; color: string }) {
  const max = Math.max(1, ...bins)
  return (
    <svg className="ii-bars" viewBox="0 0 120 22" width="100%" height="22" preserveAspectRatio="none" aria-hidden focusable="false">
      {bins.map((n, i) => { const h = n === 0 ? 1 : 3 + (n / max) * 18; return <rect key={i} x={i * 5} y={22 - h} width={3.6} height={h} rx={1} style={{ fill: n === 0 ? undefined : color }} className={n === 0 ? 'ii-bar0' : undefined} /> })}
    </svg>
  )
}

// ─────────────────────────────────────────────
// 主元件
// ─────────────────────────────────────────────

export function InsightIslands({ pw, now, onRequestUnlock, ideas, onOpenIdea, hhiScores = null }: {
  pw: string | null; now: Date; onRequestUnlock: () => void; ideas?: IdeaItem[] | null; onOpenIdea?: (id: string) => void
  hhiScores?: Map<string, number> | null
}) {
  const ins = useAsync(pw, apiFetchInsights)
  const data: InsightData | null = ins.data
  const nowMs = now.getTime()
  const st = blockState({ unlocked: !!pw, loading: ins.loading, error: ins.error, hasData: !!data, empty: !!data && data.insights.length === 0, nowMs })
  return (
    <section className="ii-root" aria-labelledby="ii-h" data-testid="insight-islands">
      <div className="ii-head"><h2 id="ii-h" className="ii-title">我的心得</h2></div>
      <StateFrame
        status={st} source="我的心得" onRequestUnlock={onRequestUnlock} onRetry={ins.reload} className="ii-frame"
        empty={<span data-testid="ii-empty">心得累積中：HERMES 每晚會從日記抽出你的體會，長成一座座島</span>}
        errorText="心得暫時讀不到"
        skeleton={<div className="ii-skel" data-testid="ii-skeleton" aria-hidden />}
      >
        {data && data.insights.length > 0 && <Body pw={pw} now={now} data={data} ideas={ideas ?? null} onOpenIdea={onOpenIdea} hhiScores={hhiScores} />}
      </StateFrame>
    </section>
  )
}

function Body({ pw, now, data, ideas, onOpenIdea, hhiScores }: {
  pw: string | null; now: Date; data: InsightData; ideas: IdeaItem[] | null; onOpenIdea?: (id: string) => void; hhiScores: Map<string, number> | null
}) {
  const theme = useTheme()
  const wrapRef = useRef<HTMLDivElement>(null)
  const [w, setW] = useState(0)
  useLayoutEffect(() => {
    const el = wrapRef.current
    if (!el) return
    const f = () => setW(Math.floor(el.clientWidth))
    f()
    if (typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver(f)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])
  const mobile = w > 0 && w < MOBILE_W

  const day = taipeiDay(now)
  const todayN = dayN(day)
  const byId = useMemo(() => new Map(data.insights.map((i) => [i.id, i])), [data])
  const groups = useMemo(() => {
    const m = new Map<string, Insight[]>()
    for (const i of data.insights) { const l = m.get(i.cluster); if (l) l.push(i); else m.set(i.cluster, [i]) }
    for (const l of m.values()) l.sort(byDateId)
    return m
  }, [data])
  const world = useMemo(() => layoutIslands(groups, now), [groups, day]) // eslint-disable-line react-hooks/exhaustive-deps
  const slots = useMemo(() => clusterSlots([...new Set([...data.clusters.map((c) => c.id), ...data.insights.map((i) => i.cluster)])]), [data])
  const colorOf = useCallback((cid: string): string => paletteColor(slots.get(cid) ?? 0, theme), [slots, theme])
  const names = useMemo(() => new Map(data.clusters.map((c) => [c.id, c.name])), [data])
  const nameOf = useCallback((cid: string): string => names.get(cid) ?? cid, [names])
  const stats = useMemo(() => insightStats(data, now), [data, day]) // eslint-disable-line react-hooks/exhaustive-deps
  const evolved = useMemo(() => data.insights.filter((i) => i.relation !== 'new').length, [data])
  const recent = useMemo(() => {
    const c: Record<InsightRelation, number> = { new: 0, reinforce: 0, refine: 0, overturn: 0 }
    for (const i of data.insights) if (todayN - dayN(i.date) <= GLOW_DAYS && todayN - dayN(i.date) >= 0) c[i.relation]++
    return c
  }, [data, todayN])
  const bands = useMemo(() => (hhiScores ? insightsByBand(data.insights, hhiScores) : null), [data, hhiScores])
  const [bornPick, setBornPick] = useState<'high' | 'low' | null>(null)
  const bornList = bands && bornPick ? (bornPick === 'high' ? bands.high : bands.low).slice(0, 8) : []

  const hashId = useMemo(() => { const id = typeof window === 'undefined' ? null : insightIdFromHash(window.location.hash); return id && byId.has(id) ? id : null }, []) // eslint-disable-line react-hooks/exhaustive-deps
  const [open, setOpen] = useState<string | null>(() => (hashId ? byId.get(hashId)!.cluster : null))
  const [sel, setSel] = useState<string | null>(hashId)
  const [closing, setClosing] = useState(false)
  const [origin, setOrigin] = useState<[number, number] | null>(null)
  const [dossier, setDossier] = useState<string | null>(null)
  // 3.17.0：本島編織抽屜開在哪座島（預設關；換島、跳到別則、回全景就關）
  const [drawer, setDrawer] = useState<string | null>(null)
  const wd = useWeaveData(pw, data.insights)
  const pano = useRef<PanoApi>(null)
  const closeTimer = useRef(0)
  useEffect(() => () => window.clearTimeout(closeTimer.current), [])
  const startIsland = useRef(hashId ? byId.get(hashId)!.cluster : null).current

  const latestOf = (cid: string): string | null => { const l = groups.get(cid); return l && l.length > 0 ? l[l.length - 1]!.id : null }
  const select = useCallback((id: string) => { setSel(id); writeHash(id) }, [])   // 同島切換心得：抽屜保持開（換島靠 drawer===open 自動關、跳轉由 jump 關）
  const enter = useCallback((cid: string, id: string | null) => {
    if (!groups.has(cid)) return
    if (mobile) { setOpen(cid); setSel(id); setDrawer(null); writeHash(id); return }
    const target = id ?? latestOf(cid)
    const go = () => { setOrigin(pano.current?.screenOf(cid) ?? null); setClosing(false); setOpen(cid); setSel(target); writeHash(target) }
    if (pano.current) pano.current.flyIsland(cid, false, go, 1.8)
    else go()
  }, [groups, mobile]) // eslint-disable-line react-hooks/exhaustive-deps
  const closeTl = useCallback(() => {
    setDrawer(null)
    if (mobile || reducedMotion()) { setOpen(null); setSel(null); writeHash(null); pano.current?.flyOverview(); return }
    setClosing(true); writeHash(null); pano.current?.flyOverview()
    window.clearTimeout(closeTimer.current)
    closeTimer.current = window.setTimeout(() => { setOpen(null); setSel(null); setClosing(false) }, 330)
  }, [mobile])
  const switchIsland = useCallback((cid: string) => {
    const id = latestOf(cid)
    if (!id) return
    setOpen(cid); setSel(id); writeHash(id)
    pano.current?.flyIsland(cid, true)
  }, [groups]) // eslint-disable-line react-hooks/exhaustive-deps
  // 外部改 hash（搜尋結果、釘選、上一頁）
  useEffect(() => {
    const f = () => {
      const id = insightIdFromHash(window.location.hash)
      const it = id ? byId.get(id) : undefined
      if (it) { setClosing(false); setOpen(it.cluster); setSel(id); pano.current?.flyIsland(it.cluster, true) }
      else if (!id) { setOpen(null); setSel(null); setClosing(false) }
    }
    window.addEventListener('hashchange', f)
    return () => window.removeEventListener('hashchange', f)
  }, [byId])

  // 跳到某則心得：同島就選它，不同島就切島並選它，並關抽屜
  const jumpRef = useRef<(id: string) => void>(() => undefined)
  jumpRef.current = (id: string) => {
    const it = byId.get(id)
    if (!it) return
    setDrawer(null)
    if (it.cluster === open) { select(id); return }
    setClosing(false); setOpen(it.cluster); setSel(id); writeHash(id)
    pano.current?.flyIsland(it.cluster, true)
  }
  const jump = useCallback((id: string) => jumpRef.current(id), [])
  const wctx = useMemo<WeaveCtx | null>(() => (wd ? { ...wd, byId, colorOf, nameOf, jump } : null), [wd, byId, colorOf, nameOf, jump])

  const order = world.islands.map((i) => i.id)
  const openIdx = open ? order.indexOf(open) : -1
  const nameAt = (i: number): { id: string; name: string } => { const id = order[(i + order.length) % order.length]!; return { id, name: nameOf(id) } }
  const openItems = open ? groups.get(open) ?? [] : []
  const openIsland = open ? world.islands.find((i) => i.id === open) : undefined
  const selIns = sel ? byId.get(sel) ?? null : null
  const dossierIns = dossier ? byId.get(dossier) ?? null : null

  const detailFor = (it: Insight, siblings: readonly Insight[]) => (
    <DetailBody ins={it} pw={pw} siblings={siblings} onSelect={select} ideas={ideas} onOpenIdea={onOpenIdea} onDossier={setDossier} />
  )

  return (
    <WeaveProvider value={wctx}>
    <div className="ii-body" ref={wrapRef}>
      <div className="ii-metrics" data-testid="ii-stats">
        <p className="ii-stats-line">
          心得 {stats.total} 則・本月 +{stats.thisMonth}・演變 {evolved} 次
          <span className="ii-30"> ｜ 近 30 天：新生 {recent.new}・印證 {recent.reinforce}・修正 {recent.refine}・推翻 {recent.overturn}</span>
        </p>
        {bands && bands.known > 0 && (
          <p className="ii-born-bands" data-testid="ii-born">
            高分日子（≥{HIGH}）長出{' '}
            <button type="button" className={`ii-born-n${bornPick === 'high' ? ' ii-on' : ''}`} aria-pressed={bornPick === 'high'} aria-label={`篩選高分日子長出的 ${bands.high.length} 則心得`} onClick={() => setBornPick((v) => (v === 'high' ? null : 'high'))}>{bands.high.length}</button>
            {' '}則・低分日子（&lt;{LOW}）{' '}
            <button type="button" className={`ii-born-n${bornPick === 'low' ? ' ii-on' : ''}`} aria-pressed={bornPick === 'low'} aria-label={`篩選低分日子長出的 ${bands.low.length} 則心得`} onClick={() => setBornPick((v) => (v === 'low' ? null : 'low'))}>{bands.low.length}</button>
            {' '}則
          </p>
        )}
        {bornList.length > 0 && (
          <ul className="ii-born-list" data-testid="ii-born-list" aria-label={bornPick === 'high' ? '高分日子長出的心得' : '低分日子長出的心得'}>
            {bornList.map((it) => (
              <li key={it.id}>
                <button type="button" onClick={() => enter(it.cluster, it.id)}><span className="ii-bl-d">{it.date}</span><span className="ii-bl-x">{it.text}</span></button>
              </li>
            ))}
          </ul>
        )}
      </div>

      {w > 0 && !mobile && (
        <div className="ii-stage" data-testid="ii-stage">
          <Panorama ref={pano} world={world} byId={byId} colorOf={colorOf} nameOf={nameOf} todayN={todayN} startIsland={startIsland} onEnter={enter} weave={wctx} hoverOff={open !== null} />
          {open && openIsland && selIns && openItems.length > 0 && (
            <TimelinePanel
              cid={open} name={nameOf(open)} color={colorOf(open)} items={openItems} sel={selIns.id} on={!closing} origin={origin} fresh={openIsland.fresh}
              prev={nameAt(openIdx - 1)} next={nameAt(openIdx + 1)} colorOf={colorOf} pw={pw} ideas={ideas} onOpenIdea={onOpenIdea} dossierOpen={dossier !== null} drawerOpen={drawer === open} onDrawer={(o) => setDrawer(o ? open : null)}
              onSelect={select} onClose={closeTl} onIsland={switchIsland} onDossier={setDossier} />
          )}
        </div>
      )}

      {mobile && (
        <div className="ii-m" data-testid="ii-mobile">
          {open === null && (
            <div className="ii-m-list">
              {world.islands.map((is) => {
                const items = groups.get(is.id) ?? []
                const lt = items[items.length - 1]
                return (
                  <button key={is.id} type="button" className="ii-m-theme" data-testid="ii-m-theme" data-id={is.id} style={{ ['--c' as string]: colorOf(is.id) }} aria-label={`${nameOf(is.id)}，${items.length} 則`} onClick={() => enter(is.id, null)}>
                    <span className="ii-m-r1"><span className="ii-m-nm">{nameOf(is.id)}</span><span className="ii-m-ct">{items.length} 則 · {md(is.last)}</span>{is.fresh > 0 && <span className="ii-m-new">近 30 天 +{is.fresh}</span>}</span>
                    {lt && <span className="ii-m-lt">{lt.text}</span>}
                    <MiniBars bins={monthBins(items, now)} color={colorOf(is.id)} />
                  </button>
                )
              })}
              <p className="ii-note">依最近有新心得的主題排序 · 小長條＝近 24 個月每月心得數</p>
            </div>
          )}
          {open !== null && sel === null && (
            <div className="ii-m-theme-view" style={{ ['--c' as string]: colorOf(open) }}>
              <div className="ii-m-head">
                <button type="button" className="ii-btn" data-testid="ii-back" onClick={closeTl}>‹ 主題</button>
                <h3 style={{ color: colorOf(open) }}>{nameOf(open)}</h3><span className="ii-m-ct">{openItems.length} 則</span>
                <WeaveToggle cid={open} open={drawer === open} onToggle={() => setDrawer(drawer === open ? null : open)} />
              </div>
              <MiniBars bins={monthBins(openItems, now)} color={colorOf(open)} />
              <MobileTimeline items={openItems} onPick={(id) => { setDrawer(null); select(id) }} />
              {drawer === open && <IslandDrawer cid={open} mobile onClose={() => setDrawer(null)} />}
            </div>
          )}
          {open !== null && selIns && (
            <div className="ii-m-sheet" data-testid="ii-m-sheet" style={{ ['--c' as string]: colorOf(open) }}>
              <div className="ii-m-head"><button type="button" className="ii-btn" data-testid="ii-back" onClick={() => { setSel(null); writeHash(null) }}>‹ {nameOf(open)}</button></div>
              <div className="ii-m-card" data-testid="ii-detail" key={selIns.id}>{detailFor(selIns, openItems)}</div>
            </div>
          )}
        </div>
      )}
      {dossier && dossierIns && (
        <InsightPanel pw={pw} id={dossier} fallback={dossierIns} onClose={() => setDossier(null)} onSelect={(id) => { if (byId.has(id)) { setDossier(null); enter(byId.get(id)!.cluster, id) } else setDossier(id) }}
          ideas={ideas} onOpenIdea={onOpenIdea ? (iid) => { setDossier(null); onOpenIdea(iid) } : undefined} hhiScores={hhiScores} />
      )}
    </div>
    </WeaveProvider>
  )
}

/** 手機的主題直式時間線：依脈絡分組、新在上，子心得縮排 */
function MobileTimeline({ items, onPick }: { items: readonly Insight[]; onPick: (id: string) => void }) {
  const rows = useMemo(() => {
    const threads = new Map<string, Insight[]>()
    for (const i of items) { const l = threads.get(i.thread); if (l) l.push(i); else threads.set(i.thread, [i]) }
    const list = [...threads.values()].map((l) => [...l].sort(byDateId)).sort((a, b) => (a[a.length - 1]!.date < b[b.length - 1]!.date ? 1 : a[a.length - 1]!.date > b[b.length - 1]!.date ? -1 : 0))
    const mixed: ({ kind: 'yr'; y: string } | { kind: 'it'; it: Insight; child: boolean })[] = []
    let yr = ''
    for (const th of list) {
      const y = th[th.length - 1]!.date.slice(0, 4)
      if (y !== yr) { yr = y; mixed.push({ kind: 'yr', y }) }
      const ids = new Set(th.map((t) => t.id))
      for (const it of th) mixed.push({ kind: 'it', it, child: it.parent !== null && ids.has(it.parent) })
    }
    return mixed
  }, [items])
  return (
    <div className="ii-m-tl">
      {rows.map((r, k) => r.kind === 'yr'
        ? <div key={`y${r.y}${k}`} className="ii-yr">{r.y}</div>
        : (
          <button key={r.it.id} type="button" className={`ii-m-item${r.child ? ' ii-child' : ''}`} data-testid="ii-m-item" data-id={r.it.id} aria-label={`${r.it.date} ${r.it.text}`} onClick={() => onPick(r.it.id)}>
            <span className="ii-mi-m">{r.it.date}<Rel r={r.it.relation} /></span>
            <span className="ii-mi-t">{r.it.text}</span>
          </button>
        ))}
    </div>
  )
}
