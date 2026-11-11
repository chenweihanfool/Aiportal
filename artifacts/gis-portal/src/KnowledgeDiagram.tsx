import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent, type ReactNode, type RefObject } from 'react'
import type { HermesTopicQuote } from './hermesDocApi'
import type { FlowDiagram, MapDiagram, Topic, TopicDiagram, TimelineDiagram } from './knowledgeView'
import {
  FLOW_CONST, STRENGTH_TEXT, layoutFlow, layoutMap, layoutTimeline, quoteQueryFor, strengthOf,
  type Strength,
} from './knowledgeDiagramLayout'

// 知識頁圖解（2.81.0）：題目頁「一句話」下方的 SVG 圖。流程題＝泳道圖、時間題＝多軌時間軸、概念題＝觀察→框架→判斷。
// 點任一格 → 說明區（label、sub、note、證據強度、來源清單）→ 點來源 → 開既有的原文面板（帶 2.77 的原文句當 q）。
// 版面座標在 knowledgeDiagramLayout.ts（純函式、有測試）；樣式在 portal.css 的 kn-dg-*。

interface Selected {
  key: string
  heading: string
  sub?: string
  note?: string
  strength: Strength
  unknown: boolean
  src: number[]
}

interface Props {
  topic: Topic
  diagram: TopicDiagram
  /** 2.77 的 topic doc quotes；用來決定開原文面板時標亮哪一句 */
  quotes: readonly HermesTopicQuote[] | null
  /** n＝1 起算的來源序號，q＝要標亮的原文句（可為空字串） */
  onOpenSource: (n: number, q: string) => void
  /** 可注入的「現在」（測試用）；預設 new Date() */
  now?: Date
}

const onKey = (act: () => void) => (e: KeyboardEvent) => {
  if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); act() }
}

const ariaOf = (label: string, s: Strength, unknown: boolean) => `${label}（${STRENGTH_TEXT[s]}${unknown ? '，還不知道' : ''}）`

function Legend({ type }: { type: TopicDiagram['type'] }) {
  return (
    <div className="kn-dg-legend" aria-label="圖例">
      <span><i className="kn-dg-sw" data-ev="multi" />多份來源</span>
      <span><i className="kn-dg-sw" data-ev="one" />僅一例</span>
      <span><i className="kn-dg-sw" data-ev="ai" />AI 續寫，待驗證</span>
      <span><b className="kn-dg-q">？</b>還不知道</span>
      {type === 'flow' && <><span>◇ 判斷點</span><span><b className="kn-dg-warn">⚠</b>踩過的坑</span><span>- - → 退回重排</span></>}
      {type === 'timeline' && <><span>◌ 推估（依過去間隔中位數）</span><span><i className="kn-dg-today" />今天</span></>}
    </div>
  )
}

function NodeText({ label, sub, w, h }: { label: string; sub?: string; w: number; h: number }) {
  return (
    <foreignObject x={0} y={0} width={w} height={h} pointerEvents="none">
      <div className="kn-dg-nbox"><b>{label}</b>{sub && <small>{sub}</small>}</div>
    </foreignObject>
  )
}

/* ───────── flow ───────── */

