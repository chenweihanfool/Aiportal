// 想法庫視覺化（2026-10-22）：單一想法的生命線、併入血緣、價值×難度散佈圖。自繪 SVG，不引入圖表套件。
import { useMemo, useState } from 'react'
import type { IdeaItem } from './boardApi'
import { COLOR, FONT } from './theme'
import { SCATTER_QUADRANTS, STATUS_COLOR, STATUS_ICON, STATUS_LABEL, buildLifeline, buildLineage, buildScatter, lifeStats, quadrantOf, scaleTime, type LineageNode } from './ideasView'

const ORDER = ['new', 'evaluating', 'doing', 'done'] as const
/** 階梯線的高度：新→評估→進行→已實行由低到高，擱置／放棄／併入落回底部 */
const LEVEL: Record<string, number> = { new: 0, evaluating: 1, doing: 2, done: 3, shelved: 0, dropped: 0, absorbed: 0 }

export function IdeaLifeline({ idea, nowMs }: { idea: IdeaItem; nowMs: number }) {
  const lf = useMemo(() => buildLifeline(idea, nowMs), [idea, nowMs])
  if (!lf) return null
  const W = 560, H = 128, L = 14, R = W - 14, yStep0 = 104, yStepH = 14, yDot = 26
  const x = (ms: number) => scaleTime(ms, lf.startMs, lf.endMs, L, R)
  const sy = (st: string) => yStep0 - (LEVEL[st] ?? 0) * yStepH
  // 階梯線：每個狀態維持到下一個狀態出現，最後一段延伸到終點
  let d = ''
  lf.steps.forEach((s, i) => {
    const nx = i + 1 < lf.steps.length ? x(lf.steps[i + 1]!.ms) : x(lf.endMs)
    d += `${i === 0 ? 'M' : 'L'}${x(s.ms).toFixed(1)},${sy(s.status)} L${nx.toFixed(1)},${sy(s.status)} `
  })
  const endColor = STATUS_COLOR[lf.endStatus]
  return (
    <figure data-testid="idea-lifeline" style={{ margin: '8px 0' }}>
      <figcaption style={{ fontSize: '0.74rem', color: COLOR.ink, marginBottom: 4 }}>{lf.summary}</figcaption>
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" role="img" aria-label={`${idea.id} 的生命線：${lf.summary}`} style={{ display: 'block', maxWidth: W }}>
        <line x1={L} x2={R} y1={yDot + 16} y2={yDot + 16} stroke={COLOR.line} strokeDasharray="2 4" />
        {lf.recalls.map((r) => (
          <circle key={r.date} cx={x(r.ms)} cy={yDot} r={4} fill={COLOR.steel} opacity={0.85}><title>{`${r.date} 被想起`}</title></circle>
        ))}
        <text x={L} y={12} fontSize={9} fill={COLOR.steelDim} fontFamily={FONT.mono}>被想起 ●</text>
        <path d={d} fill="none" stroke={endColor} strokeWidth={2} />
        {lf.steps.map((s) => (
          <g key={`${s.status}-${s.ms}`}>
            <circle cx={x(s.ms)} cy={sy(s.status)} r={4.5} fill={STATUS_COLOR[s.status]} stroke={COLOR.panelDeep} strokeWidth={1.5}><title>{s.label}</title></circle>
          </g>
        ))}
        <text x={x(lf.endMs)} y={H - 2} textAnchor="end" fontSize={10} fill={endColor}>
          {lf.ongoing ? `${STATUS_ICON[lf.endStatus]} ${STATUS_LABEL[lf.endStatus]}（現在）` : `${STATUS_ICON[lf.endStatus]} ${STATUS_LABEL[lf.endStatus]}`}
        </text>
        <text x={L} y={H - 2} fontSize={10} fill={COLOR.steelDim}>誕生</text>
      </svg>
      {lf.recalls.length === 0 && <div style={{ fontSize: '0.66rem', color: COLOR.steelDim }}>日記日期沒有記錄（舊資料），只畫狀態變化。</div>}
    </figure>
  )
}

function TreeRows({ node, depth, current }: { node: LineageNode; depth: number; current: string }) {
  return (
    <>
      <li style={{ marginLeft: depth * 18, listStyle: 'none', color: node.id === current ? COLOR.amber : COLOR.steel, fontSize: '0.74rem', lineHeight: 1.7 }}>
        {depth > 0 && <span style={{ color: COLOR.steelDim }}>└ </span>}
        <span style={{ fontFamily: FONT.mono, color: COLOR.steelDim }}>{node.id}</span>{' '}
        <span style={{ color: node.id === current ? COLOR.amber : COLOR.ink }}>{node.title}</span>{' '}
        <span style={{ color: STATUS_COLOR[node.status] }}>{STATUS_ICON[node.status]} {STATUS_LABEL[node.status]}</span>
      </li>
      {node.children.map((c) => <TreeRows key={c.id} node={c} depth={depth + 1} current={current} />)}
    </>
  )
}

export function IdeaLineage({ ideas, id }: { ideas: IdeaItem[]; id: string }) {
  const tree = useMemo(() => buildLineage(ideas, id), [ideas, id])
  if (!tree) return null
  return (
    <div data-testid="idea-lineage" style={{ margin: '8px 0' }}>
      <div style={{ fontSize: '0.74rem', color: COLOR.ink }}>血緣：這組共 {tree.size} 個想法，併入到「{tree.root.title}」</div>
      <ul style={{ margin: '4px 0 0', padding: 0 }}><TreeRows node={tree.root} depth={0} current={id} /></ul>
    </div>
  )
}

