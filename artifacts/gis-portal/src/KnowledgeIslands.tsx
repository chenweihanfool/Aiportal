import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react'
import { KnowledgeSourcePanel } from './KnowledgeSourcePanel'
import { nextCompact, wideIndexWidth } from './knowledgeIslands'
import { apiFetchVerdicts, apiFetchWeave, apiPostVerdict } from './insightWeaveApi'
import { apiFetchInsights } from './insightApi'
import { paletteColor, type PaletteTheme } from './insightPalette'
import { useAsync } from './homeHooks'
import {
  aiBridgesAt, analyzeTopic, bridgesAt, buildIslandModel, cardMark, cardRect, chipGroups, computeBridges, defaultSelection, fitView, groupBullets, groupOfSel, isValidSelection, islandSize, islandStats,
  kbLinksFor, layoutSea, nodeOrder, orphanSteps, resolveStepBridges, stationCoverage, stationForNode, zoomAt,
  CARD_H, CARD_W, DOMAIN_HEAD_H, ISL_LABEL_H, type AiBridge, type Bridge, type IslandModelIsland, type Placed, type Station, type TopicAnalysis, type View,
} from './knowledgeIslands'
import { buildTree, kindLabel, recentChangeOf, stripMarks, type Bullet, type Topic, type TopicDiagram, type TopicsData } from './knowledgeView'
import { KnowledgeReader, ReaderSide } from './KnowledgeReader'
import { KnowledgeDiagram, DiagramNodeDetail, diagramNodeInfo } from './KnowledgeDiagram'
import { KnowledgeSteps } from './KnowledgeSteps'
import { KnowledgeFork } from './KnowledgeFork'
import { fallbackFlow, forkFromFlow, forkFromText } from './knowledgeFork'
import { useTopicQuotes } from './KnowledgeTrace'
import { quoteQueryFor } from './knowledgeDiagramLayout'
import { formatKnowledgeHash, parseKnowledgeHash, type KnowledgeRoute } from './knowledgeRoute'
import { RELATION_TEXT, foldVerdicts, verdictOf, type KbLink, type KbStep } from './insightWeave'
import type { Insight } from './insightModel'

// 知識島（3.18.0）：知識頁的「島嶼」視圖。島＝知識樹的枝；點島飛入後橫軸是該題的做事順序（SOP）；疊加層顯示心得掛在哪一步、共用步驟（橋）與盲點。
// 互動與外觀照首頁心得島（InsightIslands）；純函式在 knowledgeIslands.ts，樣式在 portal.css 的 kis-*。
// 3.21.0：知識頁只剩這一種畫面。進島狀態與網址（#knowledge／#knowledge/<id>／#knowledge/<id>/s/<選取>）同步。
// 3.23.0：進島只有一頁——最上方常駐泳道圖（或備援單泳道圖）當索引，點格子切換主畫面與右側旁註；選取＝格子 id 或 g:<組名>。

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

function useMobile(): boolean {
  const q = '(max-width: 700px)'
  const [m, setM] = useState<boolean>(() => (typeof window !== 'undefined' && !!window.matchMedia?.(q).matches))
  useEffect(() => {
    const mq = window.matchMedia?.(q)
    if (!mq) return
    const f = () => setM(mq.matches)
    mq.addEventListener?.('change', f)
    f()
    return () => mq.removeEventListener?.('change', f)
  }, [])
  return m
}

interface Where { island: string; topicId: string; /** 格子 id 或 g:<組名>；空字串＝沒有可選的 */ sel: string }
const cvar = (c: string): CSSProperties => ({ ['--c' as string]: c })

const NOT_FOUND_TEXT = '找不到這個題目（可能已移除，或還沒推送到）。'

/** 島內網址：#knowledge/<id>/s/<選取>（沒有選取就只有 #knowledge/<id>） */
function hashOf(w: Where): string {
  return formatKnowledgeHash({ view: 'topic', topicId: w.topicId, stationId: w.sel || null })
}

