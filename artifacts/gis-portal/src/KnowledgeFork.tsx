// 分岔卡元件（3.2x）：問題在左（菱形），帶條件箭頭指向右側去向卡；窄容器改成直向列表。
// 純函式在 knowledgeFork.ts，樣式在 knowledgeFork.css（class 一律 kfk- 開頭）。
// 這裡只負責畫；跳轉由外部傳 onJump（本任務不接畫面）。

import { useEffect, useRef, useState, type RefObject } from 'react'
import './knowledgeFork.css'
import { stripMarks } from './knowledgeView'
import type { Fork, ForkBranch, ForkTone } from './knowledgeFork'

const NARROW_MAX = 520
const MAX_WIDE = 6
const W = 660
const ROW_H = 64
const QX = 80
const CARD_X = 400
const CARD_W = 248
const CAP_X = 180
const CAP_W = 168
const TONE_VAR: Record<ForkTone, string> = {
  ok: 'var(--c-ok)',
  retry: 'var(--c-warn)',
  stop: 'var(--c-crit)',
  neutral: 'var(--c-ink-2)',
}
const LEGEND: ReadonlyArray<readonly [ForkTone, string]> = [
  ['ok', '綠＝往下走'],
  ['retry', '黃＝退回重做'],
  ['stop', '紅＝流程終止'],
]

/** 容器寬 <520px 視為窄版；拿不到寬度（SSR、沒有 ResizeObserver）當寬版 */
function useNarrow(ref: RefObject<HTMLDivElement | null>): boolean {
  const [narrow, setNarrow] = useState(false)
  useEffect(() => {
    const el = ref.current
    if (!el) return
    const measure = () => setNarrow(el.clientWidth > 0 && el.clientWidth < NARROW_MAX)
    measure()
    if (typeof ResizeObserver !== 'undefined') {
      const ro = new ResizeObserver(measure)
      ro.observe(el)
      return () => ro.disconnect()
    }
    if (typeof window !== 'undefined') {
      window.addEventListener('resize', measure)
      return () => window.removeEventListener('resize', measure)
    }
  }, [ref])
  return narrow
}

function DestCard({ branch, onJump }: { branch: ForkBranch; onJump?: (targetId: string) => void }) {
  const targetId = branch.targetId
  const jump = targetId && onJump ? () => onJump(targetId) : null
  const sub = branch.sub ? (targetId ? `→ ${branch.sub}` : branch.sub) : undefined
  const body = (
    <>
      <span className="kfk-dest-title">{branch.dest}</span>
      {sub && <span className="kfk-dest-sub">{sub}</span>}
    </>
  )
  const cls = `kfk-dest kfk-tone-${branch.tone}${jump ? ' kfk-jump' : ''}`
  if (!jump) return <div className={cls} title={branch.dest}>{body}</div>
  return (
    <div
      className={cls}
      role="button"
      tabIndex={0}
      title={branch.dest}
      onClick={jump}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault()
          jump()
        }
      }}
    >
      {body}
    </div>
  )
}

function Legend({ tones }: { tones: ReadonlySet<ForkTone> }) {
  const present = LEGEND.filter(([t]) => tones.has(t))
  if (present.length === 0) return null
  return (
    <div className="kfk-legend">
      {present.map(([t, label]) => (
        <span key={t} className={`kfk-leg kfk-tone-${t}`}><i className="kfk-dot" aria-hidden="true" />{label}</span>
      ))}
    </div>
  )
}

function PlainList({ fork }: { fork: Fork }) {
  if (fork.plain.length === 0) return null
  return (
    <ul className="kfk-plain">
      {fork.plain.map((b, i) => <li key={i}>{stripMarks(b.text)}</li>)}
    </ul>
  )
}

