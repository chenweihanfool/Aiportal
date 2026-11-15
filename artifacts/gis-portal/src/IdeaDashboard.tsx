// 想法儀表（2026-11-15）：想法庫抽屜頂端，可收合。數字全來自 ideasView.ideaDashboard（純函式，有測試），這裡只畫。
// 圖是純 SVG／CSS，不引入圖表套件；入口網不寫入，要改狀態一律把一句話帶給 HERMES（onAction）。
import { useMemo, useState } from 'react'
import type { IdeaItem } from './boardApi'
import { CV, FONT } from './theme'
import {
  ACTION_LABEL, ACTION_MARK, FOCUS_COLOR, FOCUS_ICON, FOCUS_LABEL, FOCUS_LIMIT, STAGE_COLOR, STAGE_ICON, STAGE_LABEL, ideaDashboard,
  type IdeaAction,
} from './ideasView'

const STALE_ACTIONS: IdeaAction[] = ['done', 'archive', 'unfocus']

function Stat({ icon, label, value, color, sub }: { icon: string; label: string; value: string; color: string; sub?: string }) {
  return (
    <div style={{ flex: '1 1 5.2rem', minWidth: 0, background: CV.panelRaised, borderRadius: 8, padding: '8px 10px', borderTop: `2px solid ${color}` }}>
      <div style={{ fontSize: '0.64rem', color: CV.steelDim }}><span aria-hidden>{icon}</span> {label}</div>
      <div style={{ fontFamily: FONT.mono, fontWeight: 700, fontSize: '1.25rem', color, lineHeight: 1.25 }}>{value}</div>
      {sub && <div style={{ fontSize: '0.6rem', color: CV.steelDim }}>{sub}</div>}
    </div>
  )
}

/** 12 個月柱狀圖：每月新增（淡色）與完成（實色）並排，滑過或聚焦某個月顯示數字 */
function MonthlyBars({ monthly }: { monthly: Array<{ month: string; born: number; done: number }> }) {
  const [hover, setHover] = useState<number | null>(null)
  const W = 480, H = 110, L = 6, R = W - 6, T = 8, B = H - 20
  const max = Math.max(1, ...monthly.map((m) => Math.max(m.born, m.done)))
  const slot = (R - L) / monthly.length
  const bw = Math.min(14, slot / 2 - 2)
  const h = (n: number) => (n === 0 ? 1.5 : Math.max(3, (n / max) * (B - T)))
  const hv = hover === null ? null : monthly[hover]!
  return (
    <figure style={{ margin: 0, display: 'flex', flexDirection: 'column', gap: 4 }} data-testid="idea-dash-monthly">
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label="近 12 個月新增與完成的想法數" style={{ width: '100%', height: 'auto', display: 'block' }}>
        <line x1={L} x2={R} y1={B} y2={B} stroke={CV.line} />
        {monthly.map((m, i) => {
          const cx = L + slot * i + slot / 2
          return (
            <g key={m.month} tabIndex={0} onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)} onFocus={() => setHover(i)} onBlur={() => setHover(null)}>
              <title>{`${m.month}：新增 ${m.born}、完成 ${m.done}`}</title>
              <rect x={cx - slot / 2} y={0} width={slot} height={H} fill={hover === i ? CV.ink : 'transparent'} fillOpacity={0.06} />
              <rect x={cx - bw - 0.5} y={B - h(m.born)} width={bw} height={h(m.born)} rx={1.5} fill={STAGE_COLOR.candidate} fillOpacity={m.born ? 0.4 : 0.18} />
              <rect x={cx + 0.5} y={B - h(m.done)} width={bw} height={h(m.done)} rx={1.5} fill={STAGE_COLOR.done} fillOpacity={m.done ? 0.95 : 0.18} />
              <text x={cx} y={H - 6} fontSize={9} fill={hover === i ? CV.ink : CV.steelDim} textAnchor="middle" fontFamily={FONT.mono}>{Number(m.month.slice(5))}</text>
            </g>
          )
        })}
      </svg>
      <figcaption style={{ fontSize: '0.66rem', color: CV.steelDim, minHeight: '1.5em' }}>
        {hv
          ? <><b style={{ color: CV.ink }}>{hv.month}</b>　新增 <b style={{ color: STAGE_COLOR.candidate }}>{hv.born}</b>・完成 <b style={{ color: STAGE_COLOR.done }}>{hv.done}</b></>
          : <><span style={{ color: STAGE_COLOR.candidate }}>■</span> 每月新增（淡）　<span style={{ color: STAGE_COLOR.done }}>■</span> 每月完成（實）</>}
      </figcaption>
    </figure>
  )
}

