import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react'
import { apiFetchInsightDetail, apiFetchInsights } from './insightApi'
import {
  PROVENANCE_LABEL, RELATION_LABEL, clusterLabelText, insightIdFromHash, insightStats, layoutInsightTree, monthSeries, taipeiDay,
  type Insight, type InsightData, type InsightDetail,
} from './insightTree'
import { useAsync } from './homeHooks'
import { blockState } from './homeView'
import { StateFrame } from './StateFrame'
import { PinButton } from './PinButton'
import { pinTargetFor } from './pushTriggers'
import { SearchDiaryReport } from './SearchDiaryReport'

// 首頁「我的心得樹」（2.99.0）：心得隨時間長成枝葉；印證變粗、修正分岔、推翻轉灰，近 30 天的新葉發光，可逐月重播。
// 排版是純函式（insightTree.ts，有測試），這裡只畫 SVG 與側邊面板。樣式 it- 前綴在 portal.css。

const REPLAY_MS = 6000
const MIN_STEP_MS = 60
const clusterColor = (i: number): string => `var(--it-c${i % 12})`
const reducedMotion = (): boolean => typeof window !== 'undefined' && !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches

function useWidth(active: boolean) {
  const ref = useRef<HTMLDivElement>(null)
  const [w, setW] = useState(0)
  useEffect(() => {
    const el = ref.current
    if (!el) return
    const f = () => setW(Math.floor(el.clientWidth))
    f()
    if (typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver(f)
    ro.observe(el)
    return () => ro.disconnect()
  }, [active])
  return { ref, w }
}

export function InsightTree({ pw, now, onRequestUnlock }: { pw: string | null; now: Date; onRequestUnlock: () => void }) {
  const ins = useAsync(pw, apiFetchInsights)
  const data: InsightData | null = ins.data
  const hasTree = !!data && data.insights.length > 0
  const nowMs = now.getTime()
  const st = blockState({ unlocked: !!pw, loading: ins.loading, error: ins.error, hasData: !!data, empty: !!data && data.insights.length === 0, nowMs })
  const { ref: stageRef, w: measured } = useWidth(hasTree && st.state !== 'locked')
  const width = measured > 0 ? measured : 640
  const height = Math.min(520, Math.max(320, Math.round(width * 0.8)))

  const [selected, setSelected] = useState<string | null>(() => (typeof window === 'undefined' ? null : insightIdFromHash(window.location.hash)))
  const [hover, setHover] = useState<string | null>(null)
  const [upto, setUpto] = useState<string | null>(null)
  const [playing, setPlaying] = useState(false)
  const idxRef = useRef(0)

  // #insight/<id>（搜尋、釘選、推送卡的連結）→ 打開那一則的面板
  useEffect(() => {
    const f = () => { const id = insightIdFromHash(window.location.hash); if (id) setSelected(id) }
    window.addEventListener('hashchange', f)
    return () => window.removeEventListener('hashchange', f)
  }, [])

  const day = taipeiDay(now)
  const months = useMemo(() => (data ? monthSeries(data, now) : []), [data, day]) // eslint-disable-line react-hooks/exhaustive-deps
  const layout = useMemo(
    () => (data && hasTree ? layoutInsightTree(data, { width, height, now, upto: upto ?? undefined }) : null),
    [data, hasTree, width, height, day, upto], // eslint-disable-line react-hooks/exhaustive-deps
  )
  const stats = useMemo(() => (data ? insightStats(data, now) : null), [data, day]) // eslint-disable-line react-hooks/exhaustive-deps
  const byId = useMemo(() => new Map((data?.insights ?? []).map((i) => [i.id, i])), [data])

  // ── 重播：約 6 秒逐月推進到今天 ──
  useEffect(() => {
    if (!playing) return
    if (months.length < 2) { setPlaying(false); return }
    const step = Math.max(MIN_STEP_MS, Math.round(REPLAY_MS / months.length))
    const t = window.setInterval(() => {
      idxRef.current += 1
      if (idxRef.current >= months.length - 1) { setUpto(null); setPlaying(false); return }
      setUpto(months[idxRef.current]!)
    }, step)
    return () => window.clearInterval(t)
  }, [playing, months])
  const togglePlay = () => {
    if (playing) { setPlaying(false); return }
    idxRef.current = 0
    setUpto(months[0] ?? null)
    setPlaying(true)
  }
  const monthLabel = upto ?? months[months.length - 1] ?? ''

  const closePanel = useCallback(() => {
    setSelected(null)
    if (insightIdFromHash(window.location.hash)) {
      try { window.history.replaceState(null, '', window.location.pathname + window.location.search) } catch { /* 取不到 history 就維持原網址 */ }
    }
  }, [])

  const hovered = hover && layout ? layout.leaves.find((l) => l.id === hover) : null
  const hoveredIns = hovered ? byId.get(hovered.id) : null
  const open = (id: string) => { setHover(null); setSelected(id) }
  const onLeafKey = (e: ReactKeyboardEvent, id: string) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open(id) } }

  return (
    <section className="it-root" aria-labelledby="it-h" data-testid="insight-tree">
      <div className="it-head">
        <h2 id="it-h" className="it-title">我的心得樹</h2>
        {hasTree && (
          <button type="button" className="it-play" data-testid="insight-play" onClick={togglePlay} disabled={months.length < 2} aria-pressed={playing}>
            {playing ? '⏸ 停' : '▶ 看它怎麼長'}
          </button>
        )}
      </div>
      {stats && hasTree && (
        <p className="it-stats" data-testid="insight-stats">
          心得 {stats.total} 則・本月 +{stats.thisMonth}{stats.topCluster ? `・最常長在「${stats.topCluster.name}」` : ''}
        </p>
      )}
      <StateFrame
        status={st} source="我的心得" onRequestUnlock={onRequestUnlock} onRetry={ins.reload} className="it-frame"
        empty={<span data-testid="insight-empty">心得累積中：HERMES 每晚會從日記抽出你的體會，長成這棵樹</span>}
        errorText="心得暫時讀不到"
        skeleton={<div className="it-skel" data-testid="insight-skeleton" aria-hidden />}
      >
        {layout && (
          <>
            <div className="it-stage" ref={stageRef} style={{ height }}>
              <svg className="it-svg" viewBox={`0 0 ${layout.width} ${layout.height}`} width={layout.width} height={layout.height} role="group" aria-label="我的心得樹">
                <path className="it-trunk" d={layout.trunk.d} strokeWidth={layout.trunk.width} fill="none" strokeLinecap="round" />
                {layout.limbs.map((l) => (
                  <path
                    key={l.id} d={l.d} fill="none" strokeLinecap="round" strokeWidth={l.width} data-level={l.level} data-withered={l.withered ? '1' : undefined}
                    className={`it-limb${l.withered ? ' it-dead' : ''}`} style={{ color: l.clusterIndex !== undefined ? clusterColor(l.clusterIndex) : undefined }} />
                ))}
                {layout.clusters.map((c) => c.labelShown && (
                  <text key={c.id} className="it-clabel" x={c.lx} y={c.ly} textAnchor="middle">{clusterLabelText(c.name)}</text>
                ))}
                {layout.leaves.map((lf) => {
                  const it = byId.get(lf.id)
                  return (
                    <g
                      key={lf.id} className={`it-leaf${lf.withered ? ' it-dead' : ''}${lf.glow ? ' it-glow' : ''}`} data-relation={lf.relation} data-testid="insight-leaf"
                      style={{ color: clusterColor(lf.clusterIndex) }} role="button" tabIndex={0} aria-label={it ? `${it.date} ${it.text}` : lf.id}
                      onClick={() => open(lf.id)} onKeyDown={(e) => onLeafKey(e, lf.id)}
                      onMouseEnter={() => setHover(lf.id)} onMouseLeave={() => setHover((h) => (h === lf.id ? null : h))}
                      onFocus={() => setHover(lf.id)} onBlur={() => setHover((h) => (h === lf.id ? null : h))}
                    >
                      {lf.glow && !lf.withered && <circle className="it-halo" cx={lf.x} cy={lf.y} r={lf.r + 6} />}
                      <circle className="it-dot" cx={lf.x} cy={lf.y} r={lf.r} />
                      {lf.relation === 'overturn' && <circle className="it-ring" cx={lf.x} cy={lf.y} r={lf.r + 2.5} />}
                      {lf.relation === 'reinforce' && <circle className="it-core" cx={lf.x} cy={lf.y} r={lf.r * 0.4} />}
                      {lf.relation === 'refine' && <path className="it-fork" d={`M${lf.x - lf.r * 0.5},${lf.y + lf.r * 0.35} L${lf.x},${lf.y - lf.r * 0.5} L${lf.x + lf.r * 0.5},${lf.y + lf.r * 0.35}`} fill="none" />}
                    </g>
                  )
                })}
              </svg>
              {hovered && hoveredIns && (
                <div className="it-tip" role="tooltip" data-testid="insight-tip" style={{ left: Math.min(Math.max(hovered.x, 120), Math.max(120, layout.width - 120)), top: hovered.y - hovered.r - 8 }}>
                  <span className="it-tip-d">{hoveredIns.date}・{RELATION_LABEL[hoveredIns.relation]}</span>
                  {hoveredIns.text}
                </div>
              )}
            </div>
            <div className="it-foot">
              <span className="it-month" data-testid="insight-month" aria-live="polite">
                {upto ? `${playing ? '重播中' : '停在'} ${monthLabel}` : `${monthLabel}・至今`}
              </span>
              {upto && !playing && <button type="button" className="it-back" onClick={() => setUpto(null)}>回到今天</button>}
              <span className="it-legend">發光＝近 30 天的新葉　灰色＝被推翻　枝越粗＝被印證越多次</span>
            </div>
          </>
        )}
      </StateFrame>
      {selected && <InsightPanel pw={pw} id={selected} fallback={byId.get(selected) ?? null} onClose={closePanel} onSelect={open} />}
    </section>
  )
}