export function IdeaScatter({ ideas }: { ideas: IdeaItem[] }) {
  const { points, skipped } = useMemo(() => buildScatter(ideas), [ideas])
  const [hover, setHover] = useState<string | null>(null)
  if (points.length === 0) return <div style={{ fontSize: '0.74rem', color: COLOR.steelDim }}>目前篩選下沒有估過價值與難度的想法</div>
  const W = 440, H = 300, L = 36, R = W - 12, T = 14, B = H - 30
  const px = (e: number) => L + ((e - 0.5) / 5) * (R - L)
  const py = (v: number) => B - ((v - 0.5) / 5) * (B - T)
  // 同一格的點錯開，避免完全疊在一起
  const slot = new Map<string, number>()
  const place = points.map((p) => {
    const k = `${p.x},${p.y}`
    const n = slot.get(k) ?? 0
    slot.set(k, n + 1)
    const a = n * 2.4
    return { p, cx: px(p.x) + (n === 0 ? 0 : Math.cos(a) * (8 + n * 3)), cy: py(p.y) + (n === 0 ? 0 : Math.sin(a) * (8 + n * 3)) }
  })
  const midX = px(2.5), midY = py(3.5)
  const hv = place.find((q) => q.p.id === hover)
  const quad = hv ? SCATTER_QUADRANTS[quadrantOf(hv.p.y, hv.p.x)] : null
  return (
    <figure data-testid="idea-scatter" style={{ margin: 0 }}>
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" role="img" aria-label="想法價值與難度散佈圖" style={{ display: 'block', maxWidth: W }}>
        <rect x={L} y={T} width={midX - L} height={midY - T} fill={COLOR.ok} opacity={0.08} />
        <line x1={midX} x2={midX} y1={T} y2={B} stroke={COLOR.line} strokeDasharray="3 4" />
        <line x1={L} x2={R} y1={midY} y2={midY} stroke={COLOR.line} strokeDasharray="3 4" />
        <rect x={L} y={T} width={R - L} height={B - T} fill="none" stroke={COLOR.line} />
        <text x={L + 6} y={T + 12} fontSize={10} fill={COLOR.ok}>快贏</text>
        <text x={R - 6} y={T + 12} fontSize={10} fill={COLOR.steel} textAnchor="end">大案</text>
        <text x={L + 6} y={B - 6} fontSize={10} fill={COLOR.steelDim}>雜務</text>
        <text x={R - 6} y={B - 6} fontSize={10} fill={COLOR.steelDim} textAnchor="end">避開</text>
        {[1, 2, 3, 4, 5].map((n) => (
          <g key={n}>
            <text x={px(n)} y={H - 14} fontSize={9} fill={COLOR.steelDim} textAnchor="middle" fontFamily={FONT.mono}>{n}</text>
            <text x={L - 8} y={py(n) + 3} fontSize={9} fill={COLOR.steelDim} textAnchor="end" fontFamily={FONT.mono}>{n}</text>
          </g>
        ))}
        <text x={(L + R) / 2} y={H - 2} fontSize={10} fill={COLOR.steel} textAnchor="middle">難度 →</text>
        <text x={8} y={(T + B) / 2} fontSize={10} fill={COLOR.steel} textAnchor="middle" transform={`rotate(-90 8 ${(T + B) / 2})`}>價值 →</text>
        {place.map(({ p, cx, cy }) => (
          <circle key={p.id} cx={cx} cy={cy} r={p.r} fill={STATUS_COLOR[p.status]} fillOpacity={p.open ? 0.85 : 0.4} stroke={hover === p.id ? COLOR.ink : COLOR.panelDeep} strokeWidth={1.5}
            tabIndex={0} onMouseEnter={() => setHover(p.id)} onMouseLeave={() => setHover(null)} onFocus={() => setHover(p.id)} onBlur={() => setHover(null)}>
            <title>{`${p.id} ${p.title}（價值 ${p.y}・難度 ${p.x}）`}</title>
          </circle>
        ))}
      </svg>
      <figcaption style={{ fontSize: '0.68rem', color: COLOR.steelDim, minHeight: '2.6em' }}>
        {hv ? <><b style={{ color: COLOR.ink }}>{hv.p.id} {hv.p.title}</b>　{quad}</> : '點大小＝被想起次數；顏色＝狀態；淡色＝已結束。'}
        {skipped > 0 && <> 另有 {skipped} 筆尚未估價值／難度，未畫出。</>}
      </figcaption>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '2px 10px', fontSize: '0.64rem', color: COLOR.steelDim }}>
        {ORDER.concat(['shelved', 'dropped', 'absorbed'] as never[]).map((s) => (
          <span key={s}><span style={{ color: STATUS_COLOR[s] }}>●</span> {STATUS_LABEL[s]}</span>
        ))}
      </div>
    </figure>
  )
}

/** 想法庫抽屜頂部的一句話概況 */
export function IdeaLifeSummary({ ideas, nowMs }: { ideas: IdeaItem[]; nowMs: number }) {
  const s = useMemo(() => lifeStats(ideas, nowMs), [ideas, nowMs])
  if (s.total === 0) return null
  return (
    <div data-testid="idea-life-summary" style={{ fontSize: '0.74rem', color: COLOR.steel, lineHeight: 1.6 }}>
      共 {s.total} 個想法，{s.recurring} 個被想起 3 次以上（反覆回來的真需求）
      {s.medianDaysToClose !== null && <>；已結束的 {s.closed} 個，從誕生到結束的中位數是 {s.medianDaysToClose} 天</>}。
    </div>
  )
}
