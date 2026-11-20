import type * as React from 'react'
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'
import type { Insight } from './insightTree'
import { apiFetchVerdicts, apiFetchWeave, apiPostVerdict } from './insightWeaveApi'
import {
  CONF_TEXT, KB_KIND_TEXT, foldVerdicts, verdictOf, weaveIndex,
  type Bridge, type Insufficient, type KbLink, type Lighthouse, type Tension, type Verdict, type WeaveIndex, type WeavePayload,
} from './insightWeave'

// 首頁心得島嶼的「AI 編織層」（3.17.0）：燈塔（原則）、橋（跨島呼應）、張力、知識庫交織。
// 全景只在滑鼠滑過一座島時畫它的編織；進島後從時間軸標題列的「✦ 本島編織」抽屜看；選到一則心得時詳情下方有「✦ AI 編織」欄。
// AI 卡（紫色虛線框）與使用者原話（島色左邊框的引號按鈕）嚴格區分；每條 AI 歸納可 ✓ 確認／✕ 否決並寫回入口網。樣式 ii-wv- 前綴在 portal.css。

const md = (d: string): string => `${d.slice(5, 7)}/${d.slice(8, 10)}`

export type VerdictMap = ReadonlyMap<string, 'ok' | 'no'>

export interface WeaveCtx {
  index: WeaveIndex
  verdicts: VerdictMap
  /** 送出失敗的項目 → 當時想送的判定（顯示「沒送出，重試」） */
  failed: ReadonlyMap<string, 'ok' | 'no'>
  vote: (item: { id: string; status: 'proposed' | 'confirmed' }, clicked: 'ok' | 'no') => void
  byId: ReadonlyMap<string, Insight>
  colorOf: (cid: string) => string
  nameOf: (cid: string) => string
  /** 跳到某則心得（同島就選它，不同島就切島並選它，並關抽屜） */
  jump: (id: string) => void
}

const Ctx = createContext<WeaveCtx | null>(null)
export const WeaveProvider = Ctx.Provider
export const useWeaveCtx = (): WeaveCtx | null => useContext(Ctx)

// ─────────────────────────────────────────────
// 資料：feed＋確認紀錄（在 Body 層抓一次）
// ─────────────────────────────────────────────

export interface WeaveData {
  index: WeaveIndex
  verdicts: VerdictMap
  failed: ReadonlyMap<string, 'ok' | 'no'>
  vote: WeaveCtx['vote']
}

/** 沒有 feed 資料（404、available:false、格式壞、請求失敗、全空）時回 null：所有編織 UI 都不出現，也不報錯。 */
export function useWeaveData(pw: string | null, insights: readonly Insight[]): WeaveData | null {
  const [payload, setPayload] = useState<WeavePayload | null>(null)
  const [verdicts, setVerdicts] = useState<VerdictMap>(new Map())
  const [failed, setFailed] = useState<ReadonlyMap<string, 'ok' | 'no'>>(new Map())
  const vref = useRef<Map<string, 'ok' | 'no'>>(new Map())
  useEffect(() => {
    setPayload(null)
    if (!pw) return
    const ctl = new AbortController()
    ;(async () => {
      const p = await apiFetchWeave(pw, ctl.signal)
      if (ctl.signal.aborted || !p) return
      let rows: Awaited<ReturnType<typeof apiFetchVerdicts>> = []
      try { rows = await apiFetchVerdicts(pw, ctl.signal) } catch { /* 讀不到紀錄就當沒有人判過 */ }
      if (ctl.signal.aborted) return
      const m = foldVerdicts(rows)
      vref.current = m
      setVerdicts(m)
      setPayload(p)
    })().catch(() => { /* 沒有編織資料就不顯示 */ })
    return () => ctl.abort()
  }, [pw])
  const index = useMemo(() => (payload ? weaveIndex(payload, insights) : null), [payload, insights])
  const vote = useCallback<WeaveCtx['vote']>((item, clicked) => {
    if (!pw) return
    const cur = verdictOf(vref.current, item)
    // 只靠 feed 的 confirmed 狀態算已確認時，再按 ✓ 明確記一筆 ok，不送 undo（undo 會被 feed 狀態蓋回去）
    const send: Verdict = cur === clicked && !(clicked === 'ok' && !vref.current.has(item.id)) ? 'undo' : clicked
    const prev = vref.current.get(item.id)
    const next = new Map(vref.current)
    if (send === 'undo') next.delete(item.id); else next.set(item.id, send)
    vref.current = next
    setVerdicts(next)
    setFailed((f) => { if (!f.has(item.id)) return f; const n = new Map(f); n.delete(item.id); return n })
    apiPostVerdict(pw, item.id, send).catch(() => {
      const back = new Map(vref.current)
      if (prev) back.set(item.id, prev); else back.delete(item.id)
      vref.current = back
      setVerdicts(back)
      setFailed((f) => new Map(f).set(item.id, clicked))
    })
  }, [pw])
  if (!index || !index.hasAny) return null
  return { index, verdicts, failed, vote }
}

