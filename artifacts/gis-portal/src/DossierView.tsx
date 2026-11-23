// 卷宗頁（#dossier／#dossier/<kind>/<名稱>）：摘要、橫向時間軸、相關人案物、一層 2D 關係圖、相關知識。
// 資料沿用既有快照（/api/hermes-graph、/api/search/preview、/api/feed/topic-nudges），不新增後端；純邏輯在 dossier.ts。
import { useEffect, useMemo, useRef, useState } from 'react'
import { apiFetchHermesGraph } from './hermesGraphApi'
import { buildIndex, type GraphIndex } from './graphInsights'
import { apiSearchPreview } from './omniSearchApi'
import type { SearchPreview } from './omniSearch'
import { MarkdownView } from './MarkdownView'
import { apiFetchTopicNudges, knowledgeHref, type TopicNudges } from './topicNudges'
import {
  DOSSIER_KIND_LABEL, EGO_VIEW, defaultRailEvent, dossierForEvent, dossierHref, dossierIndex, dossierRows, dossierSummary, egoGraph,
  railItems, relatedRanked, relatedTopics, type DossierKind, type DossierRoute, type RailItem,
} from './dossier'
import { DossierIndex } from './DossierIndex'
import { PinButton } from './PinButton'
import { apiFetchInsights } from './insightApi'
import { insightsForPerson } from './insightLinks'
import { RELATION_LABEL, type Insight } from './insightModel'
import './dossier.css'
import { goto } from './navBack'
import { BackToOrigin } from './BackToOrigin'

const go = (hash: string) => { goto(hash) }
const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s)

type Load = { state: 'loading' } | { state: 'error' } | { state: 'empty' } | { state: 'ok'; index: GraphIndex }

function useGraph(pw: string | null): { load: Load; retry: () => void } {
  const [load, setLoad] = useState<Load>({ state: 'loading' })
  const [tick, setTick] = useState(0)
  useEffect(() => {
    if (!pw) return
    let dead = false
    setLoad({ state: 'loading' })
    apiFetchHermesGraph(pw)
      .then(d => { if (!dead) setLoad(d.available && d.graph ? { state: 'ok', index: buildIndex(d.graph) } : { state: 'empty' }) })
      .catch(() => { if (!dead) setLoad({ state: 'error' }) })
    return () => { dead = true }
  }, [pw, tick])
  return { load, retry: () => setTick(n => n + 1) }
}

/** 選中事件的原文：載入／找不到／失敗的文字沿用舊時間軸 */
function EventBody({ id, pw }: { id: string; pw: string }) {
  const [prev, setPrev] = useState<{ state: 'loading' | 'ok' | 'missing' | 'error'; data: SearchPreview | null }>({ state: 'loading', data: null })
  useEffect(() => {
    const ctl = new AbortController()
    setPrev({ state: 'loading', data: null })
    apiSearchPreview(pw, 'event', id, ctl.signal)
      .then(d => { if (!ctl.signal.aborted) setPrev({ state: d ? 'ok' : 'missing', data: d }) })
      .catch(() => { if (!ctl.signal.aborted) setPrev({ state: 'error', data: null }) })
    return () => ctl.abort()
  }, [pw, id])
  return (
    <div className="dz-rail-text">
      {prev.state === 'loading' && '讀取中…'}
      {prev.state === 'missing' && '找不到這件事件的原文。'}
      {prev.state === 'error' && '原文讀取失敗。'}
      {prev.state === 'ok' && prev.data && (prev.data.bodyMd ? <MarkdownView text={prev.data.bodyMd} /> : <span>{prev.data.one || prev.data.title}</span>)}
    </div>
  )
}

