import { useMemo, useState } from 'react'
import { apiFetchHermesGraph } from './hermesGraphApi'
import { apiFetchReports, parseBrief, pickBrief } from './briefView'
import { buildIndex, caseId, eventId, personId, type GraphIndex } from './graphInsights'
import { GraphShell, type GraphTab } from './GraphShell'
import { requestGraphFocus, type GraphFocus } from './graphFocus'
import { useAsync } from './homeHooks'
import { agoText, dossier, overview, prepForTask, prepIsEmpty, search, type Linked, type RelationEvent, type RelationKind, type RelationRow, type TaskPrep } from './relationsView'

// 關係頁（#relations 找人／案、#relations/prep 見面前）。邏輯在 relationsView.ts；樣式在 portal.css 的 rl-*。
// 3D 宇宙保留在 #graph，從這裡的「在宇宙看」或分頁過去。

type Selected = { kind: RelationKind; name: string }

const todayIso = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Taipei' }).format(new Date())

function openInUniverse(focus: GraphFocus) {
  requestGraphFocus(focus)
  window.location.hash = '#graph'
}

function RowList({ rows, onPick, empty }: { rows: RelationRow[]; onPick: (s: Selected) => void; empty: string }) {
  if (rows.length === 0) return <p className="rl-muted">{empty}</p>
  return (
    <ul className="rl-rows">
      {rows.map((r) => (
        <li key={`${r.kind}-${r.name}`}>
          <button type="button" className="rl-row" onClick={() => onPick(r)}>
            <span className="rl-kind">{r.kind === 'person' ? '人' : '案'}</span>
            <b>{r.name}</b>
            <span className="rl-muted">{r.lastDate || '日期不明'}・{r.count} 件</span>
          </button>
        </li>
      ))}
    </ul>
  )
}

function Chips({ items, kind, onPick }: { items: Array<Linked | string>; kind?: RelationKind; onPick: (s: Selected) => void }) {
  return (
    <div className="rl-chips">
      {items.map((it) => {
        const name = typeof it === 'string' ? it : it.name
        const count = typeof it === 'string' ? null : it.count
        return kind
          ? <button key={name} type="button" className="rl-chip" onClick={() => onPick({ kind, name })}>{name}{count !== null && <i>{count}</i>}</button>
          : <span key={name} className="rl-chip is-static">{name}</span>
      })}
    </div>
  )
}

function EventRows({ events }: { events: RelationEvent[] }) {
  return (
    <ul className="rl-events">
      {events.map((e) => (
        <li key={e.id}>
          <button type="button" className="rl-event" onClick={() => openInUniverse({ kind: 'event', id: eventId(e.id) })}>
            <span className="rl-muted">{e.date || '日期不明'}</span>{e.title}
          </button>
        </li>
      ))}
    </ul>
  )
}

function DossierCard({ index, selected, onPick, onClose }: { index: GraphIndex; selected: Selected; onPick: (s: Selected) => void; onClose: () => void }) {
  const d = useMemo(() => dossier(index, selected.kind, selected.name, todayIso()), [index, selected])
  const focus: GraphFocus = d.kind === 'person' ? { kind: 'person', id: personId(d.name) } : { kind: 'case', id: caseId(d.name) }
  return (
    <section className="rl-card" data-testid="rl-dossier" aria-label={`${d.name} 的卷宗`}>
      <header className="rl-head">
        <h2>{d.name}</h2>
        {d.stateLabel && <span className="rl-chip is-static">{d.stateLabel}</span>}
        <span className="rl-muted">{d.total} 件事{d.lastDate ? `・最近 ${agoText(d.daysSince)}` : ''}</span>
        <button type="button" className="rl-link" onClick={() => openInUniverse(focus)}>在宇宙看 →</button>
        <button type="button" className="rl-link" onClick={onClose}>關閉</button>
      </header>
      {d.assessment && <p className="rl-note">{d.assessment}</p>}
      {d.people.length > 0 && <><h3>相關的人</h3><Chips items={d.people} kind="person" onPick={onPick} /></>}
      {d.cases.length > 0 && <><h3>相關案件</h3><Chips items={d.cases} kind="case" onPick={onPick} /></>}
      {d.methods.length > 0 && <><h3>用過的方法</h3><Chips items={d.methods} onPick={onPick} /></>}
      {d.concepts.length > 0 && <><h3>相關概念</h3><Chips items={d.concepts} onPick={onPick} /></>}
      <h3>最近的事</h3>
      {d.events.length > 0 ? <EventRows events={d.events} /> : <p className="rl-muted">沒有紀錄。</p>}
    </section>
  )
}

