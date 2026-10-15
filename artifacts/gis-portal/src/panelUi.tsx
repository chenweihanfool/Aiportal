// 面板共用的小元件：區塊外框、鎖頭卡、公式說明、統計格、子面板、折線圖、雷達圖。
import { useState } from 'react'
import { COLOR, FONT } from './theme'
import { Gauge } from './Gauge'

// ─────────────────────────────────────────────
// Panel primitives — shared instrument-housing chrome. Every section of the
// page is one `Unit` (a bezeled panel with an etched module label); cards
// within it share the same background/border tokens so the whole page reads
// as one panel, not a wall of unrelated widgets.
// ─────────────────────────────────────────────
export function Unit({ code, title, children, className }: { code?: string; title: string; children: React.ReactNode; className?: string }) {
  return (
    <section className={className} style={{
      position: 'relative',
      background: `linear-gradient(180deg, ${COLOR.panelRaised}, ${COLOR.panel})`,
      border: `1px solid ${COLOR.line}`,
      borderRadius: '6px',
      boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.04), 0 8px 22px rgba(0,0,0,0.35)',
      padding: '1.6rem 1.7rem 1.5rem',
      marginBottom: '1.1rem',
    }}>
      <div style={{
        fontFamily: FONT.mono, fontSize: '0.66rem', letterSpacing: '0.2em', textTransform: 'uppercase',
        color: COLOR.steelDim, display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '1.2rem',
      }}>
        {code && <span style={{ color: COLOR.amberDim }}>{code}</span>}
        <span style={{ fontFamily: FONT.body, fontSize: '0.72rem', letterSpacing: '0.08em', color: COLOR.steel, textTransform: 'none' }}>{title}</span>
        <span style={{ flex: 1, height: '1px', background: COLOR.line }} />
      </div>
      {children}
    </section>
  )
}

export function SubLabel({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ fontSize: '0.68rem', color: COLOR.steelDim, letterSpacing: '0.14em', textTransform: 'uppercase', marginBottom: '0.6rem', fontFamily: FONT.mono }}>
      {children}
    </div>
  )
}

export function LockedGaugeCard({ size = 'small', label, sub, onRequestUnlock }: { size?: 'primary' | 'small'; label: string; sub: string; onRequestUnlock: () => void }) {
  return (
    <div
      onClick={onRequestUnlock}
      style={{
        display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '0.5rem',
        padding: size === 'primary' ? '0 0 0.5rem' : '1rem 0.6rem 0.9rem',
        background: size === 'primary' ? 'transparent' : COLOR.panelRaised,
        border: size === 'primary' ? 'none' : `1px solid ${COLOR.line}`,
        borderRadius: '5px', cursor: 'pointer',
      }}
    >
      <Gauge value={null} size={size} locked />
      <div style={{ fontSize: '0.78rem', fontWeight: 600, color: COLOR.ink }}>{label}</div>
      <div style={{ fontFamily: FONT.mono, fontSize: '0.62rem', color: COLOR.steelDim }}>{sub}</div>
      <div style={{ fontFamily: FONT.mono, fontSize: '0.68rem', color: COLOR.warn, letterSpacing: '0.05em' }}>🔒 解鎖後顯示</div>
    </div>
  )
}

// Tap-to-expand formula detail — a footer toggle line, then a bordered panel
// of label/formula rows. Works identically on mouse and touch.
export function FormulaToggle({
  expanded,
  onToggle,
  labelCollapsed = '公式說明 ▼',
  labelExpanded = '收起公式說明 ▲',
}: {
  expanded: boolean
  onToggle: (e: React.MouseEvent) => void
  labelCollapsed?: string
  labelExpanded?: string
}) {
  return (
    <div
      onClick={onToggle}
      style={{ marginTop: '0.6rem', textAlign: 'right', fontSize: '0.68rem', fontFamily: FONT.mono, color: COLOR.amberDim, cursor: 'pointer' }}
    >
      {expanded ? labelExpanded : labelCollapsed}
    </div>
  )
}

export function SupportStats({ items }: { items: Array<{ label: string; value: string; color?: string; formula?: string; tier?: string }> }) {
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '1.4rem 2rem' }}>
      {items.map(it => (
        <div key={it.label}>
          <div style={{ fontSize: '0.7rem', color: COLOR.steelDim, letterSpacing: '0.05em', marginBottom: '3px' }}>{it.label}</div>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: '6px' }}>
            <span style={{ fontFamily: FONT.mono, fontSize: '1.05rem', fontWeight: 600, color: it.color ?? COLOR.ink, fontVariantNumeric: 'tabular-nums' }}>{it.value}</span>
            {it.tier && <span style={{ fontSize: '0.66rem', fontWeight: 600, color: it.color }}>{it.tier}</span>}
          </div>
        </div>
      ))}
    </div>
  )
}