export function IdeaDashboard({ ideas, nowMs, onAction }: {
  ideas: IdeaItem[]
  nowMs: number
  /** 一鍵複製給 HERMES：入口網不寫入，由上層負責帶到對話框或剪貼簿 */
  onAction: (target: { id: string; title: string }, action: IdeaAction) => void
}) {
  const d = useMemo(() => ideaDashboard(ideas, nowMs), [ideas, nowMs])
  const hasMonthly = d.monthly.some((m) => m.born > 0 || m.done > 0)
  const cats = d.byCategory.slice(0, 8)
  const over = d.focusOver
  return (
    <details open className="bd-idea-item" data-testid="idea-dashboard">
      <summary style={{ gridTemplateColumns: 'minmax(0, 1fr)' }}><span style={{ color: CV.ink, fontWeight: 600 }}>📊 想法儀表：候選、聚焦、完成與里程碑</span></summary>
      <div style={{ padding: '2px 12px 12px', display: 'flex', flexDirection: 'column', gap: 12 }}>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
          <Stat icon={STAGE_ICON.candidate} label={STAGE_LABEL.candidate} value={String(d.counts.candidate)} color={STAGE_COLOR.candidate} />
          <Stat icon={FOCUS_ICON} label={FOCUS_LABEL} value={`${d.counts.focus}/${FOCUS_LIMIT}`} color={over ? CV.crit : FOCUS_COLOR} />
          <Stat icon={STAGE_ICON.done} label={STAGE_LABEL.done} value={String(d.counts.done)} color={STAGE_COLOR.done} />
          <Stat icon={STAGE_ICON.archived} label={STAGE_LABEL.archived} value={String(d.counts.archived)} color={STAGE_COLOR.archived} />
        </div>
        {over && <div role="status" data-testid="idea-dash-over" style={{ fontSize: '0.74rem', color: CV.crit }}>聚焦太多，先收一張？</div>}

        {(d.staleFocus.length > 0 || d.staleCandidates > 0) && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }} data-testid="idea-dash-stale">
            {d.staleFocus.length > 0 && <div style={{ fontSize: '0.7rem', color: CV.steel }}>{FOCUS_ICON} 久沒動的聚焦</div>}
            {d.staleFocus.map((s) => (
              <div key={s.id} style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '4px 8px', background: CV.panelRaised, borderRadius: 8, padding: '6px 10px' }}>
                <span style={{ flex: '1 1 10rem', minWidth: 0, fontSize: '0.8rem', color: CV.ink, overflowWrap: 'anywhere' }}>{s.title}<span style={{ color: CV.warn, fontSize: '0.66rem', marginLeft: 6 }}>{s.days} 天沒提</span></span>
                <span style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                  {STALE_ACTIONS.map((a) => (
                    <button key={a} type="button" onClick={() => onAction(s, a)}
                      style={{ fontFamily: FONT.mono, fontSize: '0.64rem', padding: '3px 8px', borderRadius: 5, cursor: 'pointer', background: 'transparent', color: CV.amber, border: `1px solid ${CV.amberDim}` }}>
                      {ACTION_MARK[a]} {a === 'unfocus' ? '回候選' : ACTION_LABEL[a]}
                    </button>
                  ))}
                </span>
              </div>
            ))}
            {d.staleCandidates > 0 && <div style={{ fontSize: '0.7rem', color: CV.steelDim }}>另有 {d.staleCandidates} 個候選超過 90 天沒被想起</div>}
          </div>
        )}

        {hasMonthly
          ? <MonthlyBars monthly={d.monthly} />
          : <p style={{ margin: 0, fontSize: '0.72rem', color: CV.steelDim }}>近 12 個月還沒有新增或完成的紀錄，之後這裡會長出柱子。</p>}

        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px 18px', fontSize: '0.74rem', color: CV.steel }} data-testid="idea-dash-rates">
          <span>完成率 <b style={{ color: CV.ink, fontFamily: FONT.mono }}>{d.doneRate === null ? '—' : `${Math.round(d.doneRate * 100)}%`}</b></span>
          <span>出生到完成中位 <b style={{ color: CV.ink, fontFamily: FONT.mono }}>{d.medianDaysToDone === null ? '—' : `${d.medianDaysToDone} 天`}</b></span>
        </div>

        {cats.length > 0 && (
          <ul aria-label="類別完成率" style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 4 }} data-testid="idea-dash-cats">
            {cats.map((c) => (
              <li key={c.category} title={`${c.category}：${c.done}/${c.total} 完成`} style={{ display: 'grid', gridTemplateColumns: 'minmax(3.5rem, 6rem) minmax(0, 1fr) 2.6rem', alignItems: 'center', gap: 8, fontSize: '0.7rem', color: CV.steel }}>
                <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{c.category}</span>
                <span aria-hidden style={{ height: 6, borderRadius: 3, background: CV.panelRaised, overflow: 'hidden' }}>
                  <i style={{ display: 'block', height: '100%', width: `${Math.round(c.rate * 100)}%`, background: STAGE_COLOR.done }} />
                </span>
                <b style={{ fontFamily: FONT.mono, fontWeight: 400, color: CV.ink, textAlign: 'right' }}>{Math.round(c.rate * 100)}%</b>
              </li>
            ))}
          </ul>
        )}

        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }} data-testid="idea-dash-badges">
          {d.badges.length === 0
            ? <p style={{ margin: 0, fontSize: '0.72rem', color: CV.steelDim }}>完成第一個想法就會點亮第一枚</p>
            : (
              <ul aria-label="想法里程碑" style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexWrap: 'wrap', gap: '4px 6px' }}>
                {d.badges.map((b) => (
                  <li key={b.id} title={b.detail} style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: '0.68rem', color: CV.ink, background: CV.panelRaised, border: `1px solid ${CV.line}`, borderRadius: 999, padding: '2px 9px' }}>
                    <span aria-hidden>{b.icon}</span>{b.title}
                  </li>
                ))}
              </ul>
            )}
          {d.next && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
              <span style={{ fontSize: '0.68rem', color: CV.steel }}>下一個：完成 {d.next.target} 個想法，還差 {d.next.remaining} 個</span>
              <span aria-hidden style={{ height: 5, borderRadius: 3, background: CV.panelRaised, overflow: 'hidden' }}>
                <i style={{ display: 'block', height: '100%', width: `${Math.round(d.next.ratio * 100)}%`, background: STAGE_COLOR.done }} />
              </span>
            </div>
          )}
        </div>
      </div>
    </details>
  )
}