export function KnowledgeIslands({ data, pw, now, head }: { data: TopicsData; pw: string; now: Date; head?: ReactNode }) {
  const theme = useTheme()
  const mobile = useMobile()
  const model = useMemo(() => buildIslandModel(buildTree(data)), [data])
  const names = useMemo(() => new Map(data.topics.map((t) => [t.id, t.name])), [data])
  const weave = useAsync(pw, apiFetchWeave)
  const verdictRows = useAsync(pw, apiFetchVerdicts)
  const insightData = useAsync(pw, apiFetchInsights)
  // 本頁剛按的判定（送出成功才記）；與 feed 紀錄折疊成目前判定。任何一項載入失敗都只是少了 AI 內容。
  const [override, setOverride] = useState<ReadonlyMap<string, 'ok' | 'no' | 'undo'>>(new Map())
  const [rejected, setRejected] = useState<readonly string[]>([])
  const [voteErr, setVoteErr] = useState<string | null>(null)
  const verdicts = useMemo(() => {
    const m = foldVerdicts(verdictRows.data ?? [])
    for (const [id, v] of override) { if (v === 'undo') m.delete(id); else m.set(id, v) }
    return m
  }, [verdictRows.data, override])
  const hidden = useMemo(() => new Set([...verdicts].filter(([, v]) => v === 'no').map(([id]) => id)), [verdicts])
  const kbSteps = weave.data?.kbSteps
  const stepBridgeList = weave.data?.stepBridges
  const analyses = useMemo(() => new Map(data.topics.map((t) => [t.id, analyzeTopic(t, kbSteps ?? [], hidden)])), [data, kbSteps, hidden])
  const bridges = useMemo(() => computeBridges([...analyses.values()]), [analyses])
  const aiBridges = useMemo(() => resolveStepBridges(stepBridgeList ?? [], analyses, hidden), [stepBridgeList, analyses, hidden])
  const insightById = useMemo(() => new Map((insightData.data?.insights ?? []).map((i) => [i.id, i])), [insightData.data])
  const vote = useCallback(async (id: string, v: 'ok' | 'no' | 'undo') => {
    setVoteErr(null)
    try {
      await apiPostVerdict(pw, id, v)
      setOverride((m) => new Map(m).set(id, v))
      if (v === 'no') setRejected((r) => (r.includes(id) ? r : [...r, id]))
    } catch { setVoteErr('送出失敗，請稍後再試。') }
  }, [pw])
  const kbLinks: readonly KbLink[] | null = weave.data?.kbLinks ?? null
  const [hover, setHover] = useState<string | null>(null)
  const recent = useMemo(() => recentChangeOf(data.topics, now, 7), [data.topics, now])

  const islandOf = useMemo(() => {
    const m = new Map<string, { island: IslandModelIsland; slot: number }>()
    for (const d of model) for (const i of d.islands) for (const t of i.topics) m.set(t.id, { island: i, slot: d.slot })
    return m
  }, [model])
  const islandById = useMemo(() => {
    const m = new Map<string, { island: IslandModelIsland; slot: number }>()
    for (const d of model) for (const i of d.islands) m.set(i.id, { island: i, slot: d.slot })
    return m
  }, [model])
  const colorOf = useCallback((slot: number) => paletteColor(slot, theme), [theme])

  const topicById = useMemo(() => new Map(data.topics.map((t) => [t.id, t])), [data])
  const defaultSel = (topicId: string): string => {
    const t = topicById.get(topicId)
    const a = analyses.get(topicId)
    return t && a ? defaultSelection(t, a, indexDiagramOf(t, a)) ?? '' : ''
  }
  /** 這題的站對到哪個選取（橋跳轉用）：先找對應這站的格子，再找同名的組，都沒有用預設 */
  const selForStation = (topicId: string, stationId: string): string => {
    const t = topicById.get(topicId)
    const a = analyses.get(topicId)
    if (!t || !a) return ''
    const node = nodeOrder(indexDiagramOf(t, a)).find((id) => stationForNode(t, a, id) === stationId)
    if (node) return node
    if (chipGroups(a.parsed).some((g) => g.key === stationId)) return `g:${stationId}`
    return defaultSel(topicId)
  }
  /** 網址 → 進島狀態：找不到題目回 null（留在全景並顯示找不到）；選取不合法退回預設 */
  const resolve = (r: KnowledgeRoute): { where: Where } | null | 'overview' => {
    if (r.view === 'overview') return 'overview'
    const e = islandOf.get(r.topicId)
    if (!e) return null
    const t = topicById.get(r.topicId)
    const a = analyses.get(r.topicId)
    const ok = r.stationId !== null && !!t && !!a && isValidSelection(r.stationId, a, indexDiagramOf(t, a), t)
    return { where: { island: e.island.id, topicId: r.topicId, sel: ok ? r.stationId! : defaultSel(r.topicId) } }
  }
  const [init] = useState(() => {
    const r = parseKnowledgeHash(window.location.hash) ?? { view: 'overview' as const }
    return { r, x: resolve(r) }
  })
  const [where, setWhereRaw] = useState<Where | null>(() => (init.x && init.x !== 'overview' ? init.x.where : null))
  const [notFound, setNotFound] = useState<boolean>(() => init.r.view === 'topic' && init.x === null)

  // 外部網址變動（連結、上一頁）→ 套用到進島狀態。replaceState 不會觸發 hashchange，所以島內切換不會回頭打自己。
  const resolveRef = useRef(resolve)
  resolveRef.current = resolve
  useEffect(() => {
    const onHash = () => {
      const r = parseKnowledgeHash(window.location.hash)
      if (!r) return
      const x = resolveRef.current(r)
      if (x === 'overview') { setWhereRaw(null); setNotFound(false) }
      else if (x === null) { setWhereRaw(null); setNotFound(true) }
      else { setWhereRaw(x.where); setNotFound(false) }
    }
    window.addEventListener('hashchange', onHash)
    return () => window.removeEventListener('hashchange', onHash)
  }, [])

  // 島內切題分頁、切選取：寫回網址但不新增歷史
  const writeHash = (h: string) => { try { window.history.replaceState(null, '', h) } catch { /* 寫不進去就只在畫面上有效 */ } }
  const setWhere = (w: Where) => { setWhereRaw(w); writeHash(hashOf(w)) }
  const navTopic = (topicId: string, stationId: string | null) => { window.location.hash = formatKnowledgeHash({ view: 'topic', topicId, stationId }) }
  // 從全景點島：用一般導航（新增歷史，上一頁回得到全景）寫成第一個非 seed 題目的預設選取，狀態由 hashchange 套用
  const enter = (islandId: string, topicId?: string) => {
    const e = islandById.get(islandId)
    if (!e) return
    const t = (topicId ? e.island.topics.find((x) => x.id === topicId) : undefined) ?? e.island.topics.find((x) => !analyses.get(x.id)?.seed) ?? e.island.topics[0]
    if (t) navTopic(t.id, defaultSel(t.id) || null)
  }
  const go = (topicId: string, stationId?: string) => {
    const e = islandOf.get(topicId)
    if (!e) return
    const w = { island: e.island.id, topicId, sel: stationId ? selForStation(topicId, stationId) : defaultSel(topicId) }
    setWhereRaw(w); writeHash(hashOf(w))
  }
  /** 資訊帶裡點同枝／跨枝題目、原文面板的題目：切到該題的預設選取 */
  const openTopic = (id: string) => navTopic(id, null)
  const backToOverview = () => { window.location.hash = '#knowledge' }
  const plusOf = (i: IslandModelIsland) => i.topics.filter((t) => recent.has(t.id)).length

  if (model.length === 0) return <p className="kn-empty">還沒有可以畫成島的題目。</p>
  if (where) {
    const e = islandById.get(where.island)
    if (e) {
      return (
        <IslandInside
          key={where.island} island={e.island} color={colorOf(e.slot)} where={where} setWhere={setWhere} analyses={analyses} bridges={bridges} aiBridges={aiBridges} kbLinks={kbLinks}
          verdicts={verdicts} rejected={rejected.filter((id) => hidden.has(id))} voteErr={voteErr} vote={vote} insightById={insightById}
          pw={pw} now={now} data={data} onBack={backToOverview} onOpen={openTopic} onJump={go} names={names}
        />
      )
    }
  }
  if (mobile) {
    return (
      <div className="kis-root kis-mobile" data-testid="kis-overview">
        {head}
        {notFound && <p className="kn-empty" role="alert">{NOT_FOUND_TEXT}</p>}
        {model.map((d) => (
          <section key={d.id} className="kis-m-dom">
            <h2 className="kis-m-domh">{d.name}</h2>
            {d.islands.map((i) => {
              const st = islandStats(i, analyses, bridges, aiBridges)
              return (
                <button key={i.id} type="button" className="kis-m-isl" style={cvar(colorOf(d.slot))} onClick={() => enter(i.id)}>
                  <b>{i.name}{plusOf(i) > 0 && <span className="kis-plus" title="這週有變動的題目">+{plusOf(i)}</span>}</b>
                  <span>{i.topics.length} 題 · 💬 {st.insights}</span>
                </button>
              )
            })}
          </section>
        ))}
      </div>
    )
  }
  return (
    <>
      {head}
      {notFound && <p className="kn-empty" role="alert">{NOT_FOUND_TEXT}</p>}
      <Sea model={model} analyses={analyses} bridges={bridges} aiBridges={aiBridges} kbLinks={kbLinks} colorOf={colorOf} hover={hover} setHover={setHover} onEnter={enter} plusOf={plusOf} />
    </>
  )
}

