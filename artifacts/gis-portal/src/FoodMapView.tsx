import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react'
import { COLOR, FONT } from './theme'
import {
  FOOD_STATUS_ICON, FOOD_STATUS_LABEL, areaCounts, coverPhoto, daysBetween, filterPlaces, foodStats, foodStatusMessage, isBeen, nextFoodStatuses,
  priceLabel, projectPlaces, sortPlaces, stars, tagCounts,
  type FoodData, type FoodFilter, type FoodPlace, type FoodSort, type FoodStatus, type FoodStatusFilter,
} from './foodMap'
import { sampleFoodData } from './foodSample'
import { FoodMapGL } from './FoodMapGL'

// ─────────────────────────────────────────────
// 🍜 美食地圖（#food，2026-10-15 原型）
// 地圖＋清單＋標籤／狀態（想吃 → 去過 → 愛店／不再去）。
// 底圖：MapLibre GL（FoodMapGL.tsx，預設 OpenFreeMap 公開圖磚，使用者 2026-10-15 決定要底圖）；
// WebGL 不能用或載入失敗時退回無底圖的 SVG 示意圖。標記與清單以相片為主。
// 目前只顯示 foodSample.ts 的示範資料；正式資料接法與 AdventureLog 的關係見 docs/portal-audit-2026-10.md。
// 入口網只顯示：要改狀態，按鈕會把一句話複製到剪貼簿，貼到 Telegram 給 HERMES 寫進日記（跟想法庫同一套）。
// ─────────────────────────────────────────────

const STATUS_COLOR: Record<FoodStatus, string> = {
  want: COLOR.amber, visited: COLOR.ok, favorite: '#f06292', skip: COLOR.steelDim,
}

const FILTERS: Array<[FoodStatusFilter, string]> = [['all', '全部'], ['want', '🔖 想吃'], ['been', '✅ 去過'], ['favorite', '❤️ 愛店'], ['skip', '🚫 不再去']]
const SORTS: Array<[FoodSort, string]> = [['oldestWant', '想吃最久'], ['recent', '最近'], ['rating', '評分']]

const pill = (active: boolean, color: string = COLOR.amber): CSSProperties => ({
  fontFamily: FONT.mono, fontSize: '0.68rem', padding: '4px 10px', borderRadius: 999, cursor: 'pointer',
  color: active ? COLOR.panelDeep : color, background: active ? color : 'transparent', border: `1px solid ${color}`, whiteSpace: 'nowrap',
})

async function copyText(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) { await navigator.clipboard.writeText(text); return true }
  } catch { /* 改用下面的備援 */ }
  try {
    const ta = document.createElement('textarea')
    ta.value = text
    ta.setAttribute('readonly', '')
    ta.style.position = 'fixed'
    ta.style.opacity = '0'
    document.body.appendChild(ta)
    ta.select()
    const ok = document.execCommand('copy')
    document.body.removeChild(ta)
    return ok
  } catch { return false }
}

function useBox(): [(el: HTMLDivElement | null) => void, { w: number; h: number }] {
  const [el, setEl] = useState<HTMLDivElement | null>(null)
  const [size, setSize] = useState({ w: 480, h: 420 })
  useEffect(() => {
    if (!el) return
    const ro = new ResizeObserver(entries => {
      const r = entries[0]?.contentRect
      if (r) setSize({ w: Math.max(240, Math.round(r.width)), h: Math.max(220, Math.round(r.height)) })
    })
    ro.observe(el)
    return () => ro.disconnect()
  }, [el])
  return [setEl, size]
}