// ─────────────────────────────────────────────
// 卡片
// ─────────────────────────────────────────────

const clip = (s: string, n: number): string => (s.length > n ? `${s.slice(0, n - 1)}…` : s)

function Evidence({ ids, me }: { ids: readonly string[]; me?: string }) {
  const w = useWeaveCtx()
  if (!w) return null
  return (
    <>
      {ids.map((id) => {
        const it = w.byId.get(id)
        if (!it) return null
        return (
          <button key={id} type="button" className={`ii-wv-ev${me === id ? ' ii-me' : ''}`} data-testid="ii-wv-ev" data-id={id}
            style={{ ['--c' as string]: w.colorOf(it.cluster) }} title="點一下：看這則原話" onClick={() => w.jump(id)}>
            <span className="ii-wv-d">{md(it.date)}</span>「{clip(it.text, 40)}」
          </button>
        )
      })}
    </>
  )
}

function Head({ type, conf }: { type: React.ReactNode; conf: keyof typeof CONF_TEXT }) {
  return (
    <div className="ii-wv-h">
      <span className="ii-wv-tag">✦ AI 歸納</span><span>{type}</span>
      <span className="ii-wv-conf" title="AI 自評信心">{CONF_TEXT[conf]}</span>
    </div>
  )
}

function VerdictBar({ item }: { item: { id: string; status: 'proposed' | 'confirmed' } }) {
  const w = useWeaveCtx()
  if (!w) return null
  const v = verdictOf(w.verdicts, item)
  const bad = w.failed.get(item.id)
  return (
    <div className="ii-wv-act">
      <button type="button" data-testid="ii-wv-ok" data-v="ok" aria-pressed={v === 'ok'} onClick={() => w.vote(item, 'ok')}>✓ 確認</button>
      <button type="button" data-testid="ii-wv-no" data-v="no" aria-pressed={v === 'no'} onClick={() => w.vote(item, 'no')}>✕ 否決</button>
      <span className="ii-wv-st" data-testid="ii-wv-st">{v === 'ok' ? '已確認' : v === 'no' ? '已否決' : '待你確認'}</span>
      {bad && <button type="button" className="ii-link" data-testid="ii-wv-retry" onClick={() => w.vote(item, bad)}>沒送出，重試</button>}
    </div>
  )
}

type CardProps =
  | { kind: 'L'; x: Lighthouse; me?: string }
  | { kind: 'B'; x: Bridge; me?: string }
  | { kind: 'T'; x: Tension; me?: string }
  | { kind: 'K'; x: KbLink; me?: string }