function FlowSvg({ d, sel, onPick }: { d: FlowDiagram; sel: string | null; onPick: (s: Selected) => void }) {
  const uid = useId().replace(/:/g, '')
  const lay = useMemo(() => layoutFlow(d), [d])
  const meta = new Map(d.nodes.map((n) => [n.id, n]))
  return (
    <svg className="kn-dg-svg" viewBox={`0 0 ${lay.width} ${lay.height}`} width="100%" style={{ maxWidth: lay.width, minWidth: Math.round(lay.width * 0.6) }} role="group" aria-label="流程泳道圖">
      <defs>
        <marker id={`${uid}-ar`} viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse" className="kn-dg-marker">
          <path d="M0 0L10 5L0 10z" fill="currentColor" />
        </marker>
      </defs>
      {lay.lanes.map((l, i) => (
        <g key={l.label + i}>
          <rect className="kn-dg-lane" data-odd={i % 2} x={0} y={l.y} width={lay.width} height={l.h} />
          <text className="kn-dg-lanename" x={14} y={l.y + l.h / 2 + 5}>{l.label}</text>
        </g>
      ))}
      {lay.phases.map((p, i) => (
        <g key={p.label + i}>
          <text className="kn-dg-phase" x={p.cx} y={26} textAnchor="middle">{`${i + 1}　${p.label}`}</text>
          {i > 0 && <line className="kn-dg-col" x1={p.x} x2={p.x} y1={FLOW_CONST.TOP} y2={lay.height - 8} />}
        </g>
      ))}
      <g>
        {lay.edges.map((e, i) => (
          <g key={`${e.from}-${e.to}-${i}`}>
            <path className="kn-dg-edge" data-back={e.back} d={e.d} markerEnd={`url(#${uid}-ar)`} />
            {e.label && <text className="kn-dg-elabel" x={e.lx} y={e.ly} textAnchor={e.anchor}>{e.label}</text>}
          </g>
        ))}
      </g>
      <g>
        {lay.nodes.map((b) => {
          const n = meta.get(b.id)!
          const st = strengthOf(n)
          const pick = () => onPick({ key: n.id, heading: `${d.lanes[n.lane]}・${n.label}`, sub: n.sub, note: n.note, strength: st, unknown: !!n.unknown, src: n.src })
          const r = b.rect
          return (
            <g key={n.id} className="kn-dg-node" data-ev={st} data-sel={sel === n.id} data-shape={n.shape} role="button" tabIndex={0}
              aria-label={ariaOf(n.label, st, !!n.unknown)} aria-pressed={sel === n.id} onClick={pick} onKeyDown={onKey(pick)}>
              {n.shape === 'decision'
                ? <polygon className="kn-dg-shape" points={`${b.cx},${r.y} ${r.x + r.w},${b.cy} ${b.cx},${r.y + r.h} ${r.x},${b.cy}`} />
                : <rect className="kn-dg-shape" x={r.x} y={r.y} width={r.w} height={r.h} rx={8} />}
              <g transform={n.shape === 'decision' ? `translate(${b.cx - 55} ${b.cy - 28})` : `translate(${r.x} ${r.y})`}>
                <NodeText label={n.label} sub={n.shape === 'decision' ? undefined : n.sub} w={n.shape === 'decision' ? 110 : r.w} h={n.shape === 'decision' ? 56 : r.h} />
              </g>
              {n.pitfall && <text className="kn-dg-warn" x={r.x + r.w - 14} y={r.y + 16}>⚠</text>}
              {n.unknown && <text className="kn-dg-q" x={n.shape === 'decision' ? b.cx + 22 : r.x + r.w - (n.pitfall ? 30 : 14)} y={r.y + 16}>？</text>}
              <text className="kn-dg-srcno" x={r.x + 2} y={r.y + r.h + 14}>{`來源 ${n.src.join('·')}`}</text>
            </g>
          )
        })}
      </g>
    </svg>
  )
}

/* ───────── timeline ───────── */

function TimelineSvg({ d, now, sel, onPick }: { d: TimelineDiagram; now: Date; sel: string | null; onPick: (s: Selected) => void }) {
  const lay = useMemo(() => layoutTimeline(d, now), [d, now])
  return (
    <svg className="kn-dg-svg" viewBox={`0 0 ${lay.width} ${lay.height}`} width="100%" style={{ maxWidth: lay.width, minWidth: Math.round(lay.width * 0.6) }} role="group" aria-label="多軌時間軸">
      {lay.tracks.map((t, i) => (
        <g key={t.id}>
          <rect className="kn-dg-lane" data-odd={i % 2} x={0} y={t.y} width={lay.width} height={t.h} />
          <text className="kn-dg-lanename" x={12} y={t.y + t.h / 2 + 5}>{t.label}</text>
        </g>
      ))}
      {lay.ticks.map((t) => (
        <g key={t.x}>
          <line className="kn-dg-col" x1={t.x} x2={t.x} y1={26} y2={lay.axis.bottom} />
          <text className="kn-dg-phase" x={t.x + 4} y={20}>{t.label}</text>
        </g>
      ))}
      {lay.metrics.map((m) => (
        <g key={m.label}>
          <rect className="kn-dg-lane" data-odd={1} x={0} y={m.y} width={lay.width} height={m.h} />
          <text className="kn-dg-lanename" x={12} y={m.y + m.h / 2 + 5}>{m.label}{m.unit ? `（${m.unit}）` : ''}</text>
          <text className="kn-dg-srcno" x={lay.axis.x0 - 6} y={m.y + 22} textAnchor="end">{m.max}</text>
          <text className="kn-dg-srcno" x={lay.axis.x0 - 6} y={m.y + m.h - 14} textAnchor="end">{m.min}</text>
          <path className="kn-dg-line" d={m.path} />
          {m.points.map((p, i) => (
            <circle key={p.date + i} className="kn-dg-pt" data-last={i === m.points.length - 1} cx={p.x} cy={p.y} r={i === m.points.length - 1 ? 5 : 3.5}>
              <title>{`${p.date}：${p.value}${m.unit ?? ''}（來源 ${p.src.join('·')}）`}</title>
            </circle>
          ))}
          {m.points.length > 0 && <text className="kn-dg-ptval" x={m.points[m.points.length - 1]!.x + 9} y={m.points[m.points.length - 1]!.y + 4}>{m.points[m.points.length - 1]!.value}</text>}
        </g>
      ))}
      <line className="kn-dg-todayline" x1={lay.todayX} x2={lay.todayX} y1={26} y2={lay.axis.bottom} />
      <text className="kn-dg-todaytext" x={lay.todayX + 5} y={lay.axis.bottom + 18}>{lay.todayLabel}</text>
      {lay.marks.map((mk) => {
        if (mk.kind === 'forecast') {
          return (
            <g key={mk.key} className="kn-dg-fc">
              <circle cx={mk.x} cy={mk.markerY} r={6} />
              <text x={mk.x} y={mk.markerY + 22} textAnchor="middle">{mk.label}</text>
              <title>{`預計下一次：${mk.date}（推估）`}</title>
            </g>
          )
        }
        const it = d.items[mk.itemIndex!]!
        const track = d.tracks[mk.trackIndex]!
        const pick = () => onPick({ key: mk.key, heading: `${track.label}・${it.label}`, sub: [it.date + (it.end ? `～${it.end}` : ''), it.sub].filter(Boolean).join('　'), note: it.note, strength: mk.strength, unknown: mk.unknown, src: it.src })
        return (
          <g key={mk.key} className="kn-dg-node" data-ev={mk.strength} data-sel={sel === mk.key} role="button" tabIndex={0}
            aria-label={ariaOf(`${it.label} ${it.date}`, mk.strength, mk.unknown)} aria-pressed={sel === mk.key} onClick={pick} onKeyDown={onKey(pick)}>
            {it.end
              ? <rect className="kn-dg-shape" x={mk.x - 6} y={mk.markerY - 6} width={Math.max(12, mk.xEnd - mk.x + 12)} height={12} rx={6} />
              : <circle className="kn-dg-shape" cx={mk.x} cy={mk.markerY} r={7} />}
            <text className="kn-dg-ilabel" x={mk.x} y={mk.markerY + 22} textAnchor="middle">{it.label}</text>
            {mk.unknown && <text className="kn-dg-q" x={mk.x + 8} y={mk.markerY - 6}>？</text>}
          </g>
        )
      })}
    </svg>
  )
}

