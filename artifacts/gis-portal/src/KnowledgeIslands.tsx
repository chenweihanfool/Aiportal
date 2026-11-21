import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react'
import { KnowledgeSourcePanel } from './KnowledgeSourcePanel'
import { apiFetchWeave } from './insightWeaveApi'
import { paletteColor, type PaletteTheme } from './insightPalette'
import { useAsync } from './homeHooks'
import {
  analyzeTopic, bridgesAt, buildIslandModel, cardMark, cardRect, computeBridges, fitView, islandSize, islandStats, kbLinksFor, layoutSea, stationCoverage, stationKindLabel, zoomAt,
  CARD_H, CARD_W, DOMAIN_HEAD_H, ISL_LABEL_H, type Bridge, type IslandModelIsland, type Placed, type Station, type TopicAnalysis, type View,
} from './knowledgeIslands'
import { buildTree, stripMarks, type Bullet, type Topic, type TopicsData } from './knowledgeView'
import type { KbLink } from './insightWeave'

// 知識島（3.18.0）：知識頁的「島嶼」視圖。島＝知識樹的枝；點島飛入後橫軸是該題的做事順序（SOP）；疊加層顯示心得掛在哪一步、共用步驟（橋）與盲點。
// 互動與外觀照首頁心得島（InsightIslands）；純函式在 knowledgeIslands.ts，樣式在 portal.css 的 kis-*。

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

export function KnowledgeIslands({ data, pw, onOpen }: { data: TopicsData; pw: string; onOpen: (id: string) => void }) {
  const theme = useTheme()
  const mobile = useMobile()
  const model = useMemo(() => buildIslandModel(buildTree(data)), [data])
  const analyses = useMemo(() => new Map(data.topics.map((t) => [t.id, analyzeTopic(t)])), [data])
  const bridges = useMemo(() => computeBridges([...analyses.values()]), [analyses])
  const names = useMemo(() => new Map(data.topics.map((t) => [t.id, t.name])), [data])
  const weave = useAsync(pw, apiFetchWeave)
  const kbLinks: readonly KbLink[] | null = weave.data?.kbLinks ?? null
  const [where, setWhere] = useState<Where | null>(null)
  const [hover, setHover] = useState<string | null>(null)

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
  const enter = (islandId: string, topicId?: string) => {
    const e = islandById.get(islandId)
    if (!e) return
    const t = (topicId ? e.island.topics.find((x) => x.id === topicId) : undefined) ?? e.island.topics.find((x) => !analyses.get(x.id)?.seed) ?? e.island.topics[0]
    if (t) setWhere({ island: islandId, topicId: t.id, stationId: firstStation(t.id) })
  }
  const go = (topicId: string, stationId?: string) => {
    const e = islandOf.get(topicId)
    if (e) setWhere({ island: e.island.id, topicId, stationId: stationId ?? firstStation(topicId) })
  }

  if (model.length === 0) return <p className="kn-empty">還沒有可以畫成島的題目。</p>
  if (where) {
    const e = islandById.get(where.island)
    if (e) {
      return (
        <IslandInside
          key={where.island} island={e.island} color={colorOf(e.slot)} where={where} setWhere={setWhere} analyses={analyses} bridges={bridges} kbLinks={kbLinks}
          pw={pw} onBack={() => setWhere(null)} onOpen={onOpen} onJump={go} names={names}
        />
      )
    }
  }
  if (mobile) {
    return (
      <div className="kis-root kis-mobile" data-testid="kis-overview">
        {model.map((d) => (
          <section key={d.id} className="kis-m-dom">
            <h2 className="kis-m-domh">{d.name}</h2>
            {d.islands.map((i) => {
              const st = islandStats(i, analyses, bridges)
              return (
                <button key={i.id} type="button" className="kis-m-isl" style={cvar(colorOf(d.slot))} onClick={() => enter(i.id)}>
                  <b>{i.name}</b>
                  <span>{i.topics.length} 題 · 💬 {st.insights}</span>
                </button>
              )
            })}
          </section>
        ))}
      </div>
    )
  }
  return <Sea model={model} analyses={analyses} bridges={bridges} kbLinks={kbLinks} colorOf={colorOf} hover={hover} setHover={setHover} onEnter={enter} />
}

/* ───────── 全景 ───────── */

function Sea({ model, analyses, bridges, kbLinks, colorOf, hover, setHover, onEnter }: {
  model: ReturnType<typeof buildIslandModel>
  analyses: ReadonlyMap<string, TopicAnalysis>
  bridges: readonly Bridge[]
  kbLinks: readonly KbLink[] | null
  colorOf: (slot: number) => string
  hover: string | null
  setHover: (id: string | null) => void
  onEnter: (islandId: string, topicId?: string) => void
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

  const hovered = hover ? model.flatMap((d) => d.islands).find((i) => i.id === hover) ?? null : null
  const lines: Array<{ key: string; d: string; name: string; mx: number; my: number }> = []
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
            const x1 = p.x + p.w / 2, y1 = p.y + p.h / 2, x2 = q.x + q.w / 2, y2 = q.y + q.h / 2
            const mx = (x1 + x2) / 2, my = (y1 + y2) / 2 - Math.min(80, Math.hypot(x2 - x1, y2 - y1) / 6)
            lines.push({ key: k, d: `M${x1},${y1} Q${mx},${my} ${x2},${y2}`, name: bridge.name, mx, my })
          }
        }
      }
    }
  }
  const stats = hovered ? islandStats(hovered, analyses, bridges) : null

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
                    <span className="kis-ln-name">{i.name}</span><span className="kis-ln-sub">{i.topics.length} 題</span>
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
                  <path d={l.d} className="kis-bridge" />
                  <text x={l.mx} y={l.my} className="kis-bridge-t" textAnchor="middle">{l.name}</text>
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