export function WeaveCard(p: CardProps) {
  const w = useWeaveCtx()
  if (!w) return null
  const v = verdictOf(w.verdicts, p.x) ?? ''
  const cls = `ii-wv-c${v ? ` ii-${v}` : ''}`
  const attrs = { className: cls, 'data-testid': 'ii-wv-card', 'data-wid': p.x.id, 'data-kind': p.kind, 'data-v': v } as const
  if (p.kind === 'L') {
    return (
      <div {...attrs}>
        <Head type={`🗼 燈塔 · ${w.nameOf(p.x.cluster)}`} conf={p.x.confidence} />
        <p className="ii-wv-t">{p.x.text}</p>
        <div className="ii-wv-sec2">依據（原話）</div>
        <Evidence ids={p.x.evidence} me={p.me} />
        <VerdictBar item={p.x} />
      </div>
    )
  }
  if (p.kind === 'B') {
    return (
      <div {...attrs}>
        <Head type={`〰 橋 · ${p.x.title}`} conf={p.x.confidence} />
        <p className="ii-wv-t">{p.x.text}</p>
        {p.x.note && <p className="ii-wv-note">註：{p.x.note}</p>}
        {p.x.ends.map((e, i) => (
          <div key={`${e.cluster}${i}`}>
            <div className="ii-wv-end"><i style={{ background: w.colorOf(e.cluster) }} aria-hidden />{w.nameOf(e.cluster)}</div>
            <Evidence ids={e.evidence} me={p.me} />
          </div>
        ))}
        <VerdictBar item={p.x} />
      </div>
    )
  }
  if (p.kind === 'T') {
    return (
      <div {...attrs}>
        <Head type={`⚡ 張力 · ${p.x.clusters.map(w.nameOf).join('／')}`} conf={p.x.confidence} />
        <p className="ii-wv-t">{p.x.text}</p>
        <p className="ii-wv-note">只指出拉扯，不下結論。</p>
        <Evidence ids={p.x.members} me={p.me} />
        <VerdictBar item={p.x} />
      </div>
    )
  }
  return (
    <div {...attrs}>
      <Head type={<>📚 <span className="ii-wv-kbk">{KB_KIND_TEXT[p.x.kind]}</span> {p.x.topic}</>} conf={p.x.confidence} />
      <p className="ii-wv-t">{p.x.text}</p>
      <Evidence ids={p.x.insights.slice(0, 4)} me={p.me} />
      {p.x.insights.length > 4 && <p className="ii-wv-note">…另 {p.x.insights.length - 4} 則</p>}
      <VerdictBar item={p.x} />
    </div>
  )
}

function InsufficientCard({ x, me }: { x: Insufficient; me?: string }) {
  return (
    <div className="ii-wv-c" data-testid="ii-wv-card" data-kind="I">
      <Head type="🗼 燈塔" conf="low" />
      <p className="ii-wv-t">證據不足</p>
      <p className="ii-wv-note">{x.note}</p>
      <Evidence ids={x.evidence} me={me} />
    </div>
  )
}

// ─────────────────────────────────────────────
// 本島編織抽屜（桌機：蓋在時間軸面板右側；手機：底部抽屜）
// ─────────────────────────────────────────────

export function WeaveToggle({ cid, open, onToggle }: { cid: string; open: boolean; onToggle: () => void }) {
  const w = useWeaveCtx()
  if (!w || w.index.total(cid) === 0) return null
  const c = w.index.cluster(cid)
  return (
    <button type="button" className={`ii-wv-btn${open ? ' ii-on' : ''}`} data-testid="ii-wv-toggle" aria-expanded={open} title="AI 從這座島歸納的原則、呼應的島、張力" onClick={onToggle}>
      ✦ 本島編織 <span>{c.lighthouses.length === 0 && c.insufficient && c.bridges.length === 0 && c.tensions.length === 0 && c.kb.length === 0
        ? '🗼證據不足'   // 只有證據不足時別顯示 0 0 0，免得像是什麼都沒有
        : `🗼${c.lighthouses.length} 〰${c.bridges.length} ⚡${c.tensions.length}`}</span>
    </button>
  )
}

