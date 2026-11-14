// 卷宗頁（#dossier／#dossier/<kind>/<名稱>）：摘要、按月時間軸、相關人案物、一層 2D 關係圖、相關知識。
// 資料沿用既有快照（/api/hermes-graph、/api/search/preview、/api/feed/topic-nudges），不新增後端；純邏輯在 dossier.ts。
import { useEffect, useMemo, useState } from 'react'
import { apiFetchHermesGraph } from './hermesGraphApi'
import { buildIndex, type GraphIndex } from './graphInsights'
import { apiSearchPreview } from './omniSearchApi'
import type { SearchPreview } from './omniSearch'
import { MarkdownView } from './MarkdownView'
import { apiFetchTopicNudges, knowledgeHref, type TopicNudges } from './topicNudges'
import {
  DOSSIER_KIND_LABEL, EGO_VIEW, dossierForEvent, dossierHref, dossierIndex, dossierRows, dossierSummary, egoGraph, monthGroups,
  relatedRanked, relatedTopics, type DossierKind, type DossierRoute,
} from './dossier'
import { DossierIndex } from './DossierIndex'
import { PinButton } from './PinButton'
import './dossier.css'

const go = (hash: string) => { window.location.hash = hash }
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

function EventRow({ id, date, title, pw, diary }: { id: string; date: string; title: string; pw: string; diary?: boolean }) {
  const [open, setOpen] = useState(false)
  const [prev, setPrev] = useState<{ state: 'loading' | 'ok' | 'missing' | 'error'; data: SearchPreview | null }>({ state: 'loading', data: null })
  useEffect(() => {
    if (!open) return
    const ctl = new AbortController()
    setPrev({ state: 'loading', data: null })
    apiSearchPreview(pw, 'event', id, ctl.signal)
      .then(d => { if (!ctl.signal.aborted) setPrev({ state: d ? 'ok' : 'missing', data: d }) })
      .catch(() => { if (!ctl.signal.aborted) setPrev({ state: 'error', data: null }) })
    return () => ctl.abort()
  }, [open, pw, id])
  return (
    <li className="dz-ev">
      <button type="button" className="dz-ev-btn" aria-expanded={open} onClick={() => setOpen(o => !o)}>
        <time>{date ? date.slice(5) : '日期不明'}</time><span>{title}</span>
      </button>
      {diary && <DiaryPeek date={date} pw={pw} />}
      {open && (
        <div className="dz-ev-body">
          {prev.state === 'loading' && '讀取中…'}
          {prev.state === 'missing' && '找不到這件事件的原文。'}
          {prev.state === 'error' && '原文讀取失敗。'}
          {prev.state === 'ok' && prev.data && (prev.data.bodyMd ? <MarkdownView text={prev.data.bodyMd} /> : <span>{prev.data.one || prev.data.title}</span>)}
        </div>
      )}
    </li>
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
  const groups = useMemo(() => monthGroups(dossierRows(index, kind, name)), [index, kind, name])
  const related = useMemo(() => relatedRanked(index, kind, name, 7), [index, kind, name])
  const ego = useMemo(() => egoGraph(index, kind, name, 12), [index, kind, name])
  const topics = useMemo(() => relatedTopics(nudges, kind, name), [nudges, kind, name])
  const [openMonths, setOpenMonths] = useState<Record<string, boolean>>({})
  useEffect(() => { setOpenMonths({}) }, [kind, name])
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
      <div className="dz-cols">
        <section className="dz-card" aria-label="時間軸">
          <h2>時間軸</h2>
          {groups.length === 0 && <p className="dz-note">還沒有事件。</p>}
          {groups.map(g => {
            const open = openMonths[g.ym] ?? g.open
            return (
              <div className="dz-month" key={g.ym || 'unknown'}>
                <button type="button" className="dz-mhead" aria-expanded={open} onClick={() => setOpenMonths(s => ({ ...s, [g.ym]: !open }))}>
                  {g.ym || '日期不明'} <span>（{g.n} 件）{open ? '' : ' ▸'}</span>
                </button>
                {open && <ul className="dz-evs">{g.rows.map((r, i) => <EventRow key={r.id} id={r.id} date={r.date} title={r.title} pw={pw} diary={/^\d{4}-\d{2}-\d{2}$/.test(r.date) && g.rows.findIndex(x => x.date === r.date) === i} />)}</ul>}
              </div>
            )
          })}
        </section>
        <div>
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
    try { window.history.replaceState(null, '', window.location.pathname + window.location.search + target) } catch { /* 取不到 history 就維持原網址 */ }
  }, [route, load.state, resolved])
  const shown = route === 'index' ? 'index' : route.kind === 'event' ? resolved : route
  return (
    <div className="dz-page">
      <div className="dz-wrap">
        <nav className="dz-nav" aria-label="卷宗導覽">
          <a href="#" onClick={e => { e.preventDefault(); go('') }}>← 回首頁</a>
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
