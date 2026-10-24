import type { ReactNode } from 'react'
import { DAY_SLOTS, VIZ_LANES, agoLabel, type ScorePart, type VizItem } from './reportSections'

// 報告段落裡的視覺化子項（reportSections.ts 的 parseViz）各自的小圖。設計：kb-pipeline docs/report-visual-modules.md。
// 每種圖只吃自己那種子項；一個段落可以混用幾種，依第一次出現的順序排。

type Md = (text: string, size?: string) => ReactNode
type Of<K extends VizItem['kind']> = Extract<VizItem, { kind: K }>

/** 時間線：過去的日期可點（打開那天的日報）、未來的日期標倒數；日報在過去與未來之間畫「今天」 */
function Timeline({ items, refDate, showNow, md, onOpenDay }: { items: Of<'day'>[]; refDate: string; showNow: boolean; md: Md; onOpenDay?: (date: string) => void }) {
  const firstFuture = items.findIndex((d) => d.date > refDate)
  const nowAt = firstFuture < 0 ? items.length : firstFuture
  const now = <li key="now" className="rb-echo-now" aria-label="今天"><span className="rb-echo-date"><b>今天</b><small>{refDate.slice(5)}</small></span></li>
  const rows = items.map((d, i) => {
    const future = d.date > refDate
    return (
      <li key={i} data-future={future ? 'true' : undefined}>
        <button type="button" className="rb-echo-date" disabled={future || !onOpenDay} onClick={() => onOpenDay?.(d.date)}
          title={!future && onOpenDay ? `打開 ${d.date} 的日報` : d.date} data-testid="rb-echo-date">
          <b>{d.date}</b><small>{agoLabel(d.date, refDate)}</small>
        </button>
        <div className="rb-echo-t">{md(d.text, '1rem')}</div>
      </li>
    )
  })
  if (showNow || firstFuture >= 0) rows.splice(nowAt, 0, now)
  return <ol className="rb-echo" aria-label="時間線">{rows}</ol>
}

const STRIP_UNIT: Record<string, string> = { day: '週', week: '天', month: '月', quarter: '月', year: '季' }

/** 出現格：一格一個時間單位，由舊到新，最後一格是本期 */
function Strips({ items, level, md }: { items: Of<'thread'>[]; level: string; md: Md }) {
  const unit = STRIP_UNIT[level] ?? '期'
  return (
    <div className="rb-threads" aria-label="脈絡線">
      {items.map((t, i) => (
        <div key={i} className="rb-thread">
          <span className="rb-thread-n">{t.name}</span>
          <span className="rb-thread-cells" role="img" aria-label={`${t.name}：${t.cells.length} ${unit}中有 ${t.cells.filter(Boolean).length} ${unit}出現`}
            style={{ gridTemplateColumns: `repeat(${t.cells.length}, 1fr)` }}>
            {t.cells.map((on, j) => <i key={j} data-on={on ? 'true' : undefined} data-last={j === t.cells.length - 1 ? 'true' : undefined} />)}
          </span>
          {t.text && <span className="rb-thread-t">{md(t.text, '0.95rem')}</span>}
        </div>
      ))}
      <p className="rb-thread-hint">一格一{unit}，由舊到新；最後一格是{level === 'day' ? '這週' : '本期'}</p>
    </div>
  )
}

const TAG_TONES = ['var(--c-accent)', 'var(--c-ok)', 'var(--c-ink-2)', 'var(--c-crit)', 'var(--c-warn)']