export function IslandDrawer({ cid, top, mobile, onClose }: { cid: string; top?: number; mobile?: boolean; onClose: () => void }) {
  const w = useWeaveCtx()
  const ref = useRef<HTMLElement>(null)
  useEffect(() => { ref.current?.scrollTo?.(0, 0) }, [cid])
  if (!w) return null
  const c = w.index.cluster(cid)
  const name = w.nameOf(cid)
  return (
    <aside ref={ref} className={`ii-wv-dr${mobile ? ' ii-wv-mob' : ''}`} style={!mobile && top !== undefined ? { top } : undefined} data-testid="ii-wv-drawer" role="dialog" aria-label={`${name} 本島編織`}>
      <button type="button" className="ii-wv-x" data-testid="ii-wv-close" aria-label="關閉本島編織" onClick={onClose}>×</button>
      <h4 className="ii-wv-dh"><i style={{ background: w.colorOf(cid) }} aria-hidden />{name}：AI 怎麼編這座島</h4>
      <p className="ii-wv-sub"><span className="ii-wv-tag">✦ AI 歸納</span> 不是你寫的原話；點依據可跳到那則心得，逐條確認或否決。</p>
      <h5 className="ii-wv-sec">🗼 這座島的原則</h5>
      {c.lighthouses.length > 0 ? c.lighthouses.map((l) => <WeaveCard key={l.id} kind="L" x={l} />)
        : c.insufficient ? <InsufficientCard x={c.insufficient} /> : <p className="ii-wv-empty">沒有歸納出原則。</p>}
      <h5 className="ii-wv-sec">〰 和哪些島呼應</h5>
      {c.bridges.length > 0 ? c.bridges.map((b) => <WeaveCard key={b.id} kind="B" x={b} />) : <p className="ii-wv-empty">沒有找到跨島呼應。</p>}
      <h5 className="ii-wv-sec">⚡ 還沒想清楚的拉扯</h5>
      {c.tensions.length > 0 ? c.tensions.map((t) => <WeaveCard key={t.id} kind="T" x={t} />) : <p className="ii-wv-empty">沒有已知的張力。</p>}
      <h5 className="ii-wv-sec">📚 與知識庫交織</h5>
      {c.kb.length > 0 ? c.kb.map((k) => <WeaveCard key={k.id} kind="K" x={k} />) : <p className="ii-wv-empty">沒有對應到知識庫主題。</p>}
    </aside>
  )
}

// ─────────────────────────────────────────────
// 單則詳情下方的「✦ AI 編織」欄
// ─────────────────────────────────────────────

export function WeaveColumn({ ins }: { ins: Insight }) {
  const w = useWeaveCtx()
  if (!w) return null
  const r = w.index.insight(ins.id)
  const other = w.index.cluster(ins.cluster).lighthouses.filter((l) => !l.evidence.includes(ins.id)).length
  const lEmpty = r.insufficient ? `證據不足：${r.insufficient.note}`
    : other > 0 ? `沒有直接撐起原則。本島另有 ${other} 條，點上方「✦ 本島編織」看。` : '這則沒有被編進任何原則（可能是一次性的經驗）。'
  return (
    <div className="ii-wv-col" data-testid="ii-wv-col">
      <div className="ii-wv-colh"><span className="ii-wv-tag">✦ AI 編織</span><span>以下是 AI 歸納，不是你寫的原話；每句都能點回依據，請逐條確認或否決。</span></div>
      <div className="ii-wv-grid">
        <div>
          <h5 className="ii-wv-sec">🗼 這則撐起哪條原則</h5>
          {r.lighthouses.length > 0 ? r.lighthouses.map((l) => <WeaveCard key={l.id} kind="L" x={l} me={ins.id} />) : <p className="ii-wv-empty" data-testid="ii-wv-lempty">{lEmpty}</p>}
        </div>
        <div>
          <h5 className="ii-wv-sec">〰 和哪座島呼應</h5>
          {r.bridges.length > 0 ? r.bridges.map((b) => <WeaveCard key={b.id} kind="B" x={b} me={ins.id} />) : <p className="ii-wv-empty">沒有找到跨島呼應。</p>}
        </div>
        <div>
          <h5 className="ii-wv-sec">⚡ 牽涉的張力</h5>
          {r.tensions.length > 0 ? r.tensions.map((t) => <WeaveCard key={t.id} kind="T" x={t} me={ins.id} />) : <p className="ii-wv-empty">沒有牽涉已知的張力。</p>}
        </div>
        <div>
          <h5 className="ii-wv-sec">📚 與知識庫交織</h5>
          {r.kb.length > 0 ? r.kb.map((k) => <WeaveCard key={k.id} kind="K" x={k} me={ins.id} />) : <p className="ii-wv-empty">沒有對應到知識庫主題。</p>}
        </div>
      </div>
    </div>
  )
}