function WideFork({ fork, onJump }: { fork: Fork; onJump?: (targetId: string) => void }) {
  const shown = fork.branches.slice(0, MAX_WIDE)
  const rest = fork.branches.slice(MAX_WIDE)
  const n = shown.length
  const H = Math.max(200, n * ROW_H + 40)
  const qy = H / 2
  const top = qy - ((n - 1) * ROW_H) / 2
  return (
    <>
      <svg className="kfk-svg" viewBox={`0 0 ${W} ${H}`} width="100%" role="group" aria-label="分岔圖">
        <defs>
          {(['ok', 'retry', 'stop', 'neutral'] as const).map((tone) => (
            <marker key={tone} id={`kfk-arrow-${tone}`} viewBox="0 0 8 8" refX="8" refY="4" markerWidth="8" markerHeight="8" orient="auto-start-reverse">
              <path className="kfk-arrowhead" d="M0 0 L8 4 L0 8 Z" fill={TONE_VAR[tone]} />
            </marker>
          ))}
        </defs>
        <polygon className="kfk-diamond" points={`${QX} ${qy - 46} ${QX + 62} ${qy} ${QX} ${qy + 46} ${QX - 62} ${qy}`} />
        <foreignObject x={QX - 52} y={qy - 40} width={104} height={80}>
          <div className="kfk-q">
            <div className="kfk-q-title" title={fork.question}>{fork.question}</div>
            {fork.sub && <div className="kfk-q-sub" title={fork.sub}>{fork.sub}</div>}
          </div>
        </foreignObject>
        {shown.map((b, i) => {
          const y = top + i * ROW_H
          return (
            <g key={i}>
              <path
                className="kfk-edge"
                d={`M${QX + 62} ${qy} C ${QX + 140} ${qy}, 280 ${y}, ${CARD_X - 2} ${y}`}
                stroke={TONE_VAR[b.tone]}
                markerEnd={`url(#kfk-arrow-${b.tone})`}
              />
              <foreignObject x={CAP_X} y={y - 13} width={CAP_W} height={26}>
                <div className={`kfk-cap kfk-tone-${b.tone}`} title={b.label}>{b.label}</div>
              </foreignObject>
              <foreignObject x={CARD_X} y={y - 24} width={CARD_W} height={48}>
                <DestCard branch={b} onJump={onJump} />
              </foreignObject>
            </g>
          )
        })}
      </svg>
      {rest.length > 0 && (
        <div className="kfk-more">
          <span className="kfk-more-head">其餘分支</span>
          <ul>{rest.map((b, i) => <li key={i}>{b.label} → {b.dest}</li>)}</ul>
        </div>
      )}
    </>
  )
}

function NarrowFork({ fork, onJump }: { fork: Fork; onJump?: (targetId: string) => void }) {
  return (
    <>
      <div className="kfk-narrow-q">
        <div className="kfk-q-title">{fork.question}</div>
        {fork.sub && <div className="kfk-q-sub">{fork.sub}</div>}
      </div>
      {fork.branches.map((b, i) => (
        <div className="kfk-brow" key={i}>
          <div className={`kfk-cap kfk-tone-${b.tone}`} title={b.label}>{b.label}</div>
          <span className="kfk-brow-arrow" aria-hidden="true">→</span>
          <DestCard branch={b} onJump={onJump} />
        </div>
      ))}
    </>
  )
}

export function KnowledgeFork({ fork, onJump }: { fork: Fork; onJump?: (targetId: string) => void }) {
  const ref = useRef<HTMLDivElement>(null)
  const narrow = useNarrow(ref)
  const tones = new Set<ForkTone>(fork.branches.map((b) => b.tone))
  return (
    <div ref={ref} className={`kfk ${narrow ? 'kfk-narrow' : 'kfk-wide'}`} data-layout={narrow ? 'narrow' : 'wide'}>
      {narrow ? <NarrowFork fork={fork} onJump={onJump} /> : <WideFork fork={fork} onJump={onJump} />}
      <PlainList fork={fork} />
      <Legend tones={tones} />
    </div>
  )
}