export function FormulaPanel({ rows }: { rows: Array<{ label: string; formula?: string }> }) {
  const withFormula = rows.filter((r): r is { label: string; formula: string } => !!r.formula)
  if (withFormula.length === 0) return null
  return (
    <div style={{ marginTop: '0.6rem', paddingTop: '0.7rem', borderTop: `1px dashed ${COLOR.line}`, display: 'flex', flexDirection: 'column', gap: '8px' }}>
      {withFormula.map(r => (
        <div key={r.label} style={{ fontSize: '0.68rem' }}>
          <div style={{ color: COLOR.steel, fontWeight: 600, marginBottom: '2px' }}>{r.label}</div>
          <div style={{ color: COLOR.steelDim, lineHeight: 1.6 }}>{r.formula}</div>
        </div>
      ))}
    </div>
  )
}

// Lightweight custom SVG line chart for 30-day trend panels — area fill +
// line + faint value labels, same instrument-mono treatment as the gauges.
export function TrendLineChart({ points, color = COLOR.amber, height = 90 }: { points: Array<{ date: string; value: number }>; color?: string; height?: number }) {
  if (points.length < 2) {
    return (
      <div style={{ fontSize: '0.72rem', color: COLOR.steelDim, padding: '0.6rem 0' }}>
        還沒有足夠的歷史資料可畫趨勢線（目前 {points.length} 天，至少需要 2 天）——每天會自動多記一筆，過幾天回來看就有線了
      </div>
    )
  }

  const width = 100
  const values = points.map(p => p.value)
  const minV = Math.min(...values)
  const maxV = Math.max(...values)
  const range = maxV - minV || 1
  const padY = 6
  const innerH = height - padY * 2
  const stepX = width / (points.length - 1)
  const coords = points.map((p, i) => {
    const x = i * stepX
    const y = padY + innerH - ((p.value - minV) / range) * innerH
    return [x, y] as const
  })
  const linePath = coords.map(([x, y], i) => `${i === 0 ? 'M' : 'L'}${x.toFixed(2)},${y.toFixed(2)}`).join(' ')
  const last = coords[coords.length - 1]!
  const areaPath = `${linePath} L${last[0].toFixed(2)},${height} L0,${height} Z`

  return (
    <div>
      <svg width="100%" height={height} viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none" style={{ display: 'block' }}>
        <line x1={0} y1={height / 2} x2={width} y2={height / 2} stroke={COLOR.line} strokeWidth={0.5} vectorEffect="non-scaling-stroke" />
        <path d={areaPath} fill={color} fillOpacity={0.12} stroke="none" />
        <path d={linePath} fill="none" stroke={color} strokeWidth={1.4} vectorEffect="non-scaling-stroke" />
        <circle cx={last[0]} cy={last[1]} r={2} fill={color} vectorEffect="non-scaling-stroke" />
      </svg>
      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.62rem', fontFamily: FONT.mono, color: COLOR.steelDim, marginTop: '4px' }}>
        <span>{points[0]!.date}</span>
        <span>最低 {minV} · 最高 {maxV}</span>
        <span>{points[points.length - 1]!.date}</span>
      </div>
    </div>
  )
}