// ─────────────────────────────────────────────
// 側邊面板
// ─────────────────────────────────────────────

type DetailState = { id: string; state: 'loading' | 'ok' | 'missing' | 'error'; data: InsightDetail | null }

export function InsightPanel({ pw, id, fallback, onClose, onSelect }: {
  pw: string | null; id: string; fallback: Insight | null; onClose: () => void; onSelect: (id: string) => void
}) {
  const [det, setDet] = useState<DetailState | null>(null)
  const [showDay, setShowDay] = useState(false)
  const closeRef = useRef<HTMLButtonElement>(null)
  useEffect(() => { closeRef.current?.focus() }, [])
  useEffect(() => {
    const f = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', f)
    return () => window.removeEventListener('keydown', f)
  }, [onClose])
  useEffect(() => { setShowDay(false) }, [id])
  useEffect(() => {
    if (!pw) { setDet(null); return }
    const ctl = new AbortController()
    setDet({ id, state: 'loading', data: null })
    apiFetchInsightDetail(pw, id, ctl.signal)
      .then((d) => { if (!ctl.signal.aborted) setDet({ id, state: d ? 'ok' : 'missing', data: d }) })
      .catch(() => { if (!ctl.signal.aborted) setDet({ id, state: 'error', data: null }) })
    return () => ctl.abort()
  }, [pw, id])

  const cur = det && det.id === id ? det : null
  const d = cur?.state === 'ok' ? cur.data : null
  const text = d?.text ?? fallback?.text ?? ''
  const date = d?.date ?? fallback?.date ?? ''
  const relation = d?.relation ?? fallback?.relation ?? null
  const provenance = d?.provenance ?? fallback?.provenance ?? null
  const items = d && d.threadItems.length > 0 ? d.threadItems : fallback ? [fallback] : []
  const pinTarget = text ? pinTargetFor({ kind: 'insight', id, title: text.length > 60 ? `${text.slice(0, 59)}…` : text }) : null

  return (
    <>
      <div className="it-back-drop" onClick={onClose} aria-hidden />
      <aside className="it-panel" role="dialog" aria-label="心得詳情" data-testid="insight-panel">
        <div className="it-panel-top">
          <span className="it-kd">心得{d ? `・${d.cluster.name}` : ''}</span>
          <button ref={closeRef} type="button" className="it-x" onClick={onClose} aria-label="關閉心得面板">關閉 ✕</button>
        </div>
        <h3 className="it-panel-text" data-testid="insight-panel-text">{text || '（找不到這則心得）'}</h3>
        <div className="it-meta">
          {date && (
            <button type="button" className="it-date" data-testid="insight-date" aria-expanded={showDay} onClick={() => setShowDay((v) => !v)}>
              {date}{d?.time ?? fallback?.time ? ` ${d?.time ?? fallback?.time}` : ''}・看那天日報
            </button>
          )}
          {relation && <span className={`it-rel it-rel-${relation}`}>{RELATION_LABEL[relation]}</span>}
          {provenance && <span className="it-prov">{PROVENANCE_LABEL[provenance]}</span>}
        </div>
        {showDay && date && <div className="it-day" data-testid="insight-day"><SearchDiaryReport date={date} pw={pw} /></div>}
        <h4 className="it-lb">日記原文</h4>
        {!cur || cur.state === 'loading' ? <p className="it-dim">載入中…</p>
          : cur.state === 'error' ? <p className="it-dim" role="status">原文暫時讀不到，稍後再試。</p>
          : cur.state === 'missing' || !d ? <p className="it-dim">這一則沒有原文資料。</p>
          : <>
            <blockquote className="it-evidence" data-testid="insight-evidence">{d.evidence || '（沒有原文）'}</blockquote>
            {d.source && <div className="it-src">出處：{d.source}</div>}
          </>}
        <h4 className="it-lb">整條脈絡</h4>
        <ol className="it-thread" data-testid="insight-thread" aria-label="整條脈絡的時間線">
          {items.map((t) => (
            <li key={t.id} className={t.id === id ? 'it-cur' : undefined} aria-current={t.id === id ? 'true' : undefined}>
              <button type="button" onClick={() => { if (t.id !== id) onSelect(t.id) }}>
                <span className="it-t-d">{t.date}</span>
                <span className={`it-rel it-rel-${t.relation}`}>{RELATION_LABEL[t.relation]}</span>
                <span className="it-t-x">{t.text}</span>
              </button>
            </li>
          ))}
        </ol>
        <div className="it-act"><PinButton pw={pw} target={pinTarget} /></div>
      </aside>
    </>
  )
}
