// 儀表圈（270° 弧形刻度盤）。
import { useEffect, useState } from 'react'
import { COLOR, FONT } from './theme'

// ─────────────────────────────────────────────
// Gauge — the signature instrument of the redesign. A 270° arc dial (90°
// gap at the bottom, like a real analog speedometer) with tick marks and a
// needle. `value` drives both the amber fill arc and the needle rotation;
// both sweep in from zero exactly once, on first mount (not on every data
// refresh) — driven by a `swept` flag that flips true ~100ms after mount,
// which the CSS transition on transform/stroke-dashoffset then animates.
// Respects prefers-reduced-motion by starting already-swept.
// ─────────────────────────────────────────────
const GAUGE_START = -135
const GAUGE_SWEEP = 270
const REDUCE_MOTION = typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches

function polarPoint(cx: number, cy: number, r: number, thetaDeg: number) {
  const rad = (thetaDeg * Math.PI) / 180
  return { x: cx + r * Math.sin(rad), y: cy - r * Math.cos(rad) }
}

function gaugeArcPath(cx: number, cy: number, r: number, startDeg: number, endDeg: number) {
  const s = polarPoint(cx, cy, r, startDeg)
  const e = polarPoint(cx, cy, r, endDeg)
  const large = endDeg - startDeg > 180 ? 1 : 0
  return `M ${s.x} ${s.y} A ${r} ${r} 0 ${large} 1 ${e.x} ${e.y}`
}

export function Gauge({
  value,
  size = 'small',
  color = COLOR.amber,
  locked = false,
}: {
  value: number | null
  size?: 'primary' | 'small'
  color?: string
  locked?: boolean
}) {
  const [swept, setSwept] = useState(REDUCE_MOTION)
  useEffect(() => {
    if (REDUCE_MOTION) return
    const t = setTimeout(() => setSwept(true), 100)
    return () => clearTimeout(t)
  }, [])

  const isPrimary = size === 'primary'
  const dim = isPrimary ? 200 : 108
  const r = isPrimary ? 82 : 42
  const stroke = isPrimary ? 12 : 7
  const cx = dim / 2, cy = dim / 2
  const clamped = value === null ? 0 : Math.max(0, Math.min(100, value))
  const endAngle = GAUGE_START + (clamped / 100) * GAUGE_SWEEP
  const needleAngle = locked ? GAUGE_START : (swept ? endAngle : GAUGE_START)
  const dashOffset = swept ? 0 : 100
  const track = gaugeArcPath(cx, cy, r, GAUGE_START, GAUGE_START + GAUGE_SWEEP)
  const valueArc = gaugeArcPath(cx, cy, r, GAUGE_START, endAngle)
  const ticks = Array.from({ length: 11 }, (_, i) => {
    const tAngle = GAUGE_START + (i / 10) * GAUGE_SWEEP
    const p1 = polarPoint(cx, cy, r + stroke / 2 + 3, tAngle)
    const p2 = polarPoint(cx, cy, r + stroke / 2 + (i % 5 === 0 ? 8 : 5), tAngle)
    return { key: i, x1: p1.x, y1: p1.y, x2: p2.x, y2: p2.y }
  })

  return (
    <svg width={dim} height={dim} viewBox={`0 0 ${dim} ${dim}`} style={{ flexShrink: 0, opacity: locked ? 0.4 : 1 }}>
      <path d={track} fill="none" stroke={COLOR.panelDeep} strokeWidth={stroke} strokeLinecap="round" />
      {!locked && (
        <path
          d={valueArc} fill="none" stroke={color} strokeWidth={stroke} strokeLinecap="round"
          pathLength={100} className="ip-arc-value"
          style={{ strokeDasharray: 100, strokeDashoffset: dashOffset }}
        />
      )}
      {ticks.map(t => (
        <line key={t.key} x1={t.x1} y1={t.y1} x2={t.x2} y2={t.y2} stroke={COLOR.steelDim} strokeWidth={1} />
      ))}
      {!locked && (
        <>
          <line
            x1={cx} y1={cy} x2={cx} y2={cy - (r - stroke / 2 - 2)}
            stroke={COLOR.ink} strokeWidth={isPrimary ? 3 : 2} strokeLinecap="round"
            className="ip-needle"
            style={{ transformOrigin: `${cx}px ${cy}px`, transform: `rotate(${needleAngle}deg)` }}
          />
          <circle cx={cx} cy={cy} r={isPrimary ? 5 : 3.5} fill={COLOR.ink} />
        </>
      )}
      <text
        x={cx} y={cy + r * 0.52} textAnchor="middle" fill={locked ? COLOR.steelDim : color}
        fontFamily={FONT.mono} fontWeight={600} fontSize={isPrimary ? 36 : 18}
      >
        {locked ? '🔒' : value !== null ? Math.round(value) : '—'}
      </text>
    </svg>
  )
}