/** 時間軸某天的日記：點了在該處內聯展開；404 顯示「那天沒有日記」 */
function DiaryPeek({ date, pw }: { date: string; pw: string }) {
  const [open, setOpen] = useState(false)
  const [prev, setPrev] = useState<{ state: 'loading' | 'ok' | 'missing' | 'error'; data: SearchPreview | null }>({ state: 'loading', data: null })
  useEffect(() => {
    if (!open) return
    const ctl = new AbortController()
    setPrev({ state: 'loading', data: null })
    apiSearchPreview(pw, 'diary', date, ctl.signal)
      .then(d => { if (!ctl.signal.aborted) setPrev({ state: d ? 'ok' : 'missing', data: d }) })
      .catch(() => { if (!ctl.signal.aborted) setPrev({ state: 'error', data: null }) })
    return () => ctl.abort()
  }, [open, pw, date])
  return (
    <>
      <button type="button" className="dz-diary-btn" aria-expanded={open} onClick={() => setOpen(o => !o)}>看當天日記</button>
      {open && (
        <div className="dz-diary" role="status">
          {prev.state === 'loading' && '讀取中…'}
          {prev.state === 'missing' && '那天沒有日記'}
          {prev.state === 'error' && '日記讀取失敗。'}
          {prev.state === 'ok' && prev.data && (prev.data.bodyMd ? <MarkdownView text={prev.data.bodyMd} /> : <span>{prev.data.one || prev.data.title}</span>)}
        </div>
      )}
    </>
  )
}