function FindTab({ index }: { index: GraphIndex }) {
  const [query, setQuery] = useState('')
  const [selected, setSelected] = useState<Selected | null>(null)
  const rows = useMemo(() => search(index, query), [index, query])
  const base = useMemo(() => overview(index), [index])
  return (
    <div className="rl-body">
      <input className="rl-search" type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="搜尋人名或案件" aria-label="搜尋人名或案件" />
      {selected && <DossierCard index={index} selected={selected} onPick={setSelected} onClose={() => setSelected(null)} />}
      {query.trim()
        ? <RowList rows={rows} onPick={setSelected} empty="找不到這個人或案件。" />
        : (
          <div className="rl-columns">
            <div><h3>最近的人</h3><RowList rows={base.people} onPick={setSelected} empty="還沒有資料。" /></div>
            <div><h3>進行中的案件</h3><RowList rows={base.cases} onPick={setSelected} empty="還沒有資料。" /></div>
          </div>
        )}
    </div>
  )
}

function PrepCard({ prep, onPick }: { prep: TaskPrep; onPick: (s: Selected) => void }) {
  return (
    <article className="rl-card" data-testid="rl-prep">
      <h2>{prep.task.title}</h2>
      {prep.task.next && <p className="rl-note">{prep.task.next}</p>}
      {prepIsEmpty(prep) && <p className="rl-muted">知識庫裡沒有對到相關的人、案件或紀錄。</p>}
      {prep.people.length > 0 && <><h3>會碰到的人</h3><Chips items={prep.people} kind="person" onPick={onPick} /></>}
      {prep.cases.length > 0 && <><h3>相關案件</h3><Chips items={prep.cases} kind="case" onPick={onPick} /></>}
      {prep.methods.length > 0 && <><h3>上次的做法</h3><Chips items={prep.methods} onPick={onPick} /></>}
      {prep.concepts.length > 0 && <><h3>相關概念</h3><Chips items={prep.concepts} onPick={onPick} /></>}
      {prep.events.length > 0 && <><h3>最近相關的事</h3><EventRows events={prep.events} /></>}
    </article>
  )
}

function PrepTab({ index, pw }: { index: GraphIndex; pw: string }) {
  const reports = useAsync(pw, apiFetchReports)
  const [selected, setSelected] = useState<Selected | null>(null)
  const prep = useMemo(() => {
    const brief = pickBrief(reports.data, todayIso())
    const parsed = brief ? parseBrief(brief.bodyMd, brief.date) : null
    return parsed ? { label: brief?.label ?? '', items: parsed.tasks.map((t) => prepForTask(index, t)) } : null
  }, [index, reports.data])
  if (reports.loading) return <p className="rl-muted rl-pad">讀取明日報告中…</p>
  if (reports.error) return <p className="rl-muted rl-pad">明日報告讀取失敗，稍後再試。</p>
  if (!prep) return <p className="rl-muted rl-pad">明日報告每晚 21:00 整理，好了這裡就會對到相關的人與案件。</p>
  return (
    <div className="rl-body">
      <p className="rl-muted">{prep.label}的事，知識庫裡找得到的背景</p>
      {selected && <DossierCard index={index} selected={selected} onPick={setSelected} onClose={() => setSelected(null)} />}
      {prep.items.map((p) => <PrepCard key={p.task.title} prep={p} onPick={setSelected} />)}
    </div>
  )
}

export function RelationsView({ tab, unlockedPassword, onBack, onRequestUnlock }: { tab: Extract<GraphTab, 'find' | 'prep'>; unlockedPassword: string | null; onBack: () => void; onRequestUnlock: () => void }) {
  const graph = useAsync(unlockedPassword, apiFetchHermesGraph)
  const index = useMemo(() => (graph.data?.graph ? buildIndex(graph.data.graph) : null), [graph.data])
  return (
    <GraphShell tab={tab} onBack={onBack}>
      <div className="rl-page">
        {!unlockedPassword && <p className="rl-muted rl-pad">請先解鎖。<button type="button" className="rl-link" onClick={onRequestUnlock}>解鎖</button></p>}
        {graph.error && <p className="rl-muted rl-pad">關係資料讀取失敗，稍後再試。<button type="button" className="rl-link" onClick={graph.reload}>重試</button></p>}
        {graph.loading && <p className="rl-muted rl-pad">讀取中…</p>}
        {graph.data && !index && <p className="rl-muted rl-pad">關係資料還沒推上來。</p>}
        {index && unlockedPassword && (tab === 'find' ? <FindTab index={index} /> : <PrepTab index={index} pw={unlockedPassword} />)}
      </div>
    </GraphShell>
  )
}