function ForecastCard({ d, now }: { d: TimelineDiagram; now: Date }) {
  const fc = useMemo(() => layoutTimeline(d, now).forecasts, [d, now])
  if (fc.length === 0) return null
  return (
    <div className="kn-dg-next" aria-label="下次是哪天">
      <h4>下次是哪天（推估）</h4>
      <ul>
        {fc.map((f) => (
          <li key={f.trackId}>
            <span className="kn-dg-next-label">{f.label}</span>
            <b>{Number(f.date.slice(5, 7))}/{Number(f.date.slice(8, 10))}</b>
            <span className="kn-muted">{f.inDays === 0 ? '就是今天' : f.inDays > 0 ? `還有 ${f.inDays} 天` : `已超過 ${-f.inDays} 天`}・約每 {f.intervalDays} 天一次（依過去 {f.basedOn} 次）</span>
          </li>
        ))}
      </ul>
    </div>
  )
}

/* ───────── map ───────── */

function MapSvg({ d, sel, onPick }: { d: MapDiagram; sel: string | null; onPick: (s: Selected) => void }) {
  const uid = useId().replace(/:/g, '')
  const lay = useMemo(() => layoutMap(d), [d])
  const all = new Map([...d.observations, ...d.frameworks, ...d.judgments].map((n) => [n.id, n]))
  const colName = { o: '觀察', f: '框架', j: '判斷' } as const
  return (
    <svg className="kn-dg-svg" viewBox={`0 0 ${lay.width} ${lay.height}`} width="100%" style={{ maxWidth: lay.width, minWidth: Math.round(lay.width * 0.6) }} role="group" aria-label="觀察、框架、判斷三欄圖">
      <defs>
        {(['ai', 'one', 'multi'] as const).map((s) => (
          <marker key={s} id={`${uid}-ar-${s}`} viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse" className="kn-dg-marker" data-ev={s}>
            <path d="M0 0L10 5L0 10z" fill="currentColor" />
          </marker>
        ))}
      </defs>
      {lay.headers.map((h) => <text key={h.label} className="kn-dg-phase" x={h.x} y={30} textAnchor="middle">{h.label}</text>)}
      <rect className="kn-dg-core" x={lay.core.x} y={lay.core.y} width={lay.core.w} height={lay.core.h} rx={14} />
      <text className="kn-dg-coretext" x={lay.core.tx} y={lay.core.ty} textAnchor="middle">{`共同核心：${lay.core.label}`}</text>
      <g>
        {lay.links.map((l, i) => <path key={`${l.from}-${l.to}-${i}`} className="kn-dg-link" data-ev={l.strength} d={l.d} markerEnd={`url(#${uid}-ar-${l.strength})`} />)}
      </g>
      {lay.nodes.map((b) => {
        const n = all.get(b.id)!
        const pick = () => onPick({ key: n.id, heading: `${colName[b.col]}・${n.label}`, sub: n.sub, note: n.note, strength: b.strength, unknown: !!n.unknown, src: n.src })
        const r = b.rect
        return (
          <g key={n.id} className="kn-dg-node" data-ev={b.strength} data-sel={sel === n.id} data-col={b.col} role="button" tabIndex={0}
            aria-label={ariaOf(n.label, b.strength, !!n.unknown)} aria-pressed={sel === n.id} onClick={pick} onKeyDown={onKey(pick)}>
            <rect className="kn-dg-shape" x={r.x} y={r.y} width={r.w} height={r.h} rx={b.col === 'f' ? 12 : 8} />
            <g transform={`translate(${r.x} ${r.y})`}><NodeText label={n.label} sub={n.sub} w={r.w} h={r.h} /></g>
            {n.unknown && <text className="kn-dg-q" x={r.x + r.w - 14} y={r.y + 16}>？</text>}
          </g>
        )
      })}
    </svg>
  )
}