function IslandInside({ island, color, where, setWhere, analyses, bridges, kbLinks, pw, onBack, onOpen, onJump, names }: {
  island: IslandModelIsland
  color: string
  where: { island: string; topicId: string; stationId: string }
  setWhere: (w: { island: string; topicId: string; stationId: string }) => void
  analyses: ReadonlyMap<string, TopicAnalysis>
  bridges: readonly Bridge[]
  kbLinks: readonly KbLink[] | null
  pw: string
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
  const pick = (i: number) => { const s = stations[i]; if (s) setWhere({ island: island.id, topicId: topic.id, stationId: s.id }) }
  const myLinks = kbLinksFor(kbLinks, topic)
  const insightCount = (a?.insightIds.size ?? 0)
  const ovCount = insightCount + myLinks.length

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tg = e.target as HTMLElement | null
      if (tg && (tg.tagName === 'INPUT' || tg.tagName === 'TEXTAREA' || tg.isContentEditable)) return
      if (e.key === 'ArrowLeft') { e.preventDefault(); pick(Math.max(0, idx - 1)) }
      else if (e.key === 'ArrowRight') { e.preventDefault(); pick(Math.min(stations.length - 1, idx + 1)) }
      else if (e.key === 'Escape') { if (panel) setPanel(null); else onBack() }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
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

  const drawer = ov && (
    <aside className="kis-drawer" data-testid="kis-drawer" aria-label="疊加層">
      <h3 className="kis-dh">✦ 疊加層</h3>
      {station && (
        <>
          <h4 className="kis-sec">這一站的心得</h4>
          {links && links.insights.length > 0
            ? links.insights.map((i) => (
              <div key={i.insightId} className="kis-ins">
                <span className="kis-tag">自動比對</span>
                <blockquote className="kis-quote">{i.quote}</blockquote>
                <span className="kis-date">{i.date}</span>
              </div>
            ))
            : <p className="kis-none">{station.kind === 'step' ? '盲點：這一站還沒有心得。' : '這一站沒有掛心得。'}</p>}
          {myLinks.length > 0 && (
            <>
              <h4 className="kis-sec">AI 編織（這一題）</h4>
              {myLinks.map((k) => (
                <div key={k.id} className="kis-ai"><span className="kis-ai-tag">✦ AI</span><p>{k.text}</p><span className="kis-date">{k.confidence === 'high' ? '把握高' : k.confidence === 'mid' ? '把握中' : '把握低'}</span></div>
              ))}
            </>
          )}
          <h4 className="kis-sec">橋</h4>
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
            : <p className="kis-none">這一站沒有和別的題目共用步驟。</p>}
        </>
      )}
      <h4 className="kis-sec">盲點</h4>
      <p className="kis-none">{cov.total > 0 ? `${cov.total} 站裡 ${cov.covered} 站掛了心得` : '這一題沒有步驟可對應心得。'}</p>
    </aside>
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

      {a?.seed || !station ? (
        <div className="kis-seedbox">
          <p className="kis-big">還在累積</p>
          <p className="kis-l">這一題的頁面還沒有長出來，等累積到足夠的資料才會有做事順序。</p>
          {myLinks.map((k) => <div key={k.id} className="kis-ai"><span className="kis-ai-tag">✦ AI</span><p>{k.text}</p></div>)}
          <button type="button" className="kn-btn" onClick={() => onOpen(topic.id)}>完整頁面</button>
        </div>
      ) : (
        <>
          <div className="kis-rail" ref={railRef} data-testid="kis-rail">
            {stations.map((s, i) => {
              const l = a?.links.get(s.id)
              const n = l?.insights.length ?? 0
              const b = bridgesAt(bridges, topic.id, s.id).length
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
          <div className={`kis-body${ov ? ' kis-body-ov' : ''}`}>
            <section className="kis-content" data-testid="kis-content">
              <div className="kis-ch">
                <span className="kis-kind">{stationKindLabel(station.kind)}{station.stepNo ? ` ${station.stepNo}` : ''}</span>
                <span className="kis-nav">
                  <button type="button" disabled={idx === 0} onClick={() => pick(idx - 1)}>← 上一步</button>
                  <button type="button" disabled={idx >= stations.length - 1} onClick={() => pick(idx + 1)}>下一步 →</button>
                </span>
                <button type="button" className="kn-btn" onClick={() => onOpen(topic.id)}>完整頁面</button>
              </div>
              {station.bullets.map((sb) => <BulletView key={sb.bid} b={sb.b} t={topic} big={station.kind === 'step' || station.bullets.length === 1} onSrc={setPanel} />)}
            </section>
            {drawer}
          </div>
        </>
      )}
      {(a?.seed || !station) && drawer}
      {panel && <KnowledgeSourcePanel pw={pw} sourceKey={panel} query="" onClose={() => setPanel(null)} onOpenTopic={onOpen} />}
    </div>
  )
}