/** 時段帶：依時段排好的事件卡（類別上色）＋各類別占幾件的比例條 */
function DaySlots({ items, md }: { items: Of<'slot'>[]; md: Md }) {
  const order = (s: string) => (DAY_SLOTS as readonly string[]).indexOf(s)
  const sorted = items.map((it, i) => ({ it, i })).sort((a, b) => order(a.it.slot) - order(b.it.slot) || a.i - b.i).map((x) => x.it)
  const tags = [...new Set(sorted.map((s) => s.tag))]
  const tone = (tag: string) => TAG_TONES[tags.indexOf(tag) % TAG_TONES.length]
  return (
    <div className="rb-slots-wrap">
      <ol className="rb-slots" aria-label="今天的時段">
        {sorted.map((s, i) => (
          <li key={i} style={{ ['--rb-tag' as string]: tone(s.tag) }}>
            <span className="rb-slot-h"><b>{s.slot}</b><i>{s.tag}</i></span>
            <span className="rb-slot-t">{md(s.text, '0.95rem')}</span>
          </li>
        ))}
      </ol>
      {tags.length > 1 && (
        <div className="rb-mix" aria-label="今天的重心">
          <span className="rb-mix-bar" role="img" aria-label={tags.map((t) => `${t} ${sorted.filter((s) => s.tag === t).length} 件`).join('、')}>
            {tags.map((t) => <i key={t} style={{ flexGrow: sorted.filter((s) => s.tag === t).length, background: tone(t) }} />)}
          </span>
          <span className="rb-mix-legend">
            {tags.map((t) => <span key={t}><i style={{ background: tone(t) }} />{t} {sorted.filter((s) => s.tag === t).length}</span>)}
          </span>
        </div>
      )}
    </div>
  )
}

/** 懸浮天數條：拖越久越長、越紅（7 天黃、14 天紅；30 天以上滿格） */
function StuckBars({ items, md }: { items: Of<'stuck'>[]; md: Md }) {
  const max = Math.max(30, ...items.map((s) => s.days))
  return (
    <ul className="rb-stuck" aria-label="懸浮天數">
      {items.map((s, i) => (
        <li key={i} data-tone={s.days >= 14 ? 'crit' : s.days >= 7 ? 'warn' : undefined}>
          <span className="rb-stuck-t">{md(s.text, '0.95rem')}</span>
          <span className="rb-stuck-track" aria-hidden><i style={{ width: `${Math.max(3, Math.round((s.days / max) * 100))}%` }} /></span>
          <b>{s.days} 天</b>
        </li>
      ))}
    </ul>
  )
}

/** 光譜：兩極之間 5 格，點在哪格；寫成 2→3→4 時畫出走向，最後一點最亮 */
function Spectrums({ items, md }: { items: Of<'spectrum'>[]; md: Md }) {
  return (
    <div className="rb-specs">
      {items.map((s, i) => {
        const last = s.values[s.values.length - 1]!
        return (
          <div key={i} className="rb-spec">
            <div className="rb-spec-row" role="img" aria-label={`${s.left} 到 ${s.right}，${s.values.join(' → ')}／5`}>
              <span className="rb-spec-l" data-on={last <= 2 ? 'true' : undefined}>{s.left}</span>
              <span className="rb-spec-track">
                {[1, 2, 3, 4, 5].map((v) => <i key={v} className="rb-spec-tick" style={{ left: `${(v - 1) * 25}%` }} />)}
                {s.values.length > 1 && (
                  <i className="rb-spec-path" style={{ left: `${(Math.min(...s.values) - 1) * 25}%`, width: `${(Math.max(...s.values) - Math.min(...s.values)) * 25}%` }} />
                )}
                {s.values.map((v, j) => (
                  <i key={j} className="rb-spec-dot" data-last={j === s.values.length - 1 ? 'true' : undefined} style={{ left: `${(v - 1) * 25}%` }} />
                ))}
              </span>
              <span className="rb-spec-r" data-on={last >= 4 ? 'true' : undefined}>{s.right}</span>
            </div>
            {s.text && <div className="rb-spec-t">{md(s.text, '0.95rem')}</div>}
          </div>
        )
      })}
    </div>
  )
}

const LANE_LOOK: Record<string, { icon: string; tone: string }> = {
  延續: { icon: '→', tone: 'var(--c-ink-2)' }, 斷裂: { icon: '✕', tone: 'var(--c-warn)' }, 新出現: { icon: '✦', tone: 'var(--c-accent)' },
  推進: { icon: '▲', tone: 'var(--c-ok)' }, 停滯: { icon: '■', tone: 'var(--c-warn)' },
  進步: { icon: '▲', tone: 'var(--c-ok)' }, 退步: { icon: '▼', tone: 'var(--c-warn)' },
  強化: { icon: '＋', tone: 'var(--c-ok)' }, 鬆動: { icon: '－', tone: 'var(--c-warn)' }, 新浮現: { icon: '✦', tone: 'var(--c-accent)' },
  開始認同: { icon: '＋', tone: 'var(--c-ok)' }, 不再認同: { icon: '－', tone: 'var(--c-warn)' },
}