// Shared radar chart — still the right chart for FitnessForge's 9 muscle
// axes (no single dial can show 9 independent balance axes at once).
// Absolute scale (0..maxValue), not self-relative — a self-relative chart
// always fills to 100% regardless of actual progress.
export function LabeledRadarChart({
  axes,
  maxValue,
  baselineFraction,
  size = 240,
  color,
}: {
  axes: Array<{ label: string; value: number | null }>
  maxValue: number
  baselineFraction?: number
  size?: number
  color: string
}) {
  const cx = size / 2, cy = size / 2
  const r = size * 0.30
  const n = axes.length
  const angleAt = (i: number) => (Math.PI * 2 * i) / n - Math.PI / 2
  const pointAt = (i: number, radius: number) => [cx + radius * Math.cos(angleAt(i)), cy + radius * Math.sin(angleAt(i))] as const
  const ringPoints = (frac: number) => axes.map((_, i) => pointAt(i, r * frac)).map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(' ')
  const dataPoints = axes
    .map((a, i) => pointAt(i, r * (Math.max(0, Math.min(maxValue, a.value ?? 0)) / maxValue)))
    .map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`)
    .join(' ')

  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} style={{ flexShrink: 0, overflow: 'visible' }}>
      <polygon points={ringPoints(1)} fill="none" stroke={COLOR.line} strokeWidth={1} />
      <polygon points={ringPoints(0.5)} fill="none" stroke={COLOR.line} strokeWidth={1} />
      {baselineFraction !== undefined && (
        <polygon points={ringPoints(baselineFraction)} fill="none" stroke={COLOR.steel} strokeWidth={1.3} strokeDasharray="4 3" />
      )}
      {axes.map((_, i) => {
        const [x, y] = pointAt(i, r)
        return <line key={i} x1={cx} y1={cy} x2={x} y2={y} stroke={COLOR.line} strokeWidth={1} />
      })}
      <polygon points={dataPoints} fill={`${color}33`} stroke={color} strokeWidth={2} />
      {axes.map((a, i) => {
        const ang = angleAt(i)
        const [x, y] = pointAt(i, r + 20)
        const cos = Math.cos(ang)
        const anchor = cos > 0.35 ? 'start' : cos < -0.35 ? 'end' : 'middle'
        return (
          <text key={a.label} x={x} y={y} textAnchor={anchor} dominantBaseline="middle" fontSize="11" fontFamily={FONT.body} fill={COLOR.steel}>
            {a.label}{a.value !== null ? ` ${Math.round(a.value)}` : ''}
          </text>
        )
      })}
    </svg>
  )
}

export function StatCell({ label, value, sub, valueColor }: { label: string; value: string; sub?: string; valueColor?: string }) {
  return (
    <div style={{ background: COLOR.panelRaised, padding: '0.85rem 1rem' }}>
      <span style={{ fontFamily: FONT.mono, fontSize: '0.6rem', letterSpacing: '0.14em', textTransform: 'uppercase', color: COLOR.steelDim, marginBottom: '0.35rem', display: 'block' }}>{label}</span>
      <span style={{ fontFamily: FONT.mono, fontSize: '1.3rem', fontWeight: 600, color: valueColor ?? COLOR.ink, fontVariantNumeric: 'tabular-nums' }}>{value}</span>
      {sub && <div style={{ fontFamily: FONT.mono, fontSize: '0.62rem', color: COLOR.steelDim, marginTop: '2px' }}>{sub}</div>}
    </div>
  )
}
export function SubPanel({ title, sub, children }: { title: string; sub: string; children: React.ReactNode }) {
  return (
    <div style={{
      background: COLOR.panelRaised, border: `1px solid ${COLOR.line}`, borderRadius: '5px', padding: '1rem 1.1rem',
    }}>
      <div style={{ fontSize: '0.8rem', fontWeight: 600, color: COLOR.ink, marginBottom: '2px' }}>{title}</div>
      <div style={{ fontFamily: FONT.mono, fontSize: '0.62rem', color: COLOR.steelDim, marginBottom: '0.7rem' }}>{sub}</div>
      {children}
    </div>
  )
}
// 跟 SubPanel 同一張卡片外觀，差別是標題列可點擊收合、預設收起——HERMES
// 戰情室這幾塊清單（排程任務/近期活動/容器）平常沒事不用一直佔版面，異
// 常時才需要點開看，所以標題邊加一顆紅點：平常收合也看得到「這裡有問題
// 該打開」，不用先展開才知道。`hasAlert` 沒帶或 false 就不畫紅點——不是
// 每個清單都有明確的「異常」訊號可判斷（例如近期活動目前只會記成功的部
// 署，update.ps1 失敗時整支腳本 exit 1、從來不會寫進 log，所以那個分頁
// 目前沒有紅點）。
export function CollapsibleSubPanel({
  title, sub, hasAlert, defaultOpen = false, children,
}: { title: string; sub: string; hasAlert?: boolean; defaultOpen?: boolean; children: React.ReactNode }) {
  const [open, setOpen] = useState(defaultOpen)
  return (
    <div style={{
      background: COLOR.panelRaised, border: `1px solid ${COLOR.line}`, borderRadius: '5px', padding: '1rem 1.1rem',
    }}>
      <div onClick={() => setOpen(o => !o)} style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer' }}>
        <span style={{ fontSize: '0.8rem', fontWeight: 600, color: COLOR.ink }}>{title}</span>
        {hasAlert && (
          <span
            title="有異常狀況，建議展開查看"
            style={{ width: '7px', height: '7px', borderRadius: '50%', background: COLOR.crit, boxShadow: `0 0 5px ${COLOR.crit}`, flexShrink: 0 }}
          />
        )}
        <span style={{ flex: 1 }} />
        <span style={{ display: 'inline-block', transition: 'transform 0.2s ease', transform: open ? 'rotate(90deg)' : 'rotate(0deg)', color: COLOR.amberDim, fontSize: '0.7rem' }}>▶</span>
      </div>
      <div style={{ fontFamily: FONT.mono, fontSize: '0.62rem', color: COLOR.steelDim, marginTop: '2px', marginBottom: open ? '0.7rem' : 0 }}>{sub}</div>
      {open && children}
    </div>
  )
}