function Dossier({ index, kind, name, pw, nudges }: { index: GraphIndex; kind: DossierKind; name: string; pw: string; nudges: TopicNudges | null }) {
  const sum = useMemo(() => dossierSummary(index, kind, name), [index, kind, name])
  const rows = useMemo(() => dossierRows(index, kind, name), [index, kind, name])
  const items = useMemo(() => railItems(rows), [rows])
  const events = useMemo(() => items.filter((it): it is Extract<RailItem, { type: 'event' }> => it.type === 'event'), [items])
  const related = useMemo(() => relatedRanked(index, kind, name, 7), [index, kind, name])
  const ego = useMemo(() => egoGraph(index, kind, name, 12), [index, kind, name])
  const topics = useMemo(() => relatedTopics(nudges, kind, name), [nudges, kind, name])
  const [selId, setSelId] = useState<string | null>(null)
  useEffect(() => { setSelId(defaultRailEvent(rows)) }, [rows])
  const found = events.findIndex(e => e.row.id === selId)
  const cur = found >= 0 ? found : events.length - 1
  const active = cur >= 0 ? events[cur] : null
  const railRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const rail = railRef.current
    const btn = rail?.querySelector<HTMLElement>('[aria-current="step"]')
    if (!rail || !btn) return
    const left = btn.offsetLeft - rail.clientWidth / 2 + btn.clientWidth / 2
    if (typeof rail.scrollTo === 'function') rail.scrollTo({ left, behavior: 'smooth' })
    else rail.scrollLeft = left
  }, [active?.row.id, kind, name])
  const activeId = active?.row.id ?? null
  useEffect(() => {
    if (events.length === 0) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return
      const tg = e.target as HTMLElement | null
      if (tg && (tg.tagName === 'INPUT' || tg.tagName === 'TEXTAREA' || tg.isContentEditable)) return
      const i = events.findIndex(x => x.row.id === activeId)
      if (i < 0) return
      if (e.key === 'ArrowLeft' && i > 0) { e.preventDefault(); setSelId(events[i - 1].row.id) }
      else if (e.key === 'ArrowRight' && i < events.length - 1) { e.preventDefault(); setSelId(events[i + 1].row.id) }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [events, activeId])
  const pick = (i: number) => { const e = events[i]; if (e) setSelId(e.row.id) }
  const [learned, setLearned] = useState<Insight[]>([])
  useEffect(() => {
    setLearned([])
    if (kind !== 'person' || !pw) return
    let dead = false
    apiFetchInsights(pw).then(d => { if (!dead) setLearned(insightsForPerson(d, name)) }, () => { /* 讀不到就不顯示 */ })
    return () => { dead = true }
  }, [kind, name, pw])
  if (!sum) {
    return <p className="dz-note">找不到「{name}」的卷宗。<a className="dz-link" href="#dossier">看卷宗索引</a></p>
  }
  const maxShared = Math.max(...related.map(r => r.shared), 1)
  const maxW = Math.max(...ego.edges.map(e => e.weight), 1)
  const stat = (v: string | number, label: string) => <div className="dz-stat"><b>{v}</b><span>{label}</span></div>
  return (
    <>
      <header className="dz-head">
        <h1 className="dz-title">{sum.title}<span className="dz-tag">{sum.kindLabel}</span></h1>
        <p className="dz-sentence">{sum.sentence}</p>
        <div className="dz-stats">
          {stat(sum.events, '事件數')}{stat(sum.first ?? '—', '首次')}{stat(sum.last ?? '—', '最近')}{stat(sum.people, '相關人數')}
        </div>
        <div className="dz-pinrow">
          <PinButton pw={pw} target={{ targetKind: kind, targetId: name, title: name, href: dossierHref(kind, name) }} />
        </div>
      </header>
      <section className="dz-card" aria-label="時間軸">
        <h2>時間軸</h2>
        {events.length === 0 ? <p className="dz-note">還沒有事件。</p> : (
          <>
            <div className="dz-rail" ref={railRef}>
              {items.map(it => it.type === 'month' ? (
                <span className="dz-rail-month" key={`m:${it.ym}`}>{it.ym}</span>
              ) : (
                <button key={it.row.id} type="button" className={`dz-rail-ev${it.row.id === activeId ? ' dz-cur' : ''}`}
                  aria-current={it.row.id === activeId ? 'step' : undefined} title={it.row.title}
                  onClick={() => setSelId(it.row.id)}>
                  <span className="dz-rail-dot" aria-hidden />
                  <time className="dz-rail-date">{it.row.date ? it.row.date.slice(5) : '日期不明'}</time>
                  <span className="dz-rail-title">{clip(it.row.title, 14)}</span>
                </button>
              ))}
            </div>
            {active && (
              <div className="dz-rail-body">
                <div className="dz-rail-head">
                  <h3 className="dz-rail-h">{active.row.date || '日期不明'}｜{active.row.title}</h3>
                  <div className="dz-rail-nav">
                    <button type="button" disabled={cur <= 0} onClick={() => pick(cur - 1)}>← 上一件</button>
                    <button type="button" disabled={cur >= events.length - 1} onClick={() => pick(cur + 1)}>下一件 →</button>
                  </div>
                </div>
                <EventBody pw={pw} id={active.row.id} />
                {active.diary && <DiaryPeek key={active.row.id} date={active.row.date} pw={pw} />}
              </div>
            )}
          </>
        )}
      </section>
      <div className="dz-cols">
        {kind === 'person' && learned.length > 0 && (
          <section className="dz-card" aria-label="從他身上學到的心得" data-testid="dossier-insights">
            <h2>從他身上學到的心得</h2>
            <ul className="dz-ins">
              {learned.map(i => (
                <li key={i.id}>
                  <a className="dz-ins-row" href={'#insight/' + encodeURIComponent(i.id)}>
                    <span className="dz-ins-d">{i.date}<span className={`it-rel it-rel-${i.relation}`}>{RELATION_LABEL[i.relation]}</span></span>
                    <span className="dz-ins-t">{i.text}</span>
                  </a>
                </li>
              ))}
            </ul>
          </section>
        )}
        <section className="dz-card" aria-label="相關的人案物">
          <h2>相關的人／案／物</h2>
          {related.length === 0 ? <p className="dz-note">沒有共同事件的對象。</p> : (
            <ul className="dz-bars">
              {related.map(r => (
                <li key={`${r.kind}:${r.name}`}>
                  <a className="dz-row" href={dossierHref(r.kind, r.name)}>
                    <span className="dz-row-name">{r.name}<small>{DOSSIER_KIND_LABEL[r.kind]}</small></span>
                    <span className="dz-bar" aria-hidden><i style={{ width: `${Math.round((r.shared / maxShared) * 100)}%` }} /></span>
                    <span className="dz-num">{r.shared}</span>
                  </a>
                </li>
              ))}
            </ul>
          )}
        </section>
        <section className="dz-card" aria-label="關係圖">
          <h2>關係圖</h2>
          {ego.nodes.length === 0 ? <p className="dz-note">沒有可畫的關係。</p> : (
            <svg className="dz-ego" viewBox={`0 0 ${EGO_VIEW.w} ${EGO_VIEW.h}`} role="group" aria-label={`${name} 的一層關係圖`}>
              {ego.edges.map(e => {
                const n = ego.nodes[e.to]
                const w = maxW === 1 ? 1 : 1 + ((e.weight - 1) / (maxW - 1)) * 3
                return <line key={e.to} x1={ego.center.x} y1={ego.center.y} x2={n.x} y2={n.y} strokeWidth={w} />
              })}
              <g className="dz-node dz-center">
                <title>{name}</title>
                <circle cx={ego.center.x} cy={ego.center.y} r={26} />
                <text x={ego.center.x} y={ego.center.y + 4}>{clip(name, 5)}</text>
              </g>
              {ego.nodes.map(n => (
                <g key={`${n.kind}:${n.name}`} className="dz-node" tabIndex={0} role="link" aria-label={`${n.name}，共同事件 ${n.shared}`}
                  onClick={() => go(dossierHref(n.kind, n.name))}
                  onKeyDown={e => { if (e.key === 'Enter') go(dossierHref(n.kind, n.name)) }}>
                  <title>{`${n.name}（${DOSSIER_KIND_LABEL[n.kind]}，共同事件 ${n.shared}）`}</title>
                  <circle cx={n.x} cy={n.y} r={16} />
                  <text x={n.x} y={n.y + 30}>{clip(n.name, 7)}</text>
                </g>
              ))}
            </svg>
          )}
        </section>
        {topics.length > 0 && (
          <section className="dz-card" aria-label="相關知識">
            <h2>相關知識</h2>
            <ul className="dz-topics">
              {topics.map(t => (
                <li key={t.topicId}><a className="dz-link" href={knowledgeHref(t.topicId)}>{t.name}</a>{t.point && <p>{clip(t.point, 80)}</p>}</li>
              ))}
            </ul>
          </section>
        )}
      </div>
    </>
  )
}