/* ───────── 全景 ───────── */

function Sea({ model, analyses, bridges, aiBridges, kbLinks, colorOf, hover, setHover, onEnter, plusOf }: {
  model: ReturnType<typeof buildIslandModel>
  analyses: ReadonlyMap<string, TopicAnalysis>
  bridges: readonly Bridge[]
  aiBridges: readonly AiBridge[]
  kbLinks: readonly KbLink[] | null
  colorOf: (slot: number) => string
  hover: string | null
  setHover: (id: string | null) => void
  onEnter: (islandId: string, topicId?: string) => void
  plusOf: (i: IslandModelIsland) => number
}) {
  const boxRef = useRef<HTMLDivElement>(null)
  const [size, setSize] = useState({ w: 0, h: 0 })
  const [v, setV] = useState<View>({ x: 0, y: 0, k: 1 })
  const [drag, setDrag] = useState(false)
  const vRef = useRef(v)
  vRef.current = v
  const moved = useRef(0)
  const last = useRef({ x: 0, y: 0 })

  const layout = useMemo(
    () => layoutSea(model.map((d) => ({ islands: d.islands.map((i) => islandSize(i.topics.length)) })), size.w > 0 && size.h > 0 ? size.w / size.h : 1.6),
    [model, size.w, size.h],
  )

  useLayoutEffect(() => {
    const el = boxRef.current
    if (!el) return
    const measure = () => setSize({ w: el.clientWidth, h: el.clientHeight })
    measure()
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(measure) : null
    ro?.observe(el)
    return () => ro?.disconnect()
  }, [])

  const fit = useCallback(() => setV(fitView(layout.width, layout.height, size.w, size.h)), [layout.width, layout.height, size.w, size.h])
  useEffect(() => { fit() }, [fit])

  // 滾輪縮放（要 preventDefault，所以用原生非 passive 監聽）
  useEffect(() => {
    const el = boxRef.current
    if (!el) return
    const onWheel = (e: WheelEvent) => {
      e.preventDefault()
      const r = el.getBoundingClientRect()
      setV(zoomAt(vRef.current, e.deltaY < 0 ? 1.12 : 1 / 1.12, e.clientX - r.left, e.clientY - r.top))
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, [])

  const zoomBtn = (f: number) => setV((cur) => zoomAt(cur, f, size.w / 2, size.h / 2))

  // 卡片絕對位置（供橋的連線用）
  const cardPos = useMemo(() => {
    const m = new Map<string, Placed>()
    model.forEach((d, di) => d.islands.forEach((i, ii) => {
      const ip = layout.domains[di]?.islands[ii]
      if (!ip) return
      i.topics.forEach((t, ti) => { const c = cardRect(ti, i.topics.length); m.set(t.id, { x: ip.x + c.x, y: ip.y + c.y, w: c.w, h: c.h }) })
    }))
    return m
  }, [model, layout])

  const curve = (p: Placed, q: Placed) => {
    const x1 = p.x + p.w / 2, y1 = p.y + p.h / 2, x2 = q.x + q.w / 2, y2 = q.y + q.h / 2
    // PM 修正：同一列的兩張卡改往下彎，標籤放在曲線真正的中點，才不會壓到島名
    const sameRow = Math.abs(y2 - y1) < 1
    const cx = (x1 + x2) / 2, cy = sameRow ? y1 + p.h / 2 + 36 : (y1 + y2) / 2 - Math.min(80, Math.hypot(x2 - x1, y2 - y1) / 6)
    return { d: `M${x1},${y1} Q${cx},${cy} ${x2},${y2}`, mx: cx, my: (y1 + 2 * cy + y2) / 4 + (sameRow ? 12 : -4) }
  }
  const hovered = hover ? model.flatMap((d) => d.islands).find((i) => i.id === hover) ?? null : null
  const lines: Array<{ key: string; d: string; name: string; mx: number; my: number; ai: boolean }> = []
  if (hovered) {
    const seen = new Set<string>()
    for (const t of hovered.topics) {
      const a = analyses.get(t.id)
      if (!a) continue
      for (const sid of a.links.keys()) {
        for (const { bridge, others } of bridgesAt(bridges, t.id, sid)) {
          for (const o of others) {
            const k = `${bridge.key}:${t.id}:${o.topicId}`
            const p = cardPos.get(t.id)
            const q = cardPos.get(o.topicId)
            if (seen.has(k) || !p || !q) continue
            seen.add(k)
            lines.push({ key: k, ...curve(p, q), name: bridge.name, ai: false })
          }
        }
      }
    }
    // AI 步驟橋：每座橋、每對題目只畫一條
    for (const b of aiBridges) {
      for (const e of b.ends) {
        if (!hovered.topics.some((t) => t.id === e.topicId)) continue
        for (const o of b.ends) {
          if (o.topicId === e.topicId) continue
          const k = `ai:${b.id}:${[e.topicId, o.topicId].sort().join(':')}`
          const p = cardPos.get(e.topicId)
          const q = cardPos.get(o.topicId)
          if (seen.has(k) || !p || !q) continue
          seen.add(k)
          lines.push({ key: k, ...curve(p, q), name: b.title, ai: true })
        }
      }
    }
  }
  const stats = hovered ? islandStats(hovered, analyses, bridges, aiBridges) : null

  return (
    <div className="kis-root" data-testid="kis-overview">
      <div className="kis-stage">
        <div
          ref={boxRef}
          className={`kis-box${drag ? ' kis-drag' : ''}`}
          onPointerDown={(e) => { if (e.button !== 0) return; setDrag(true); moved.current = 0; last.current = { x: e.clientX, y: e.clientY } }}
          onPointerMove={(e) => {
            if (!drag) return
            const dx = e.clientX - last.current.x, dy = e.clientY - last.current.y
            last.current = { x: e.clientX, y: e.clientY }
            moved.current += Math.abs(dx) + Math.abs(dy)
            setV((cur) => ({ ...cur, x: cur.x + dx, y: cur.y + dy }))
          }}
          onPointerUp={() => setDrag(false)}
          onPointerLeave={() => setDrag(false)}
          onClickCapture={(e) => { if (moved.current > 5) { e.stopPropagation(); e.preventDefault(); moved.current = 0 } }}
        >
          <div className="kis-sea" style={{ width: layout.width, height: layout.height, transform: `translate(${v.x}px,${v.y}px) scale(${v.k})` }}>
            {model.map((d, di) => {
              const dl = layout.domains[di]
              if (!dl) return null
              return (
                <div key={d.id} className="kis-dom" style={{ left: dl.x, top: dl.y, width: dl.w, height: dl.h }}>
                  <div className="kis-domh" style={{ height: DOMAIN_HEAD_H }}>{d.name}</div>
                </div>
              )
            })}
            {model.map((d, di) => d.islands.map((i, ii) => {
              const ip = layout.domains[di]?.islands[ii]
              if (!ip) return null
              const color = colorOf(d.slot)
              const on = hover === i.id
              return (
                <div
                  key={i.id} className={`kis-isl${on ? ' kis-on' : ''}${hover && !on ? ' kis-dim' : ''}`} data-testid="kis-island" data-id={i.id}
                  style={{ ...cvar(color), left: ip.x, top: ip.y, width: ip.w, height: ip.h }}
                  onMouseEnter={() => setHover(i.id)} onMouseLeave={() => setHover(null)}
                >
                  <button type="button" className="kis-ilab" style={{ height: ISL_LABEL_H }} onClick={() => onEnter(i.id)}>
                    <span className="kis-ln-name">{i.name}</span><span className="kis-ln-sub">{i.topics.length} 題</span>{plusOf(i) > 0 && <span className="kis-plus" title="這週有變動的題目">+{plusOf(i)}</span>}
                  </button>
                  {i.topics.map((t, ti) => {
                    const c = cardRect(ti, i.topics.length)
                    const a = analyses.get(t.id)
                    const mark = on && a ? cardMark(t, a, kbLinks) : null
                    return (
                      <button
                        key={t.id} type="button" className={`kis-card${a?.seed ? ' kis-seed' : ''}`} data-testid="kis-card"
                        style={{ left: c.x, top: c.y, width: CARD_W, height: CARD_H }} title={t.name} onClick={() => onEnter(i.id, t.id)}
                      >
                        <span className="kis-card-t">{t.name}</span>
                        {mark && (
                          <span className={`kis-badge kis-b-${mark.type}`}>
                            {mark.type === 'insights' ? `💬${mark.n}` : mark.type === 'blind' ? '盲點' : '✦ 心得在等'}
                          </span>
                        )}
                      </button>
                    )
                  })}
                </div>
              )
            }))}
            <svg className="kis-lines" width={layout.width} height={layout.height} aria-hidden="true">
              {lines.map((l) => (
                <g key={l.key}>
                  <path d={l.d} className={l.ai ? 'kis-bridge-ai' : 'kis-bridge'} />
                  <text x={l.mx} y={l.my} className={l.ai ? 'kis-bridge-ai-t' : 'kis-bridge-t'} textAnchor="middle">{l.name}</text>
                </g>
              ))}
            </svg>
          </div>
        </div>
        <div className="kis-hint">滾輪縮放、拖曳平移；滑過一座島看心得疊加層，點島進入</div>
        <div className="kis-tools">
          <button type="button" aria-label="放大" onClick={() => zoomBtn(1.25)}>＋</button>
          <button type="button" aria-label="縮小" onClick={() => zoomBtn(0.8)}>－</button>
          <button type="button" onClick={fit}>全景</button>
        </div>
        {stats && <div className="kis-stats" data-testid="kis-stats">心得 {stats.insights} 則 · 橋 {stats.bridges} 座 · 盲點 {stats.blind}/{stats.published} 題</div>}
      </div>
    </div>
  )
}

/* ───────── 島內 ───────── */

const CONF_SHORT = { high: '把握高', mid: '把握中', low: '把握低' } as const

function VerdictCtl({ v, onVote }: { v: 'ok' | 'no' | null; onVote: (x: 'ok' | 'no' | 'undo') => void }) {
  return (
    <span className="kis-vote">
      {v === 'ok'
        ? <><span className="kis-ok">已確認</span><button type="button" className="kis-vbtn" onClick={() => onVote('undo')}>撤回</button></>
        : <><button type="button" className="kis-vbtn" aria-label="確認" onClick={() => onVote('ok')}>✓</button><button type="button" className="kis-vbtn" aria-label="否決" onClick={() => onVote('no')}>✕</button></>}
    </span>
  )
}

function AiStepView({ k, insight, ctl }: { k: KbStep; insight: Insight | undefined; ctl: ReactNode }) {
  return (
    <div className="kis-ai" data-testid="kis-ai-step">
      <span className="kis-ai-tag">✦ AI</span> <span className="kis-rel">{RELATION_TEXT[k.relation]}</span>
      <p>{k.text}</p>
      <blockquote className="kis-quote">{insight ? insight.text : '（心得已不在清單）'}</blockquote>
      {insight?.date && <span className="kis-date">{insight.date} · </span>}
      <span className="kis-date">{CONF_SHORT[k.confidence]}</span>
      {ctl}
    </div>
  )
}

function Chips({ b, t, onSrc }: { b: Bullet; t: Topic; onSrc: (id: string) => void }) {
  if (b.refs.length === 0) return null
  return (
    <span className="kis-chips">
      {b.refs.map((n) => {
        const s = t.sources[n - 1]
        return s
          ? <button key={n} type="button" className="kis-chip" title={s.title} onClick={() => onSrc(s.id)}>{n}</button>
          : <span key={n} className="kis-chip kis-chip-off">{n}</span>
      })}
    </span>
  )
}

function BulletView({ b, t, big, onSrc }: { b: Bullet; t: Topic; big: boolean; onSrc: (id: string) => void }) {
  let body: ReactNode
  if (b.when && b.then) body = <><p className="kis-l"><i>如果</i>{stripMarks(b.when)}</p><p className="kis-l"><i>就</i>{stripMarks(b.then)}</p></>
  else if (b.myth && b.truth) body = <><p className="kis-l"><i>以為</i>{stripMarks(b.myth)}</p><p className="kis-l"><i>其實</i>{stripMarks(b.truth)}</p></>
  else if (b.trap && b.avoid) body = <><p className="kis-l"><i>坑</i>{stripMarks(b.trap)}</p><p className="kis-l"><i>怎麼避開</i>{stripMarks(b.avoid)}</p></>
  else body = <p className={big ? 'kis-big' : 'kis-l'}>{stripMarks(b.text)}</p>
  return <div className="kis-bullet">{body}<Chips b={b} t={t} onSrc={onSrc} /></div>
}

const indexDiagramOf = (t: Topic, a: TopicAnalysis): TopicDiagram | null => (a.parsed ? t.diagram ?? fallbackFlow(a.stations) : null)

function IslandInside({ island, color, where, setWhere, analyses, bridges, aiBridges, kbLinks, verdicts, rejected, voteErr, vote, insightById, pw, now, data, onBack, onOpen, onJump, names }: {
  island: IslandModelIsland
  color: string
  where: Where
  setWhere: (w: Where) => void
  analyses: ReadonlyMap<string, TopicAnalysis>
  bridges: readonly Bridge[]
  aiBridges: readonly AiBridge[]
  kbLinks: readonly KbLink[] | null
  verdicts: ReadonlyMap<string, 'ok' | 'no'>
  rejected: readonly string[]
  voteErr: string | null
  vote: (id: string, v: 'ok' | 'no' | 'undo') => void
  insightById: ReadonlyMap<string, Insight>
  pw: string
  now: Date
  data: TopicsData
  onBack: () => void
  onOpen: (id: string) => void
  onJump: (topicId: string, stationId?: string) => void
  names: ReadonlyMap<string, string>
}) {
  const [panel, setPanel] = useState<{ key: string; q: string } | null>(null)
  const [band, setBand] = useState(false)
  const [full, setFull] = useState(false)
  const [compact, setCompact] = useState(false)
  const [headH, setHeadH] = useState(0)
  const mobile = useMobile()
  const [vh, setVh] = useState(() => (typeof window !== 'undefined' ? window.innerHeight : 900))
  // 桌機左圖右文：容器寬 ≥1100 用寬版（索引在左欄黏住），≥1500 旁註獨立一欄；窄螢幕維持上下排＋黏頂精簡
  const rootRef = useRef<HTMLDivElement>(null)
  const [cw, setCw] = useState(0)
  const [chipsH, setChipsH] = useState(0)
  const [nat, setNat] = useState<{ w: number; h: number } | null>(null)
  const wide = cw >= 1100
  const wide2 = cw >= 1500
  const wideRef = useRef(false)
  wideRef.current = wide
  const chipsRef = useRef<HTMLDivElement>(null)
  const contentRef = useRef<HTMLElement>(null)
  const sentinelRef = useRef<HTMLDivElement>(null)
  const idxRef = useRef<HTMLDivElement>(null)
  const compactRef = useRef(false)
  compactRef.current = compact
  const autoScrollUntil = useRef(0)
  const topic = island.topics.find((t) => t.id === where.topicId) ?? island.topics[0]!
  const a = analyses.get(topic.id)
  const quotes = useTopicQuotes(pw, topic.id)
  const stations: Station[] = a?.stations ?? []
  const diagram = useMemo(() => (a ? indexDiagramOf(topic, a) : null), [a, topic])
  const isFallback = !topic.diagram
  const order = useMemo(() => nodeOrder(diagram), [diagram])
  const orphans = useMemo(() => orphanSteps(topic, diagram), [topic, diagram])
  const groups = useMemo(() => chipGroups(a?.parsed ?? null, orphans.length), [a, orphans])
  const sel = where.sel
  const groupKey = groupOfSel(sel)
  const select = (s: string) => setWhere({ island: island.id, topicId: topic.id, sel: s })
  const navList = groupKey ? groups.map((g) => `g:${g.key}`) : order
  const navIdx = navList.indexOf(sel)
  const move = (d: number) => { const n = navList[navIdx + d]; if (n) select(n) }
  const myLinks = kbLinksFor(kbLinks, topic)
  const seedLike = !a || a.seed || !a.parsed
  const openSrc = (n: number, q: string) => { const s = topic.sources[n - 1]; if (s) setPanel({ key: s.id, q }) }

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tg = e.target as HTMLElement | null
      if (tg && (tg.tagName === 'INPUT' || tg.tagName === 'TEXTAREA' || tg.isContentEditable)) return
      if (e.key === 'ArrowLeft') { e.preventDefault(); move(-1) }
      else if (e.key === 'ArrowRight') { e.preventDefault(); move(1) }
      // PM 修正：來源面板開著時 Esc 只關面板（捕獲階段先攔，避免面板關掉後同一次事件又退回全景）
      else if (e.key === 'Escape') {
        if (panel) { e.stopPropagation(); setPanel(null) }
        else if (document.querySelector('.kn-panel')) return // 全文裡的原文面板開著：Esc 只關面板（面板自己處理）
        else onBack()
      }
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  })

  // 容器寬（決定寬版／窄版）
  useLayoutEffect(() => {
    const el = rootRef.current
    if (!el) return
    const m = () => setCw(Math.round(el.getBoundingClientRect().width))
    m()
    if (typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver(m)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  // 索引區黏在頂端：捲動容器是 .kn-root（position: fixed; overflow-y: auto），.kn-head 也黏在它的頂端，所以索引的 top 取 .kn-head 的高度。
  // 窄螢幕：捲過黏頂點（以 scrollTop 判斷、與索引高度無關，上下各 40px 遲滯）後切 compact，回到黏頂點之前恢復。桌機寬版不用精簡。
  useEffect(() => {
    const sc = sentinelRef.current?.closest<HTMLElement>('.kn-root') ?? null
    const target: HTMLElement | Window = sc ?? window
    const measureHead = () => setHeadH(document.querySelector<HTMLElement>('.kn-head')?.offsetHeight ?? 0)
    const onScroll = () => {
      const s = sentinelRef.current
      if (!s) return
      // PM 修正：自動捲動期間不切換精簡／完整，避免往上捲時索引又長高、把剛捲進來的主畫面蓋住
      if (Date.now() < autoScrollUntil.current) return
      if (wideRef.current) { if (compactRef.current) setCompact(false); return }
      const head = document.querySelector<HTMLElement>('.kn-head')?.offsetHeight ?? 0
      const scrollTop = sc ? sc.scrollTop : window.scrollY
      // sentinel 在捲動內容裡的絕對位置（它在索引之前，索引高度變化不影響它）；黏頂點＝它的位置 − .kn-head 高
      const stickTop = s.getBoundingClientRect().top - (sc ? sc.getBoundingClientRect().top : 0) + scrollTop - head
      const next = nextCompact(compactRef.current, scrollTop, stickTop)
      if (next !== compactRef.current) setCompact(next)
    }
    measureHead()
    target.addEventListener('scroll', onScroll, { passive: true })
    const onResize = () => { measureHead(); setVh(window.innerHeight) }
    window.addEventListener('resize', onResize)
    return () => { target.removeEventListener('scroll', onScroll); window.removeEventListener('resize', onResize) }
  }, [])

  // 索引圖高上限：完整 42vh／精簡 24vh（手機 34vh／20vh）；整張縮進去，不在框內垂直捲
  const maxH = Math.round(vh * (mobile ? (compact ? 0.2 : 0.34) : compact ? 0.24 : 0.42))

  // 桌機寬版：量圖的自然尺寸（viewBox）與 chips 高，算索引欄寬
  useLayoutEffect(() => {
    const svg = idxRef.current?.querySelector<SVGSVGElement>('svg.kn-dg-svg')
    const vb = svg?.viewBox?.baseVal
    const n = vb && vb.width > 0 && vb.height > 0 ? { w: vb.width, h: vb.height } : null
    setNat((o) => ((o && n && o.w === n.w && o.h === n.h) || (!o && !n) ? o : n))
    const ch = Math.round(chipsRef.current?.offsetHeight ?? 0)
    setChipsH((o) => (o === ch ? o : ch))
  })
  const availH = Math.max(240, vh - headH - chipsH - 32)
  const wideIdx = wide && nat ? wideIndexWidth(nat, availH, cw) : null
  const compactNow = wide ? false : compact

  // 換格子／組／題之後，主畫面頂端若被黏頂索引蓋住或在視窗下方，就平滑捲動讓它落在索引底部下方 8px；已在視窗內不捲
  const lastKey = useRef(`${where.topicId}|${where.sel}`)
  useEffect(() => {
    const key = `${where.topicId}|${where.sel}`
    if (lastKey.current === key) return
    lastKey.current = key
    const id = window.requestAnimationFrame(() => {
      const el = contentRef.current
      const idx = idxRef.current
      const sc = sentinelRef.current?.closest<HTMLElement>('.kn-root') ?? null
      if (!el || !sc) return
      const top = el.getBoundingClientRect().top
      // 寬版：索引在左欄，主畫面頂端只要落在 .kn-head 下方就算看得到
      const floor = wideRef.current || !idx ? headH : idx.getBoundingClientRect().bottom
      if (top >= floor && top < window.innerHeight - 40) return
      const delta = top - (floor + 8)
      autoScrollUntil.current = Date.now() + 700
      if (typeof sc.scrollBy === 'function') sc.scrollBy({ top: delta, behavior: 'smooth' })
      else sc.scrollTop += delta
    })
    return () => window.cancelAnimationFrame(id)
  }, [where.topicId, where.sel, headH])

  const cov = a ? stationCoverage(a) : { covered: 0, total: 0 }
  const flowNode = !groupKey && diagram?.type === 'flow' ? diagram.nodes.find((n) => n.id === sel) : undefined
  const card = groupKey === 'steps' ? orphans[0] : !groupKey ? (topic.steps ?? []).find((s) => s.node === sel) : undefined
  // 其他步驟卡（g:steps）：旁註只顯示第一張卡對應的站
  const sid: string | null = groupKey === 'steps' ? (a && orphans[0] ? a.stationOfClaim.get(orphans[0].claim) ?? null : null) : groupKey ? groupKey : a ? stationForNode(topic, a, sel) : null
  const station = sid ? stations.find((s) => s.id === sid) : undefined
  const info = diagram && !groupKey ? diagramNodeInfo(diagram, sel) : null
  const links = station && a ? a.links.get(station.id) : undefined
  const stBridges = station ? bridgesAt(bridges, topic.id, station.id) : []
  const stAiBridges = station ? aiBridgesAt(aiBridges, topic.id, station.id) : []
  const stAi = station && a ? a.ai.get(station.id) ?? [] : []
  const ctl = (item: { id: string; status: 'proposed' | 'confirmed' }) => <VerdictCtl v={verdictOf(verdicts, item)} onVote={(x) => vote(item.id, x)} />

  const nodeDots = useMemo(() => {
    const m = new Map<string, 'ins' | 'blind'>()
    if (!a || diagram?.type !== 'flow') return m
    for (const n of diagram.nodes) {
      if (n.shape !== 'step') continue
      const s = stationForNode(topic, a, n.id)
      if (isFallback && stations.find((x) => x.id === s)?.kind !== 'step') continue
      const has = s ? (a.links.get(s)?.insights.length ?? 0) > 0 || (a.ai.get(s)?.length ?? 0) > 0 : false
      m.set(n.id, has ? 'ins' : 'blind')
    }
    return m
  }, [a, diagram, topic, isFallback, stations])

  const targets = useMemo(() => {
    if (diagram?.type !== 'flow') return []
    return diagram.nodes.map((n) => {
      const no = isFallback ? stations.find((s) => s.id === n.id)?.stepNo : (() => { const i = (topic.steps ?? []).findIndex((s) => s.node === n.id); return i >= 0 ? i + 1 : undefined })()
      return no ? { id: n.id, label: n.label, stepNo: no } : { id: n.id, label: n.label }
    })
  }, [diagram, isFallback, stations, topic])

  const bullets = (list: Array<{ bid: string; b: Bullet }>, big: boolean) => list.map((sb) => <BulletView key={sb.bid} b={sb.b} t={topic} big={big} onSrc={(id) => setPanel({ key: id, q: '' })} />)
  const nodeDetail = <DiagramNodeDetail sel={info} topic={topic} quotes={quotes} onOpenSource={openSrc} />

  let label = ''
  let main: ReactNode = null
  if (groupKey) {
    label = groups.find((g) => g.key === groupKey)?.label ?? ''
    if (groupKey === 'steps') {
      main = <KnowledgeSteps key="orphans" t={topic} steps={orphans} pw={pw} onView={(n) => openSrc(n, '')} highlightStep={null}
        onGoDiagram={() => sentinelRef.current?.scrollIntoView?.({ behavior: 'smooth' })} />
    } else {
      const list = groupBullets(a?.parsed ?? null, groupKey)
      const fork = groupKey === 'decisions' ? forkFromText(list, targets) : null
      main = fork ? <KnowledgeFork fork={fork} onJump={select} /> : bullets(list.map((b, i) => ({ bid: `${groupKey}:${i}`, b })), list.length === 1)
    }
  } else if (diagram?.type === 'flow' && flowNode) {
    label = `${diagram.lanes[flowNode.lane] ?? ''}・${flowNode.shape === 'decision' ? '判斷點' : '步驟'}`
    if (card) {
      main = (
        <>
          <KnowledgeSteps key={card.id} t={topic} steps={[card]} pw={pw} onView={(n) => openSrc(n, '')} highlightStep={null} startNo={(topic.steps ?? []).indexOf(card) + 1}
            onGoDiagram={() => sentinelRef.current?.scrollIntoView?.({ behavior: 'smooth' })} />
          {station && <div className="kis-stbul">{bullets(station.bullets, false)}</div>}
        </>
      )
    } else if (flowNode.shape === 'decision') {
      const fork = isFallback ? (station ? forkFromText(station.bullets.map((x) => x.b), targets) : null) : forkFromFlow(diagram, sel)
      main = fork ? <KnowledgeFork fork={fork} onJump={select} /> : isFallback && station ? bullets(station.bullets, false) : nodeDetail
    } else if (isFallback && station) {
      main = bullets(station.bullets, station.kind === 'step' || station.bullets.length === 1)
    } else main = nodeDetail
  } else if (info) {
    label = info.heading.split('・')[0] ?? ''
    main = nodeDetail
  }

  const srcNums = [...new Set([...(station?.bullets.flatMap((x) => x.b.refs) ?? []), ...(info?.src ?? [])])].filter((n) => topic.sources[n - 1])
  const side = (
    <aside className="kis-side" data-testid="kis-side" aria-label="這一格的旁註">
      <h3 className="kis-dh">這一格的旁註</h3>
      {rejected.map((id) => (
        <p key={id} className="kis-undo">已否決，<button type="button" className="kis-vbtn" onClick={() => vote(id, 'undo')}>撤回</button></p>
      ))}
      {voteErr && <p className="kis-err" role="alert">{voteErr}</p>}
      {!station && (
        <p className="kis-none">這一格沒有掛心得。{flowNode?.shape === 'step' ? '盲點：這一步還沒有心得。' : ''}</p>
      )}
      {station && (
        <>
          <h4 className="kis-sec">這一格的心得</h4>
          {stAi.map((k) => <AiStepView key={k.id} k={k} insight={insightById.get(k.insight)} ctl={ctl(k)} />)}
          {stAi.length > 0 && links && links.insights.length > 0 && <h4 className="kis-sec">自動比對</h4>}
          {links && links.insights.length > 0
            ? links.insights.map((i) => (
              <div key={i.insightId} className="kis-ins">
                <span className="kis-tag">自動比對</span>
                <blockquote className="kis-quote">{i.quote}</blockquote>
                <span className="kis-date">{i.date}</span>
              </div>
            ))
            : stAi.length === 0 && <p className="kis-none">{station.kind === 'step' ? '盲點：這一步還沒有心得。' : '這一格沒有掛心得。'}</p>}
          <h4 className="kis-sec">橋</h4>
          {stAiBridges.map(({ bridge, others }) => (
            <div key={bridge.id} className="kis-ai kis-aib">
              <span className="kis-ai-tag">✦ AI</span> <b>{bridge.title}</b>
              <p>{bridge.text}</p>
              {others.map((o) => {
                const os = analyses.get(o.topicId)?.stations.find((s) => s.id === o.stationId)
                return <button key={`${o.topicId}:${o.stationId}`} type="button" className="kis-jump" onClick={() => onJump(o.topicId, o.stationId)}>→ {names.get(o.topicId) ?? o.topicId} · {os?.label ?? ''}</button>
              })}
              {ctl(bridge)}
            </div>
          ))}
          {stBridges.length > 0
            ? stBridges.map(({ bridge, others }) => (
              <div key={bridge.key} className="kis-br">
                <span className="kis-tag">自動比對</span> <b>{bridge.name}</b>
                {others.map((o) => {
                  const os = analyses.get(o.topicId)?.stations.find((s) => s.id === o.stationId)
                  return <button key={`${o.topicId}:${o.stationId}`} type="button" className="kis-jump" onClick={() => onJump(o.topicId, o.stationId)}>→ {names.get(o.topicId) ?? o.topicId} · {os?.label ?? ''}</button>
                })}
              </div>
            ))
            : stAiBridges.length === 0 && <p className="kis-none">這一格沒有和別的題目共用步驟。</p>}
          {links && links.rules.length > 0 && (
            <>
              <h4 className="kis-sec">這一步的規定依據</h4>
              <ul className="kis-rules">
                {links.rules.map((r) => <li key={`${r.article}:${r.claim}`}><strong>{r.article}</strong> {r.text}</li>)}
              </ul>
            </>
          )}
        </>
      )}
      {card && card.cases.length > 0 && (
        <>
          <h4 className="kis-sec">用過的案件</h4>
          <ul className="kis-rules">{card.cases.map((c) => <li key={c.case}>{c.case}<span className="kis-date"> {c.date}</span></li>)}</ul>
        </>
      )}
      {srcNums.length > 0 && (
        <>
          <h4 className="kis-sec">來源</h4>
          <div className="kis-srcs">
            {srcNums.map((n) => <button key={n} type="button" className="kis-jump" onClick={() => openSrc(n, quoteQueryFor(quotes, n))}>{n}　{topic.sources[n - 1]?.title}</button>)}
          </div>
        </>
      )}
      {myLinks.length > 0 && (
        <>
          <h4 className="kis-sec">AI 編織（這一題）</h4>
          {myLinks.map((k) => (
            <div key={k.id} className="kis-ai"><span className="kis-ai-tag">✦ AI</span><p>{k.text}</p><span className="kis-date">{CONF_SHORT[k.confidence]}</span></div>
          ))}
        </>
      )}
      <h4 className="kis-sec">盲點</h4>
      <p className="kis-none">{cov.total > 0 ? `${cov.total} 站裡 ${cov.covered} 站掛了心得` : '這一題沒有步驟可對應心得。'}</p>
    </aside>
  )

  const indexEl = (diagram || groups.length > 0) && (
      <div ref={idxRef} className="kis-index" data-testid="kis-index" data-compact={compactNow} data-wide={wide || undefined} style={wide ? { top: headH, maxHeight: Math.max(240, vh - headH - 16) } : { top: headH }}>
        {diagram && (
          <KnowledgeDiagram
            topic={topic} diagram={diagram} quotes={quotes} onOpenSource={openSrc} now={now}
            selectedNode={groupKey ? null : sel} onSelectNode={select} nodeDots={nodeDots} compact={compactNow} maxH={maxH} fitWidth={wide} hideDetail hideLegend
          />
        )}
        {groups.length > 0 && (
          <div ref={chipsRef} className="kis-groups" role="group" aria-label="內容分組">
            {groups.map((g) => (
              <button key={g.key} type="button" className="kis-grp" aria-pressed={sel === `g:${g.key}`} onClick={() => select(`g:${g.key}`)}>{g.label}<em>{g.n}</em></button>
            ))}
          </div>
        )}
      </div>
  )

  const summary = a?.parsed?.summary ? stripMarks(a.parsed.summary.text) : ''
  return (
    <div ref={rootRef} className="kis-root kis-in" style={cvar(color)} data-testid="kis-inside">
      <div className="kis-in-head">
        <button type="button" className="kn-btn" onClick={onBack}>‹ 全景</button>
        <h2 className="kis-in-name">{island.name}</h2>
        <div className="kis-tabs" role="tablist">
          {island.topics.map((t) => {
            const ta = analyses.get(t.id)
            return (
              <button
                key={t.id} type="button" role="tab" aria-selected={t.id === topic.id}
                className={`kis-tab${ta?.seed ? ' kis-seed' : ''}`}
                onClick={() => setWhere({ island: island.id, topicId: t.id, sel: ta ? defaultSelection(t, ta, indexDiagramOf(t, ta)) ?? '' : '' })}
              >{t.name}</button>
            )
          })}
        </div>
      </div>

      <div className="kis-title" data-testid="kis-title">
        <h3 className="kis-tn">{topic.name}</h3>
        <span className="kn-kind" data-kind={topic.kind}>{kindLabel(topic.kind)}</span>
        {summary && <p className="kis-sum">{summary}</p>}
        <button type="button" className={`kis-bandbtn${band ? ' kis-on' : ''}`} aria-expanded={band} onClick={() => setBand((x) => !x)}>資訊帶</button>
      </div>
      {band && (
        <div className="kis-band" data-testid="kis-band">
          <ReaderSide t={topic} data={data} onOpen={onOpen} />
          <div className="kis-fullwrap">
            <button type="button" className="kn-btn" aria-expanded={full} onClick={() => setFull((x) => !x)}>{full ? '收起全文與更正' : '全文與更正'}</button>
            {full && <KnowledgeReader key={topic.id} topic={topic} data={data} pw={pw} now={now} onOpen={onOpen} hideDiagram hideSide />}
          </div>
        </div>
      )}

      {seedLike ? (
        <div className="kis-seedbox">
          <p className="kis-big">還在累積</p>
          <p className="kis-l">這一題的頁面還沒有長出來，等累積到足夠的資料才會有做事順序。</p>
          {myLinks.map((k) => <div key={k.id} className="kis-ai"><span className="kis-ai-tag">✦ AI</span><p>{k.text}</p></div>)}
        </div>
      ) : (
        <>
          <div ref={sentinelRef} className="kis-sentinel" aria-hidden="true" />
          {!wide && indexEl}
          <div className="kis-split" data-wide={wide2 ? '2' : wide ? '1' : undefined} style={wide ? { gridTemplateColumns: `${wideIdx ? wideIdx.width : 480}px minmax(0, 1fr)${wide2 ? ' minmax(300px, 0.45fr)' : ''}` } : undefined}>
            {wide && indexEl}
            <section className="kis-content" data-testid="kis-content" ref={contentRef}>
              <div className="kis-ch">
                <span className="kis-kind">{label}</span>
                <span className="kis-nav">
                  <button type="button" disabled={navIdx <= 0} onClick={() => move(-1)}>← 上一格</button>
                  <button type="button" disabled={navIdx < 0 || navIdx >= navList.length - 1} onClick={() => move(1)}>下一格 →</button>
                </span>
              </div>
              {main ?? <p className="kis-none">這一題還沒有可以顯示的內容。</p>}
            </section>
            {side}
          </div>
        </>
      )}
      {panel && <KnowledgeSourcePanel pw={pw} sourceKey={panel.key} query={panel.q} onClose={() => setPanel(null)} onOpenTopic={onOpen} />}
    </div>
  )
}