/* ───────── 外殼＋說明區 ───────── */

function Detail({ sel, topic, quotes, onOpenSource, detailRef }: {
  sel: Selected | null; topic: Topic; quotes: readonly HermesTopicQuote[] | null; onOpenSource: (n: number, q: string) => void
  detailRef: RefObject<HTMLElement | null>
}) {
  if (!sel) {
    return (
      <aside className="kn-dg-detail" aria-live="polite" ref={detailRef}>
        <p className="kn-muted">點圖上任一格，這裡會列出說明與來源；再點來源就開出原文。</p>
      </aside>
    )
  }
  const count = new Set(sel.src).size
  return (
    <aside className="kn-dg-detail" aria-live="polite" ref={detailRef}>
      <h4>{sel.heading}</h4>
      <p className="kn-dg-ev" data-ev={sel.strength}><i className="kn-dg-sw" data-ev={sel.strength} />證據：{STRENGTH_TEXT[sel.strength]}{sel.strength === 'multi' ? `（${count} 份）` : ''}</p>
      {sel.sub && <p className="kn-dg-sub">{sel.sub}</p>}
      {sel.note && <p className="kn-dg-note">{sel.note}</p>}
      {sel.unknown && <p className="kn-dg-unk"><b>？</b> 這一格還不知道：來源沒有交代清楚，之後有新素材才會補上。</p>}
      <h5>來源（點一下看原文）</h5>
      <ul className="kn-dg-srcs">
        {[...new Set(sel.src)].map((n) => (
          <li key={n}>
            <button type="button" className="kn-dg-src" onClick={() => onOpenSource(n, quoteQueryFor(quotes, n))}>
              <span className="kn-sno">{n}</span><span>{topic.sources[n - 1]?.title ?? `來源 ${n}`}</span>
            </button>
          </li>
        ))}
      </ul>
    </aside>
  )
}

export function KnowledgeDiagram({ topic, diagram, quotes, onOpenSource, now }: Props) {
  const [sel, setSel] = useState<Selected | null>(null)
  const detailRef = useRef<HTMLElement | null>(null)
  const clock = useMemo(() => now ?? new Date(), [now])
  // 說明區在圖下方；選取改變後若不在畫面內就捲過去
  useEffect(() => {
    if (!sel) return
    const el = detailRef.current
    if (el && typeof el.scrollIntoView === 'function') el.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
  }, [sel])
  let svg: ReactNode
  if (diagram.type === 'flow') svg = <FlowSvg d={diagram} sel={sel?.key ?? null} onPick={setSel} />
  else if (diagram.type === 'timeline') svg = <TimelineSvg d={diagram} now={clock} sel={sel?.key ?? null} onPick={setSel} />
  else svg = <MapSvg d={diagram} sel={sel?.key ?? null} onPick={setSel} />
  return (
    <section className="kn-dg" aria-label="圖解" data-type={diagram.type}>
      {diagram.type === 'timeline' && <ForecastCard d={diagram} now={clock} />}
      <Legend type={diagram.type} />
      <div className="kn-dg-body">
        <div className="kn-dg-scroll">{svg}</div>
        <Detail sel={sel} topic={topic} quotes={quotes} onOpenSource={onOpenSource} detailRef={detailRef} />
      </div>
    </section>
  )
}