function FoodMapCanvas({ places, selected, onSelect }: { places: FoodPlace[]; selected: string | null; onSelect: (id: string) => void }) {
  const [ref, box] = useBox()
  const proj = useMemo(() => projectPlaces(places, box.w, box.h, 28), [places, box.w, box.h])
  const byId = useMemo(() => new Map(places.map(p => [p.id, p])), [places])
  const unmapped = places.length - proj.points.length
  // 選取的點畫在最上層
  const ordered = [...proj.points].sort((a, b) => (a.id === selected ? 1 : 0) - (b.id === selected ? 1 : 0))
  return (
    <div ref={ref} className="fm-map" style={{ position: 'relative', background: COLOR.panel, border: `1px solid ${COLOR.line}`, borderRadius: 10, overflow: 'hidden' }}>
      <svg width={box.w} height={box.h} role="img" aria-label="美食地圖" style={{ position: 'absolute', inset: 0, display: 'block' }}>
        <defs>
          <radialGradient id="fmGlow"><stop offset="0%" stopColor={COLOR.amber} stopOpacity={0.12} /><stop offset="100%" stopColor={COLOR.amber} stopOpacity={0} /></radialGradient>
        </defs>
        <rect width={box.w} height={box.h} fill="url(#fmGlow)" />
        {Array.from({ length: 9 }, (_, i) => (
          <g key={i} stroke={COLOR.line} strokeWidth={1} opacity={0.35}>
            <line x1={(box.w / 8) * i} x2={(box.w / 8) * i} y1={0} y2={box.h} />
            <line y1={(box.h / 8) * i} y2={(box.h / 8) * i} x1={0} x2={box.w} />
          </g>
        ))}
        {ordered.map(pt => {
          const p = byId.get(pt.id)!
          const on = pt.id === selected
          const c = STATUS_COLOR[pt.status]
          return (
            <g key={pt.id} transform={`translate(${pt.x},${pt.y})`} style={{ cursor: 'pointer' }} onClick={() => onSelect(pt.id)}
              role="button" tabIndex={0} aria-label={`${p.name}（${FOOD_STATUS_LABEL[p.status]}）`}
              onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onSelect(pt.id) } }}>
              {on && <circle r={16} fill="none" stroke={c} strokeWidth={1.5} className="fm-pulse" />}
              <circle r={on ? 8 : 6} fill={c} stroke={COLOR.panelDeep} strokeWidth={2} opacity={pt.status === 'skip' ? 0.6 : 1} />
              {pt.status === 'favorite' && <text y={-11} textAnchor="middle" fontSize={10}>❤️</text>}
              {on && (
                <text x={12} y={4} fontSize={12} fontFamily={FONT.body} fill={COLOR.ink} paintOrder="stroke" stroke={COLOR.panelDeep} strokeWidth={3}>{p.name}</text>
              )}
            </g>
          )
        })}
      </svg>
      <div style={{ position: 'absolute', left: 10, bottom: 8, display: 'flex', gap: 10, flexWrap: 'wrap', fontFamily: FONT.mono, fontSize: '0.6rem', color: COLOR.steelDim }}>
        {(['want', 'visited', 'favorite', 'skip'] as FoodStatus[]).map(s => (
          <span key={s}><i style={{ display: 'inline-block', width: 8, height: 8, borderRadius: '50%', background: STATUS_COLOR[s], marginRight: 4 }} />{FOOD_STATUS_LABEL[s]}</span>
        ))}
        {unmapped > 0 && <span style={{ color: COLOR.warn }}>· {unmapped} 家還沒有座標（只在清單）</span>}
      </div>
      <div style={{ position: 'absolute', right: 10, top: 8, fontFamily: FONT.mono, fontSize: '0.56rem', color: COLOR.steelDim }}>底圖載入失敗或瀏覽器不支援 WebGL：只示意相對位置</div>
    </div>
  )
}

function Gallery({ p }: { p: FoodPlace }) {
  const [open, setOpen] = useState<number | null>(null)
  useEffect(() => { setOpen(null) }, [p.id])
  useEffect(() => {
    if (open === null) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.stopImmediatePropagation(); setOpen(null) }
      else if (e.key === 'ArrowRight') setOpen(i => (i === null ? i : (i + 1) % p.photos.length))
      else if (e.key === 'ArrowLeft') setOpen(i => (i === null ? i : (i - 1 + p.photos.length) % p.photos.length))
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [open, p.photos.length])
  if (p.photos.length === 0) return null
  const cur = open !== null ? p.photos[open] : null
  return (
    <>
      <div className="fm-gallery" aria-label={`${p.name} 的相片`}>
        {p.photos.map((ph, i) => (
          <button key={ph.url} type="button" className="fm-thumb" onClick={() => setOpen(i)} aria-label={`放大第 ${i + 1} 張相片`}>
            <img src={ph.thumb ?? ph.url} alt={ph.caption ?? `${p.name} 相片 ${i + 1}`} loading="lazy" decoding="async" />
          </button>
        ))}
      </div>
      {cur && (
        <div className="fm-lightbox" role="dialog" aria-modal="true" aria-label="相片檢視" onClick={() => setOpen(null)}>
          <img src={cur.url} alt={cur.caption ?? p.name} onClick={e => e.stopPropagation()} />
          <div className="fm-lightbox-cap" onClick={e => e.stopPropagation()}>
            {cur.caption ?? p.name}{cur.takenAt ? ` · ${cur.takenAt}` : ''} · {open! + 1}/{p.photos.length}
            <button type="button" onClick={() => setOpen(null)} style={{ marginLeft: 12, ...pill(false, COLOR.steel) }}>關閉</button>
          </div>
        </div>
      )}
    </>
  )
}