export function DossierView({ unlockedPassword, route, onRequestUnlock }: {
  unlockedPassword: string | null
  route: Exclude<DossierRoute, null>
  onRequestUnlock: () => void
}) {
  const { load, retry } = useGraph(unlockedPassword)
  const [nudges, setNudges] = useState<TopicNudges | null>(null)
  useEffect(() => {
    if (!unlockedPassword) return
    let dead = false
    apiFetchTopicNudges(unlockedPassword).then(n => { if (!dead) setNudges(n) }).catch(() => { /* 沒有就不顯示相關知識 */ })
    return () => { dead = true }
  }, [unlockedPassword])
  const rows = useMemo(() => (load.state === 'ok' ? dossierIndex(load.index, 20) : []), [load])
  // 事件網址：圖譜載入後換成該事件的卷宗（案件優先、其次參與者）；換不掉就退回索引。
  const resolved = useMemo(
    () => (route !== 'index' && route.kind === 'event' && load.state === 'ok' ? dossierForEvent(load.index, route.id) : null),
    [route, load],
  )
  useEffect(() => {
    if (route === 'index' || route.kind !== 'event' || load.state !== 'ok') return
    const target = resolved ? dossierHref(resolved.kind, resolved.name) : '#dossier'
    try { window.history.replaceState(window.history.state, '', window.location.pathname + window.location.search + target) } catch { /* 取不到 history 就維持原網址 */ }
  }, [route, load.state, resolved])
  const shown = route === 'index' ? 'index' : route.kind === 'event' ? resolved : route
  return (
    <div className="dz-page">
      <div className="dz-wrap">
        <nav className="dz-nav" aria-label="卷宗導覽">
          <BackToOrigin fallback={<a href="#" onClick={e => { e.preventDefault(); go('') }}>← 回首頁</a>} />
          <a href="#dossier">卷宗索引</a>
        </nav>
        {!unlockedPassword ? (
          <div className="dz-card">
            <p className="dz-note">需要登入才能看卷宗</p>
            <button type="button" className="dz-btn" onClick={onRequestUnlock}>登入</button>
          </div>
        ) : load.state === 'loading' ? <p className="dz-note">讀取中…</p>
        : load.state === 'error' ? (
          <div className="dz-card"><p className="dz-note">圖譜讀取失敗。</p><button type="button" className="dz-btn" onClick={retry}>重試</button></div>
        ) : load.state === 'empty' ? (
          <div className="dz-card"><p className="dz-note">圖譜還沒有資料。</p><button type="button" className="dz-btn" onClick={retry}>重試</button></div>
        ) : shown === 'index' ? (
          <section className="dz-card"><h2>卷宗索引（事件最多的前 20 名）</h2><DossierIndex rows={rows} /></section>
        ) : shown === null ? (
          <div className="dz-card"><p className="dz-note">找不到這件事件的卷宗。<a className="dz-link" href="#dossier">看卷宗索引</a></p></div>
        ) : (
          <Dossier index={load.index} kind={shown.kind} name={shown.name} pw={unlockedPassword} nudges={nudges} />
        )}
      </div>
    </div>
  )
}
