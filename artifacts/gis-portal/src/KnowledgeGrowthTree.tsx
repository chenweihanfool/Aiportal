import { useEffect, useMemo, useRef, useState } from 'react'
import { DOMAIN_COLORS, layoutGrowthTree, monthsOf, visibleAt, UNASSIGNED_DOMAIN_NAME } from './knowledgeGrowthTree'
import { kindLabel, recentChangeOf, type BuiltTree, type Topic } from './knowledgeView'

// 知識頁「星空生長」全樹（2.84.0）：發光的樹，題目是亮點，依首次出現月份長出來；可回放。排版在 knowledgeGrowthTree.ts（純函式有測試）。

const STEP_MS = 900

interface LeafInfo { topic: Topic; domain: string; branch: string }

export function KnowledgeGrowthTree({ built, topics, now, onOpen }: {
  built: BuiltTree; topics: readonly Topic[]; now: Date; onOpen: (id: string) => void
}) {
  const months = useMemo(() => monthsOf(topics, now), [topics, now])
  const last = months.length - 1
  const [idx, setIdx] = useState(last)
  const [playing, setPlaying] = useState(false)
  const [hover, setHover] = useState<string | null>(null)
  const [boxW, setBoxW] = useState(0)
  const boxRef = useRef<HTMLDivElement>(null)

  // 資料更新讓月份變多時，沒在回放就跟到最新月份
  useEffect(() => { if (!playing) setIdx(last) }, [last]) // eslint-disable-line react-hooks/exhaustive-deps
  const cur = months[Math.min(idx, last)]!

  useEffect(() => {
    const el = boxRef.current
    if (!el) return
    setBoxW(el.clientWidth)
    if (typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver(() => setBoxW(el.clientWidth))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  useEffect(() => {
    if (!playing) return
    const timer = window.setInterval(() => {
      setIdx((i) => {
        if (i >= last) { setPlaying(false); return last }
        if (i + 1 >= last) setPlaying(false)
        return i + 1
      })
    }, STEP_MS)
    return () => window.clearInterval(timer)
  }, [playing, last])

  // 螢幕上標籤要 ≥12px：viewBox 縮小時把字級放大回來（取偶數，避免一直重算）
  const probe = useMemo(() => layoutGrowthTree(built), [built])
  const scale = boxW > 0 ? Math.min(1, boxW / probe.width) : 1
  const labelFs = Math.max(12, Math.ceil(12 / scale / 2) * 2)
  const layout = useMemo(() => layoutGrowthTree(built, { labelFontSize: labelFs }), [built, labelFs])

  const info = useMemo(() => {
    const m = new Map<string, LeafInfo>()
    for (const d of built.domains) for (const b of d.branches) for (const t of b.topics) m.set(t.id, { topic: t, domain: d.name, branch: b.name })
    for (const t of built.unassigned) m.set(t.id, { topic: t, domain: UNASSIGNED_DOMAIN_NAME, branch: '' })
    return m
  }, [built])
  const recent = useMemo(() => recentChangeOf(topics, now, 7), [topics, now])

  if (layout.leaves.length === 0) return <p className="kn-muted">還沒有題目。</p>

  const visibleCount = layout.leaves.filter((l) => visibleAt(l.firstMonth, cur)).length
  const freshCount = layout.leaves.filter((l) => l.firstMonth === cur).length
  const hovered = hover ? layout.leaves.find((l) => l.id === hover) : undefined
  const hInfo = hover ? info.get(hover) : undefined

  const togglePlay = () => {
    if (playing) { setPlaying(false); return }
    setIdx(0)
    setPlaying(last > 0)
  }

  return (
    <div className="kn-gt">
      <div className="kn-gt-bar">
        <button type="button" className="kn-gt-play" onClick={togglePlay} aria-pressed={playing}>{playing ? '⏸ 暫停' : '▶ 回放生長'}</button>
        <span className="kn-gt-month" aria-live="polite">{cur}</span>
        <input type="range" className="kn-gt-slider" min={0} max={last} step={1} value={Math.min(idx, last)} aria-label="生長月份"
          onChange={(e) => { setPlaying(false); setIdx(Number(e.target.value)) }} />
        <span className="kn-gt-count">已長出 <b>{visibleCount}</b> 題　本月新增 <b>{freshCount}</b></span>
      </div>
      <div className="kn-gt-box" ref={boxRef}>
        <svg viewBox={`0 0 ${layout.width} ${layout.height}`} className="kn-gt-svg" role="group" aria-label="知識樹：依首次出現月份長出來">
          <defs>
            <linearGradient id="kn-gt-grad" gradientUnits="userSpaceOnUse" x1="0" y1={layout.height} x2="0" y2="0">
              <stop offset="0" style={{ stopColor: 'var(--c-sky)' }} />
              <stop offset="1" style={{ stopColor: 'var(--c-mint)' }} />
            </linearGradient>
            <filter id="kn-gt-glow" x="-50%" y="-50%" width="200%" height="200%">
              <feGaussianBlur stdDeviation="2.4" result="b" />
              <feMerge><feMergeNode in="b" /><feMergeNode in="SourceGraphic" /></feMerge>
            </filter>
          </defs>
          {[layout.trunk, ...layout.limbs].map((l) => (
            <path key={l.id} d={l.d} pathLength={1} className={`kn-gt-limb${visibleAt(l.firstMonth, cur) ? ' on' : ''}`} data-level={l.level} />
          ))}
          {layout.leaves.map((l) => {
            const vis = visibleAt(l.firstMonth, cur)
            const li = info.get(l.id)
            const name = li?.topic.name ?? l.id
            const color = DOMAIN_COLORS[l.domainIndex % DOMAIN_COLORS.length]!
            const act = () => onOpen(l.id)
            return (
              <g key={l.id} transform={`translate(${l.x} ${l.y})`}
                className={`kn-gt-leaf${vis ? ' on' : ''}${l.firstMonth === cur ? ' fresh' : ''}`}
                role="button" tabIndex={vis ? 0 : -1} aria-hidden={vis ? undefined : true}
                aria-label={`${name}（${li ? [li.domain, li.branch].filter(Boolean).join(' › ') : ''}）`}
                onClick={act}
                onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); act() } }}
                onMouseEnter={() => setHover(l.id)} onMouseLeave={() => setHover((h) => (h === l.id ? null : h))}
                onFocus={() => setHover(l.id)} onBlur={() => setHover((h) => (h === l.id ? null : h))}>
                {recent.has(l.id) && <circle className="kn-gt-halo" r={l.r + 5} />}
                <circle className="kn-gt-dot" r={l.r} style={{ fill: color }} />
              </g>
            )
          })}
          {layout.domains.filter((d) => d.labelShown).map((d) => (
            <text key={d.id} className="kn-gt-label" x={d.x} y={d.y - 6} textAnchor="middle" fontSize={labelFs}
              style={{ fill: DOMAIN_COLORS[layout.domains.indexOf(d) % DOMAIN_COLORS.length]! }}>
              {d.name.length > 8 ? `${d.name.slice(0, 7)}…` : d.name}
            </text>
          ))}
        </svg>
        {hovered && hInfo && (
          <div className="kn-gt-tip" role="tooltip" style={{ left: `${(hovered.x / layout.width) * 100}%`, top: `${(hovered.y / layout.height) * 100}%` }}
            data-flip={hovered.x > layout.width * 0.6 ? 'left' : 'right'}>
            <b>{hInfo.topic.name}</b>
            <span>{[hInfo.domain, hInfo.branch].filter(Boolean).join(' › ')}</span>
            <span>首次出現 {hInfo.topic.firstMonth ?? '不明'}・{hInfo.topic.docs} 份文件・{kindLabel(hInfo.topic.kind)}</span>
          </div>
        )}
      </div>
      <p className="kn-gt-legend kn-muted">亮點是題目，大小依文件數；<span className="kn-gt-lg-fresh">脈動</span>＝當月新長；<span className="kn-gt-lg-halo">虛線圈</span>＝近 7 天有變動。點亮點進題目頁。</p>
    </div>
  )
}
