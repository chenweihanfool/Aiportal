import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react'
import { KnowledgeSourcePanel } from './KnowledgeSourcePanel'
import { apiFetchVerdicts, apiFetchWeave, apiPostVerdict } from './insightWeaveApi'
import { apiFetchInsights } from './insightApi'
import { paletteColor, type PaletteTheme } from './insightPalette'
import { useAsync } from './homeHooks'
import {
  aiBridgesAt, analyzeTopic, bridgesAt, buildIslandModel, cardMark, cardRect, computeBridges, fitView, islandSize, islandStats, kbLinksFor, layoutSea, resolveStepBridges, stationCoverage, stationKindLabel, zoomAt,
  CARD_H, CARD_W, DOMAIN_HEAD_H, ISL_LABEL_H, type AiBridge, type Bridge, type IslandModelIsland, type Placed, type Station, type TopicAnalysis, type View,
} from './knowledgeIslands'
import { buildTree, recentChangeOf, stripMarks, type Bullet, type Topic, type TopicsData } from './knowledgeView'
import { KnowledgeReader } from './KnowledgeReader'
import { formatKnowledgeHash, parseKnowledgeHash, type KnowledgeRoute } from './knowledgeRoute'
import { RELATION_TEXT, foldVerdicts, verdictOf, type KbLink, type KbStep } from './insightWeave'
import type { Insight } from './insightModel'

// 知識島（3.18.0）：知識頁的「島嶼」視圖。島＝知識樹的枝；點島飛入後橫軸是該題的做事順序（SOP）；疊加層顯示心得掛在哪一步、共用步驟（橋）與盲點。
// 互動與外觀照首頁心得島（InsightIslands）；純函式在 knowledgeIslands.ts，樣式在 portal.css 的 kis-*。
// 3.21.0：知識頁只剩這一種畫面。進島狀態與網址（#knowledge／#knowledge/<id>／#knowledge/<id>/s/<站>）同步，閱讀區（KnowledgeReader）在島內展開。

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

interface Where { island: string; topicId: string; stationId: string }
const cvar = (c: string): CSSProperties => ({ ['--c' as string]: c })

const NOT_FOUND_TEXT = '找不到這個題目（可能已移除，或還沒推送到）。'