/** 分欄看板：同一標籤一欄（延續／斷裂／新出現、推進／停滯…），欄序固定 */
function Lanes({ items, md }: { items: Of<'lane'>[]; md: Md }) {
  const lanes = VIZ_LANES.filter((l) => items.some((it) => it.lane === l))
  return (
    <div className="rb-lanes">
      {lanes.map((l) => (
        <div key={l} className="rb-lane" style={{ ['--rb-lane' as string]: LANE_LOOK[l]!.tone }}>
          <div className="rb-lane-h"><span aria-hidden>{LANE_LOOK[l]!.icon}</span>{l}</div>
          <ul>{items.filter((it) => it.lane === l).map((it, i) => <li key={i}>{md(it.text, '0.95rem')}</li>)}</ul>
        </div>
      ))}
    </div>
  )
}

/** 階段步驟：第1週 → 第2週…（或 Q1→Q4、上中下旬），照寫的順序 */
function Phases({ items, md }: { items: Of<'phase'>[]; md: Md }) {
  return (
    <ol className="rb-phases" aria-label="階段">
      {items.map((p, i) => (
        <li key={i}>
          <span className="rb-phase-h">{p.label}</span>
          <span className="rb-phase-t">{md(p.text, '0.95rem')}</span>
        </li>
      ))}
    </ol>
  )
}

/** 一個段落的全部子項：依種類分組，照第一次出現的順序畫 */
export function VizItems({ items, level, refDate, md, onOpenDay }: { items: VizItem[]; level: string; refDate: string; md: Md; onOpenDay?: (date: string) => void }) {
  const kinds = [...new Set(items.map((i) => i.kind))]
  const of = <K extends VizItem['kind']>(k: K) => items.filter((i): i is Of<K> => i.kind === k)
  return (
    <div className="rb-viz">
      {kinds.map((k) => {
        switch (k) {
          case 'day': return <Timeline key={k} items={of('day')} refDate={refDate} showNow={level === 'day'} md={md} onOpenDay={onOpenDay} />
          case 'thread': return <Strips key={k} items={of('thread')} level={level} md={md} />
          case 'slot': return <DaySlots key={k} items={of('slot')} md={md} />
          case 'stuck': return <StuckBars key={k} items={of('stuck')} md={md} />
          case 'spectrum': return <Spectrums key={k} items={of('spectrum')} md={md} />
          case 'lane': return <Lanes key={k} items={of('lane')} md={md} />
          case 'phase': return <Phases key={k} items={of('phase')} md={md} />
        }
      })}
    </div>
  )
}

/** 📊 今日評分段：五角雷達（0–4）＋每項的依據 */
export function ScoreRadar({ total, parts }: { total: number | null; parts: ScorePart[] }) {
  const n = parts.length
  const R = 70
  const pt = (i: number, r: number) => {
    const a = -Math.PI / 2 + (i * 2 * Math.PI) / n
    return [100 + r * Math.cos(a), 95 + r * Math.sin(a)] as const
  }
  const poly = (r: (i: number) => number) => parts.map((_, i) => pt(i, r(i)).map((v) => v.toFixed(1)).join(',')).join(' ')
  return (
    <div className="rb-radar">
      <svg viewBox="0 0 200 190" role="img" aria-label={parts.map((p) => `${p.label} ${p.value}`).join('、')}>
        {[1, 2, 3, 4].map((lv) => <polygon key={lv} points={poly(() => (R * lv) / 4)} className="rb-radar-grid" />)}
        {parts.map((_, i) => { const [x, y] = pt(i, R); return <line key={i} x1={100} y1={95} x2={x} y2={y} className="rb-radar-grid" /> })}
        <polygon points={poly((i) => (R * parts[i]!.value) / 4)} className="rb-radar-area" />
        {parts.map((p, i) => {
          const [x, y] = pt(i, R + 14)
          return <text key={i} x={x} y={y} textAnchor="middle" dominantBaseline="middle" className="rb-radar-l">{p.label} {p.value}</text>
        })}
      </svg>
      <ul className="rb-radar-notes">
        {total !== null && <li className="rb-radar-total"><b>{total}</b> / 100</li>}
        {parts.map((p, i) => <li key={i}><b>{p.label} {p.value}</b>{p.note && <span>{p.note}</span>}</li>)}
      </ul>
    </div>
  )
}