// ─────────────────────────────────────────────
// 全景：滑過一座島才畫它的編織（命令式；Panorama 在 draw 時呼叫，圖層不攔截點擊）
// ─────────────────────────────────────────────

interface Box { x: number; y: number; w: number; h: number }
/** 螢幕座標：島中心、四邊、島名標籤方塊（左上＋大小） */
export interface IslandGeom { cx: number; cy: number; L: number; T: number; R: number; B: number; lab: Box }

const NS = 'http://www.w3.org/2000/svg'
const overlap = (a: Box, b: Box): boolean => a.x < b.x + b.w + 4 && b.x < a.x + a.w + 4 && a.y < b.y + b.h + 3 && b.y < a.y + a.h + 3

export function paintWeave(o: { layer: HTMLElement; svg: SVGSVGElement; hover: string | null; ctx: Pick<WeaveCtx, 'index' | 'verdicts'>; geom: ReadonlyMap<string, IslandGeom> }): void {
  const { layer, svg, hover, ctx, geom } = o
  if (!hover) { if (layer.childElementCount > 0) layer.replaceChildren(); if (svg.childElementCount > 0) svg.replaceChildren(); return }
  const g0 = geom.get(hover)
  layer.replaceChildren()
  svg.replaceChildren()
  if (!g0) return
  const c = ctx.index.cluster(hover)
  const taken: Box[] = [...geom.values()].map((g) => g.lab)
  const add = (cls: string, text: string, testid: string, v: 'ok' | 'no' | null): HTMLElement => {
    const e = document.createElement('span')
    e.className = `${cls}${v ? ` ii-${v}` : ''}`
    e.textContent = text
    e.setAttribute('data-testid', testid)
    layer.appendChild(e)
    return e
  }
  const path = (d: string, stroke: string, width: number, dash: string, opacity: number): void => {
    const p = document.createElementNS(NS, 'path')
    p.setAttribute('d', d); p.setAttribute('fill', 'none'); p.setAttribute('stroke', stroke); p.setAttribute('stroke-width', String(width))
    p.setAttribute('stroke-dasharray', dash); p.setAttribute('stroke-linecap', 'round'); p.setAttribute('opacity', String(opacity))
    svg.appendChild(p)
  }
  const dot = (x: number, y: number, fill: string, opacity: number): void => {
    const e = document.createElementNS(NS, 'circle')
    e.setAttribute('cx', String(x)); e.setAttribute('cy', String(y)); e.setAttribute('r', '4'); e.setAttribute('fill', fill); e.setAttribute('opacity', String(opacity))
    svg.appendChild(e)
  }

  // 燈塔章：島名右側
  const lv = c.lighthouses.length === 0 ? null : c.lighthouses.every((l) => verdictOf(ctx.verdicts, l) === 'no') ? 'no' : c.lighthouses.some((l) => verdictOf(ctx.verdicts, l) === 'ok') ? 'ok' : null
  if (c.lighthouses.length > 0 || c.insufficient) {
    const e = add(`ii-wv-lh${c.lighthouses.length === 0 ? ' ii-none' : ''}`, c.lighthouses.length > 0 ? `🗼 ${c.lighthouses.length}` : '🗼 證據不足', 'ii-wv-lh', lv)
    const lx = g0.lab.x + g0.lab.w + 4
    const ly = g0.lab.y + g0.lab.h / 2
    e.style.left = `${lx}px`; e.style.top = `${ly}px`
    taken.push({ x: lx, y: ly - 11, w: e.offsetWidth, h: 22 })
  }

  // 橋：從這座島到另一端島中心的虛線弧，弧上一個標籤
  c.bridges.forEach((b, n) => {
    const others = b.ends.filter((e, i) => e.cluster !== hover && geom.has(e.cluster) && b.ends.findIndex((x) => x.cluster === e.cluster) === i)
    if (others.length === 0) return
    const v = verdictOf(ctx.verdicts, b)
    let label: { ax: number; ay: number; bx: number; by: number; cx: number; cy: number } | null = null
    others.forEach((end) => {
      const g1 = geom.get(end.cluster)!
      const dx = g1.cx - g0.cx, dy = g1.cy - g0.cy
      const d = Math.hypot(dx, dy) || 1
      const s = (n % 2 ? 1 : -1) * Math.min(0.22, 60 / d + 0.08)
      const cx = (g0.cx + g1.cx) / 2 - dy * s, cy = (g0.cy + g1.cy) / 2 + dx * s
      path(`M${g0.cx},${g0.cy} Q${cx},${cy} ${g1.cx},${g1.cy}`, 'var(--weave-ai)', 3.5, v === 'no' ? '2 6' : '7 5', v === 'no' ? 0.3 : 0.85)
      dot(g0.cx, g0.cy, 'var(--weave-ai)', 0.8); dot(g1.cx, g1.cy, 'var(--weave-ai)', 0.8)
      if (!label) label = { ax: g0.cx, ay: g0.cy, bx: g1.cx, by: g1.cy, cx, cy }
    })
    if (!label) return
    const lb = label as { ax: number; ay: number; bx: number; by: number; cx: number; cy: number }
    const e = add('ii-wv-bl', `〰 ${b.title}`, 'ii-wv-bridge', v)
    const w = e.offsetWidth, h = e.offsetHeight
    const at = (t: number): { x: number; y: number } => { const u = 1 - t; return { x: u * u * lb.ax + 2 * u * t * lb.cx + t * t * lb.bx, y: u * u * lb.ay + 2 * u * t * lb.cy + t * t * lb.by } }
    let best: Box | null = null
    for (const t of [0.5, 0.4, 0.6, 0.3, 0.7, 0.22, 0.78]) {
      const q = at(t)
      const r: Box = { x: q.x - w / 2, y: q.y - h / 2, w, h }
      if (!taken.some((k) => overlap(r, k))) { best = r; break }
    }
    if (!best) { const q = at(0.5); best = { x: q.x - w / 2, y: q.y - h / 2, w, h } }
    taken.push(best)
    e.style.left = `${best.x + w / 2}px`; e.style.top = `${best.y + h / 2}px`
  })

  // 張力：單島標在島左緣，跨島標在兩島之間
  let single = 0
  for (const t of c.tensions) {
    const cs = t.clusters.filter((k) => geom.has(k))
    const v = verdictOf(ctx.verdicts, t)
    let x: number, y: number
    if (cs.length <= 1) {
      x = g0.L; y = g0.T + 26 + single * 34; single++
    } else {
      const other = geom.get(cs.find((k) => k !== hover) ?? cs[0]!)!
      const dx = other.cx - g0.cx, dy = other.cy - g0.cy
      const d = Math.hypot(dx, dy) || 1
      x = (g0.cx + other.cx) / 2 + (dy / d) * 26; y = (g0.cy + other.cy) / 2 - (dx / d) * 26
      for (const g of [g0, other]) path(`M${x},${y} L${g.cx},${g.cy}`, 'var(--weave-tension)', 2.5, '3 4', v === 'no' ? 0.3 : 0.9)
    }
    const e = add('ii-wv-tn', '⚡', 'ii-wv-tension', v)
    e.title = `張力：${t.text}`
    e.style.left = `${x}px`; e.style.top = `${y}px`
    taken.push({ x: x - 16, y: y - 16, w: 32, h: 32 })
  }
}
