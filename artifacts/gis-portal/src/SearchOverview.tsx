import { useMemo, useState } from 'react'
import { KIND_ORDER, kindLabel, type SearchKind, type SearchResponse } from './omniSearch'
import { kindSegments, monthBuckets } from './searchViz'

// 搜尋結果最上方的總覽條（2.92.0）：類別分布橫條＋按月直方圖，點了就篩選。狀態在 OmniSearch.tsx，這裡只畫。

export type DateFilter = { type: 'month' | 'before'; ym: string }

const KIND_COLOR = ['var(--c-accent)', 'var(--c-sky)', 'var(--c-warn)', 'var(--c-ok)', 'var(--c-concern)', 'var(--c-mint)']
const kindColor = (k: SearchKind | 'other'): string => (k === 'other' ? 'var(--c-ink-3)' : KIND_COLOR[KIND_ORDER.indexOf(k) % KIND_COLOR.length])

export function dateFilterLabel(d: DateFilter): string { return d.type === 'month' ? d.ym : `早於 ${d.ym}` }

export function SearchOverview({ resp, kindFilter, date, todayYm, onKind, onDate }: {
  /** 基本查詢的回應（q＋月份篩選，不含類別篩選） */
  resp: SearchResponse
  kindFilter: SearchKind | null
  date: DateFilter | null
  todayYm: string
  onKind: (k: SearchKind | null) => void
  onDate: (d: DateFilter | null) => void
}) {
  const segs = useMemo(() => kindSegments(resp.groups), [resp.groups])
  const buckets = useMemo(() => monthBuckets(resp.facets.months, todayYm), [resp.facets.months, todayYm])
  const [tip, setTip] = useState<string | null>(null)
  const max = Math.max(0, ...buckets.map((b) => b.n))
  const total = kindFilter ? (resp.groups.find((g) => g.kind === kindFilter)?.count ?? 0) : resp.total
  const filtered = kindFilter !== null || date !== null

  return (
    <div className="os-viz" aria-label="結果總覽">
      <div className="os-viz-top">
        <span className="os-viz-total" role="status">共 {total} 筆</span>
        {filtered && (
          <span className="os-viz-chips">
            {kindFilter && <button type="button" className="os-viz-chip" onClick={() => onKind(null)} aria-label={`取消類別篩選：${kindLabel(kindFilter)}`}>{kindLabel(kindFilter)} ✕</button>}
            {date && <button type="button" className="os-viz-chip" onClick={() => onDate(null)} aria-label={`取消月份篩選：${dateFilterLabel(date)}`}>{dateFilterLabel(date)} ✕</button>}
            <button type="button" className="os-viz-chip os-viz-all" onClick={() => { onKind(null); onDate(null) }}>全部</button>
          </span>
        )}
      </div>
      <div className="os-viz-grid">
        {segs.length > 0 && (
          <div className="os-viz-kinds" role="group" aria-label="類別分布">
            {segs.map((s) => {
              const label = s.kind === 'other' ? '其他' : kindLabel(s.kind)
              const inner = (
                <>
                  <span className="os-viz-segbar" style={{ background: kindColor(s.kind) }} />
                  <span className="os-viz-seglb">{label} {s.n}</span>
                </>
              )
              const style = { flex: `${Math.max(s.pct, 1)} 1 0` }
              if (s.kind === 'other') return <div key="other" className="os-viz-seg" style={style}>{inner}</div>
              const kind = s.kind
              const on = kindFilter === kind
              return (
                <button key={kind} type="button" className={`os-viz-seg${on ? ' os-viz-on' : ''}`} style={style} aria-pressed={on}
                  aria-label={`${label} ${s.n} 筆`} onClick={() => onKind(on ? null : kind)}>
                  {inner}
                </button>
              )
            })}
          </div>
        )}
        {max > 0 && (
          <div className="os-viz-months">
            <div className="os-viz-bars" role="group" aria-label="按月分布">
              {buckets.map((b) => {
                if (b.older && b.n === 0) return null
                const key = b.older ? 'older' : b.ym
                const label = b.older ? `早於 ${b.before}：${b.n} 筆` : `${b.ym}：${b.n} 筆`
                const f: DateFilter = b.older ? { type: 'before', ym: b.before } : { type: 'month', ym: b.ym }
                const on = date !== null && date.type === f.type && date.ym === f.ym
                return (
                  <button key={key} type="button" className={`os-viz-bar${b.older ? ' os-viz-older' : ''}${on ? ' os-viz-on' : ''}`}
                    disabled={b.n === 0} aria-pressed={on} aria-label={label} title={label}
                    onClick={() => onDate(on ? null : f)}
                    onMouseEnter={() => setTip(label)} onMouseLeave={() => setTip(null)} onFocus={() => setTip(label)} onBlur={() => setTip(null)}>
                    <span className="os-viz-barfill" style={{ height: `${Math.max(b.n > 0 ? 6 : 0, (b.n / max) * 100)}%` }} />
                  </button>
                )
              })}
            </div>
            <div className="os-viz-tip om-lb" aria-hidden="true">{tip ?? '按月分布（點柱篩選）'}</div>
          </div>
        )}
      </div>
    </div>
  )
}