function PlaceDetail({ p, now }: { p: FoodPlace; now: Date }) {
  const [note, setNote] = useState('')
  const [rating, setRating] = useState<number | null>(p.rating)
  const [copied, setCopied] = useState<{ text: string; ok: boolean } | null>(null)
  useEffect(() => { setNote(''); setRating(p.rating); setCopied(null) }, [p.id, p.rating])
  const copy = async (s: FoodStatus) => {
    const text = foodStatusMessage(p, s, rating, note)
    setCopied({ text, ok: await copyText(text) })
  }
  const wantDays = daysBetween(p.addedAt, now)
  return (
    <div className="fm-detail" style={{ border: `1px solid ${STATUS_COLOR[p.status]}`, borderRadius: 10, padding: '0.8rem 0.95rem', background: COLOR.panelRaised, display: 'flex', flexDirection: 'column', gap: 6 }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, flexWrap: 'wrap' }}>
        <span style={{ fontFamily: FONT.mono, fontSize: '0.62rem', color: COLOR.steelDim }}>{p.id}</span>
        <b style={{ color: COLOR.ink, fontSize: '1rem' }}>{p.name}</b>
        <span style={{ fontSize: '0.72rem', color: STATUS_COLOR[p.status] }}>{FOOD_STATUS_ICON[p.status]} {FOOD_STATUS_LABEL[p.status]}</span>
      </div>
      <div style={{ fontSize: '0.74rem', color: COLOR.steel, lineHeight: 1.6 }}>
        {[p.area, p.cuisine, priceLabel(p.priceLevel)].filter(Boolean).join(' · ')}
        {p.status === 'want' ? ` · 想吃 ${wantDays} 天了` : p.visitedAt ? ` · ${p.visitedAt} 去過 · ${stars(p.rating)}` : ''}
      </div>
      <Gallery p={p} />
      {p.why && <div style={{ fontSize: '0.76rem', color: COLOR.ink, lineHeight: 1.6 }}>💭 {p.why}{p.source ? <span style={{ color: COLOR.steelDim }}>（{p.source}）</span> : null}</div>}
      {p.mustTry.length > 0 && <div style={{ fontSize: '0.74rem', color: COLOR.steel }}>👉 必點：{p.mustTry.join('、')}</div>}
      <div style={{ fontSize: '0.68rem', color: COLOR.steelDim }}>出現在日記：{p.days.join('、') || '—'}{p.mapUrl && <> · <a href={p.mapUrl} target="_blank" rel="noopener noreferrer" style={{ color: COLOR.amberDim }}>地圖連結 ↗</a></>}</div>
      <div style={{ borderTop: `1px dashed ${COLOR.line}`, paddingTop: 8, marginTop: 2, display: 'flex', flexDirection: 'column', gap: 6 }}>
        <div style={{ fontSize: '0.72rem', color: COLOR.ink }}>要更新？按一下複製，貼到 Telegram 給 HERMES：</div>
        <div style={{ display: 'flex', gap: 4, alignItems: 'center', fontSize: '0.7rem', color: COLOR.steelDim }} role="radiogroup" aria-label="評分">
          評分
          {[1, 2, 3, 4, 5].map(n => (
            <button key={n} type="button" role="radio" aria-checked={rating === n} onClick={() => setRating(rating === n ? null : n)}
              style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 0, fontSize: '0.95rem', color: rating !== null && n <= rating ? COLOR.amber : COLOR.steelDim }}>★</button>
          ))}
        </div>
        <input value={note} onChange={e => setNote(e.target.value)} placeholder="（選填）補充，例如：湯頭偏鹹、要排 30 分鐘" aria-label="補充說明"
          style={{ background: COLOR.panelDeep, border: `1px solid ${COLOR.line}`, borderRadius: 4, color: COLOR.ink, padding: '5px 8px', fontSize: '0.72rem' }} />
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
          {nextFoodStatuses(p.status).map(s => (
            <button key={s} type="button" style={pill(false, STATUS_COLOR[s])} onClick={() => void copy(s)}>{FOOD_STATUS_ICON[s]} 改成{FOOD_STATUS_LABEL[s]}</button>
          ))}
        </div>
        {copied && (
          <div role="status" style={{ fontSize: '0.7rem', color: copied.ok ? COLOR.ok : COLOR.warn }}>
            {copied.ok ? '已複製：' : '瀏覽器不允許自動複製，請手動選取：'}
            <pre style={{ margin: '4px 0 0', whiteSpace: 'pre-wrap', fontFamily: FONT.mono, color: COLOR.ink }}>{copied.text}</pre>
          </div>
        )}
      </div>
    </div>
  )
}