/** 島內網址：閱讀區展開＝#knowledge/<id>；收起＝#knowledge/<id>/s/<站> */
function hashOf(w: Where, reader: boolean): string {
  return formatKnowledgeHash({ view: 'topic', topicId: w.topicId, stationId: reader || !w.stationId ? null : w.stationId })
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

  const firstStation = (topicId: string): string => analyses.get(topicId)?.stations[0]?.id ?? ''
  /** 網址 → 進島狀態：找不到題目回 null（留在全景並顯示找不到） */
  const resolve = (r: KnowledgeRoute): { where: Where; reader: boolean } | null | 'overview' => {
    if (r.view === 'overview') return 'overview'
    const e = islandOf.get(r.topicId)
    if (!e) return null
    const sts = analyses.get(r.topicId)?.stations ?? []
    const sid = r.stationId !== null && sts.some((s) => s.id === r.stationId) ? r.stationId : firstStation(r.topicId)
    return { where: { island: e.island.id, topicId: r.topicId, stationId: sid }, reader: r.stationId === null }
  }
  const [init] = useState(() => {
    const r = parseKnowledgeHash(window.location.hash) ?? { view: 'overview' as const }
    return { r, x: resolve(r) }
  })
  const [where, setWhereRaw] = useState<Where | null>(() => (init.x && init.x !== 'overview' ? init.x.where : null))
  const [reader, setReaderRaw] = useState<boolean>(() => (init.x && init.x !== 'overview' ? init.x.reader : false))
  const [notFound, setNotFound] = useState<boolean>(() => init.r.view === 'topic' && init.x === null)

  // 外部網址變動（連結、上一頁）→ 套用到進島狀態。replaceState 不會觸發 hashchange，所以島內切換不會回頭打自己。
  const resolveRef = useRef(resolve)
  resolveRef.current = resolve
  useEffect(() => {
    const onHash = () => {
      const r = parseKnowledgeHash(window.location.hash)
      if (!r) return
      const x = resolveRef.current(r)
      if (x === 'overview') { setWhereRaw(null); setReaderRaw(false); setNotFound(false) }
      else if (x === null) { setWhereRaw(null); setReaderRaw(false); setNotFound(true) }
      else { setWhereRaw(x.where); setReaderRaw(x.reader); setNotFound(false) }
    }
    window.addEventListener('hashchange', onHash)
    return () => window.removeEventListener('hashchange', onHash)
  }, [])

  // 島內切題分頁、切站、開收閱讀區：寫回網址但不新增歷史
  const writeHash = (h: string) => { try { window.history.replaceState(null, '', h) } catch { /* 寫不進去就只在畫面上有效 */ } }
  // 第二參數 rd：切站時傳 false 收起閱讀區；切題分頁不傳，維持目前閱讀區狀態（PM 修正）
  const setWhere = (w: Where, rd: boolean = reader) => { setWhereRaw(w); setReaderRaw(rd); writeHash(hashOf(w, rd)) }
  const setReader = (b: boolean) => { setReaderRaw(b); if (where) writeHash(hashOf(where, b)) }
  const navTopic = (topicId: string, stationId: string | null) => { window.location.hash = formatKnowledgeHash({ view: 'topic', topicId, stationId }) }
  // 從全景點島：用一般導航（新增歷史，上一頁回得到全景）寫成第一個非 seed 題目的第一站，狀態由 hashchange 套用
  const enter = (islandId: string, topicId?: string) => {
    const e = islandById.get(islandId)
    if (!e) return
    const t = (topicId ? e.island.topics.find((x) => x.id === topicId) : undefined) ?? e.island.topics.find((x) => !analyses.get(x.id)?.seed) ?? e.island.topics[0]
    if (t) navTopic(t.id, firstStation(t.id) || null)
  }
  const go = (topicId: string, stationId?: string) => {
    const e = islandOf.get(topicId)
    if (!e) return
    const w = { island: e.island.id, topicId, stationId: stationId ?? firstStation(topicId) }
    setWhereRaw(w); setReaderRaw(false); writeHash(hashOf(w, false))
  }
  /** 閱讀區裡點同枝／跨枝題目、原文面板的題目：切到該題並展開閱讀區 */
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
          pw={pw} now={now} data={data} reader={reader} setReader={setReader} onBack={backToOverview} onOpen={openTopic} onJump={go} names={names}
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

function IslandInside({ island, color, where, setWhere, analyses, bridges, aiBridges, kbLinks, verdicts, rejected, voteErr, vote, insightById, pw, now, data, reader, setReader, onBack, onOpen, onJump, names }: {
  island: IslandModelIsland
  color: string
  where: { island: string; topicId: string; stationId: string }
  setWhere: (w: { island: string; topicId: string; stationId: string }, reader?: boolean) => void
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
  reader: boolean
  setReader: (b: boolean) => void
  onBack: () => void
  onOpen: (id: string) => void
  onJump: (topicId: string, stationId?: string) => void
  names: ReadonlyMap<string, string>
}) {
  const [ov, setOv] = useState(false)
  const [panel, setPanel] = useState<string | null>(null)
  const railRef = useRef<HTMLDivElement>(null)
  const topic = island.topics.find((t) => t.id === where.topicId) ?? island.topics[0]!
  const a = analyses.get(topic.id)
  const stations: Station[] = a?.stations ?? []
  const idx = Math.max(0, stations.findIndex((s) => s.id === where.stationId))
  const station = stations[idx]
  const pick = (i: number) => { const s = stations[i]; if (s) setWhere({ island: island.id, topicId: topic.id, stationId: s.id }, false) }
  const myLinks = kbLinksFor(kbLinks, topic)
  const insightCount = (a?.insightIds.size ?? 0)
  const ovCount = insightCount + myLinks.length

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tg = e.target as HTMLElement | null
      if (tg && (tg.tagName === 'INPUT' || tg.tagName === 'TEXTAREA' || tg.isContentEditable)) return
      if (e.key === 'ArrowLeft') { e.preventDefault(); pick(Math.max(0, idx - 1)) }
      else if (e.key === 'ArrowRight') { e.preventDefault(); pick(Math.min(stations.length - 1, idx + 1)) }
      // PM 修正：來源面板開著時 Esc 只關面板（捕獲階段先攔，避免面板關掉後同一次事件又退回全景）
      else if (e.key === 'Escape') {
        if (panel) { e.stopPropagation(); setPanel(null) }
        else if (document.querySelector('.kn-panel')) return // 閱讀區的原文面板開著：Esc 只關面板（面板自己處理）
        else onBack()
      }
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  })

  // 選中的站置中
  useEffect(() => {
    const rail = railRef.current
    const btn = rail?.querySelector<HTMLElement>('[aria-current="step"]')
    if (!rail || !btn) return
    const left = btn.offsetLeft - rail.clientWidth / 2 + btn.clientWidth / 2
    if (typeof rail.scrollTo === 'function') rail.scrollTo({ left, behavior: 'smooth' })
    else rail.scrollLeft = left
  }, [station?.id, topic.id])

  const cov = a ? stationCoverage(a) : { covered: 0, total: 0 }
  const links = station && a ? a.links.get(station.id) : undefined
  const stBridges = station ? bridgesAt(bridges, topic.id, station.id) : []
  const stAiBridges = station ? aiBridgesAt(aiBridges, topic.id, station.id) : []
  const stAi = station && a ? a.ai.get(station.id) ?? [] : []
  const ctl = (item: { id: string; status: 'proposed' | 'confirmed' }) => <VerdictCtl v={verdictOf(verdicts, item)} onVote={(x) => vote(item.id, x)} />

  const drawer = ov && (
    <aside className="kis-drawer" data-testid="kis-drawer" aria-label="疊加層">
      <h3 className="kis-dh">✦ 疊加層</h3>
      {rejected.map((id) => (
        <p key={id} className="kis-undo">已否決，<button type="button" className="kis-vbtn" onClick={() => vote(id, 'undo')}>撤回</button></p>
      ))}
      {voteErr && <p className="kis-err" role="alert">{voteErr}</p>}
      {station && (
        <>
          <h4 className="kis-sec">這一站的心得</h4>
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
            : stAi.length === 0 && <p className="kis-none">{station.kind === 'step' ? '盲點：這一站還沒有心得。' : '這一站沒有掛心得。'}</p>}
          {myLinks.length > 0 && (
            <>
              <h4 className="kis-sec">AI 編織（這一題）</h4>
              {myLinks.map((k) => (
                <div key={k.id} className="kis-ai"><span className="kis-ai-tag">✦ AI</span><p>{k.text}</p><span className="kis-date">{k.confidence === 'high' ? '把握高' : k.confidence === 'mid' ? '把握中' : '把握低'}</span></div>
              ))}
            </>
          )}
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
                  const ot = analyses.get(o.topicId)
                  const os = ot?.stations.find((s) => s.id === o.stationId)
                  return <button key={`${o.topicId}:${o.stationId}`} type="button" className="kis-jump" onClick={() => onJump(o.topicId, o.stationId)}>→ {names.get(o.topicId) ?? o.topicId} · {os?.label ?? ''}</button>
                })}
              </div>
            ))
            : stAiBridges.length === 0 && <p className="kis-none">這一站沒有和別的題目共用步驟。</p>}
        </>
      )}
      <h4 className="kis-sec">盲點</h4>
      <p className="kis-none">{cov.total > 0 ? `${cov.total} 站裡 ${cov.covered} 站掛了心得` : '這一題沒有步驟可對應心得。'}</p>
    </aside>
  )

  const rail = (
          <div className="kis-rail" ref={railRef} data-testid="kis-rail">
    {stations.map((s, i) => {
      const l = a?.links.get(s.id)
      const n = new Set([...(l?.insights ?? []).map((x) => x.insightId), ...(a?.ai.get(s.id) ?? []).map((x) => x.insight)]).size
      const b = bridgesAt(bridges, topic.id, s.id).length + aiBridgesAt(aiBridges, topic.id, s.id).length
      return (
        <button key={s.id} type="button" className={`kis-st kis-k-${s.kind}${i === idx ? ' kis-cur' : ''}`} aria-current={i === idx ? 'step' : undefined} onClick={() => pick(i)}>
          <span className="kis-st-no">{s.stepNo ?? '•'}</span>
          <span className="kis-st-l">{s.label}</span>
          {ov && (
            <span className="kis-st-m">
              {n > 0 && <em>💬{n}</em>}
              {b > 0 && <em>⇄{b}</em>}
              {s.kind === 'step' && n === 0 && <em className="kis-blind">盲點</em>}
            </span>
          )}
        </button>
      )
    })}
  </div>
  )

  return (
    <div className="kis-root kis-in" style={cvar(color)} data-testid="kis-inside">
      <div className="kis-in-head">
        <button type="button" className="kn-btn" onClick={onBack}>‹ 全景</button>
        <h2 className="kis-in-name">{island.name}</h2>
        <div className="kis-tabs" role="tablist">
          {island.topics.map((t) => (
            <button
              key={t.id} type="button" role="tab" aria-selected={t.id === topic.id}
              className={`kis-tab${analyses.get(t.id)?.seed ? ' kis-seed' : ''}`}
              onClick={() => setWhere({ island: island.id, topicId: t.id, stationId: analyses.get(t.id)?.stations[0]?.id ?? '' })}
            >{t.name}</button>
          ))}
        </div>
        <button type="button" className={`kis-ovbtn${ov ? ' kis-on' : ''}`} aria-pressed={ov} onClick={() => setOv((x) => !x)}>✦ 疊加層{ovCount > 0 ? `（${ovCount}）` : ''}</button>
      </div>

      {reader ? (
        <>
          {a?.seed || !station ? null : rail}
          <div className={`kis-body${ov ? ' kis-body-ov' : ''}`}>
            <section className="kis-content krd-slot" data-testid="krd-slot">
              <div className="kis-ch">
                <span className="kis-kind">完整頁面</span>
                <button type="button" className="kn-btn" onClick={() => setReader(false)}>回到這一站</button>
              </div>
              <KnowledgeReader key={topic.id} topic={topic} data={data} pw={pw} now={now} onOpen={onOpen} />
            </section>
            {drawer}
          </div>
        </>
      ) : (
        <>
      {a?.seed || !station ? (
        <div className="kis-seedbox">
          <p className="kis-big">還在累積</p>
          <p className="kis-l">這一題的頁面還沒有長出來，等累積到足夠的資料才會有做事順序。</p>
          {myLinks.map((k) => <div key={k.id} className="kis-ai"><span className="kis-ai-tag">✦ AI</span><p>{k.text}</p></div>)}
          <button type="button" className="kn-btn" onClick={() => setReader(true)}>完整頁面</button>
        </div>
      ) : (
        <>
          {rail}
          <div className={`kis-body${ov ? ' kis-body-ov' : ''}`}>
            <section className="kis-content" data-testid="kis-content">
              <div className="kis-ch">
                <span className="kis-kind">{stationKindLabel(station.kind)}{station.stepNo ? ` ${station.stepNo}` : ''}</span>
                <span className="kis-nav">
                  <button type="button" disabled={idx === 0} onClick={() => pick(idx - 1)}>← 上一步</button>
                  <button type="button" disabled={idx >= stations.length - 1} onClick={() => pick(idx + 1)}>下一步 →</button>
                </span>
                <button type="button" className="kn-btn" onClick={() => setReader(true)}>完整頁面</button>
              </div>
              {station.bullets.map((sb) => <BulletView key={sb.bid} b={sb.b} t={topic} big={station.kind === 'step' || station.bullets.length === 1} onSrc={setPanel} />)}
            </section>
            {drawer}
          </div>
        </>
      )}
        </>
      )}
      {!reader && (a?.seed || !station) && drawer}
      {panel && <KnowledgeSourcePanel pw={pw} sourceKey={panel} query="" onClose={() => setPanel(null)} onOpenTopic={onOpen} />}
    </div>
  )
}