export function FoodMapView({ onBack, data: dataProp, now: nowProp }: { onBack: () => void; data?: FoodData; now?: Date }) {
  const data = useMemo(() => dataProp ?? sampleFoodData(), [dataProp])
  const now = useMemo(() => nowProp ?? new Date(), [nowProp])
  const [filter, setFilter] = useState<FoodFilter>({ status: 'all', tag: null, area: null, query: '' })
  const [sort, setSort] = useState<FoodSort>('oldestWant')
  const [selected, setSelected] = useState<string | null>(null)
  const [glFailed, setGlFailed] = useState(false)
  const listRef = useRef<HTMLOListElement>(null)

  const stats = useMemo(() => foodStats(data.places, now), [data, now])
  const tags = useMemo(() => tagCounts(data.places).slice(0, 12), [data])
  const areas = useMemo(() => areaCounts(data.places), [data])
  const list = useMemo(() => sortPlaces(filterPlaces(data.places, filter), sort), [data, filter, sort])
  const sel = selected ? data.places.find(p => p.id === selected) ?? null : null

  const pick = (id: string) => {
    setSelected(id)
    listRef.current?.querySelector(`[data-id="${id}"]`)?.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
  }

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setSelected(null) }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const statTiles: Array<[string, string, string?]> = [
    ['想吃', String(stats.want), COLOR.amber],
    ['去過', String(stats.been), COLOR.ok],
    ['實現率', stats.conversionPct !== null ? `${stats.conversionPct}%` : '—'],
    ['今年吃了', `${stats.beenThisYear} 家`],
  ]

  return (
    <div className="fm-page" style={{ position: 'fixed', inset: 0, background: COLOR.panelDeep, display: 'flex', flexDirection: 'column', zIndex: 200, color: COLOR.ink, fontFamily: FONT.body }}>
      <header style={{ display: 'flex', alignItems: 'center', gap: '0.9rem', padding: '0.7rem 1.2rem', borderBottom: `1px solid ${COLOR.line}`, flexWrap: 'wrap' }}>
        <button type="button" onClick={onBack} style={{ cursor: 'pointer', background: 'none', border: 'none', color: COLOR.amberDim, fontFamily: FONT.mono, fontSize: '0.72rem', padding: 0 }}>← 返回儀表板</button>
        <h1 style={{ margin: 0, fontSize: '1.05rem', fontWeight: 700 }}>🍜 美食地圖</h1>
        {data.sample && <span data-testid="food-sample-chip" style={{ fontFamily: FONT.mono, fontSize: '0.6rem', color: COLOR.warn, border: `1px solid ${COLOR.warn}`, borderRadius: 4, padding: '2px 6px' }}>示範資料・尚未接知識庫</span>}
        {stats.oldestWant && (
          <span style={{ marginLeft: 'auto', fontSize: '0.72rem', color: COLOR.steel }}>
            想吃最久：<b style={{ color: COLOR.amber, cursor: 'pointer' }} onClick={() => pick(stats.oldestWant!.place.id)}>{stats.oldestWant.place.name}</b>（{stats.oldestWant.days} 天）
          </span>
        )}
      </header>

      <div className="fm-body" style={{ flex: 1, minHeight: 0, overflow: 'auto', padding: '0.9rem 1.2rem 1.4rem' }}>
        <div className="fm-stats">
          {statTiles.map(([k, v, c]) => (
            <div key={k} style={{ background: COLOR.panel, border: `1px solid ${COLOR.line}`, borderRadius: 8, padding: '0.55rem 0.8rem' }}>
              <div style={{ fontFamily: FONT.mono, fontSize: '0.58rem', letterSpacing: '0.12em', color: COLOR.steelDim }}>{k}</div>
              <div style={{ fontFamily: FONT.mono, fontSize: '1.4rem', fontWeight: 600, color: c ?? COLOR.ink }}>{v}</div>
            </div>
          ))}
        </div>

        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, alignItems: 'center', margin: '0.8rem 0 0.5rem' }}>
          {FILTERS.map(([k, l]) => <button key={k} type="button" style={pill(filter.status === k)} onClick={() => setFilter(f => ({ ...f, status: k }))}>{l}</button>)}
          <input value={filter.query} onChange={e => setFilter(f => ({ ...f, query: e.target.value }))} placeholder="搜尋店名、菜、推薦人…" aria-label="搜尋美食"
            style={{ flex: '1 1 160px', minWidth: 0, background: COLOR.panel, border: `1px solid ${COLOR.line}`, borderRadius: 999, color: COLOR.ink, padding: '5px 12px', fontSize: '0.74rem' }} />
        </div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: '0.8rem' }}>
          {tags.map(([t, n]) => <button key={t} type="button" style={pill(filter.tag === t, COLOR.steel)} onClick={() => setFilter(f => ({ ...f, tag: f.tag === t ? null : t }))}>#{t} {n}</button>)}
          {areas.length > 1 && (
            <select value={filter.area ?? ''} onChange={e => setFilter(f => ({ ...f, area: e.target.value || null }))} aria-label="地區"
              style={{ background: COLOR.panel, color: COLOR.steel, border: `1px solid ${COLOR.line}`, borderRadius: 999, padding: '3px 10px', fontSize: '0.68rem' }}>
              <option value="">全部地區</option>
              {areas.map(([a, n]) => <option key={a} value={a}>{a}（{n}）</option>)}
            </select>
          )}
        </div>

        <div className="fm-split">
          {glFailed
            ? <FoodMapCanvas places={list} selected={selected} onSelect={pick} />
            : <FoodMapGL places={list} selected={selected} onSelect={pick} onFail={() => setGlFailed(true)} />}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8, minWidth: 0, minHeight: 0 }}>
            {sel && <PlaceDetail p={sel} now={now} />}
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: '0.66rem', color: COLOR.steelDim }}>
              <span style={{ flex: 1 }}>{list.length} / {data.places.length} 家</span>
              {SORTS.map(([k, l]) => <button key={k} type="button" style={pill(sort === k, COLOR.steel)} onClick={() => setSort(k)}>{l}</button>)}
            </div>
            {list.length === 0 ? (
              <div style={{ color: COLOR.steelDim, fontSize: '0.78rem', padding: '1rem 0' }}>
                {data.places.length === 0 ? '還沒有美食紀錄。HERMES 在日記寫下 ### HH:MM 🍜 店名 後，下一班 L1 就會出現在這裡。' : '沒有符合的店家'}
              </div>
            ) : (
              <ol ref={listRef} className="fm-list">
                {list.map(p => (
                  <li key={p.id} data-id={p.id}>
                    <button type="button" className={`fm-row${p.id === selected ? ' is-on' : ''}`} onClick={() => setSelected(p.id === selected ? null : p.id)}
                      style={{ borderLeftColor: STATUS_COLOR[p.status] }}>
                      {coverPhoto(p)
                        ? <img className="fm-row-photo" src={coverPhoto(p)!} alt="" loading="lazy" decoding="async" style={{ borderColor: STATUS_COLOR[p.status] }} />
                        : <span style={{ fontSize: '1rem', textAlign: 'center' }} aria-hidden>{FOOD_STATUS_ICON[p.status]}</span>}
                      <span style={{ minWidth: 0, display: 'flex', flexDirection: 'column', gap: 2, textAlign: 'left' }}>
                        <span style={{ color: COLOR.ink, fontWeight: 600, fontSize: '0.82rem' }}>{p.name}</span>
                        <span style={{ color: COLOR.steelDim, fontSize: '0.66rem' }}>
                          {[p.area ?? '地點未知', p.cuisine, priceLabel(p.priceLevel)].filter(Boolean).join(' · ')}
                          {isBeen(p.status) && p.rating !== null ? ` · ${'★'.repeat(p.rating)}` : ''}
                        </span>
                      </span>
                      <span style={{ fontFamily: FONT.mono, fontSize: '0.62rem', color: COLOR.steelDim, whiteSpace: 'nowrap' }}>
                        {p.status === 'want' ? `${daysBetween(p.addedAt, now)} 天` : p.visitedAt?.slice(5) ?? ''}
                      </span>
                    </button>
                  </li>
                ))}
              </ol>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
