import { useMemo, useState, type ReactNode } from 'react'
import { KnowledgeSourcePanel } from './KnowledgeSourcePanel'
import { SourceSearchResults } from './KnowledgeSearch'
import { SourceList, TraceProvider, useTopicQuotes, type TraceCtx } from './KnowledgeTrace'
import { BulletText, ConceptBody, MethodBody } from './KnowledgeParts'
import { KnowledgeDiagram } from './KnowledgeDiagram'
import type { HermesTopicQuote } from './hermesDocApi'
import { useAsync, useNow } from './homeHooks'
import {
  buildTree, bulletId, bulletsCiting, changesByDay, cleanGrowthText, filterTopics, groupTopics, isStale, kindLabel, layoutTidyTree, monthSeries, parseBodyWithMarkers, parseTopics, recentChangeOf, treeToLayoutInput,
  type DayChanges,
  type ParsedBody,
  type BuiltTree, type Topic, type TopicChange, type TopicKind, type TopicsData,
} from './knowledgeView'

// 知識頁（#knowledge＝全樹、#knowledge/<id>＝題目頁；2.75.0 改成三欄＋知識樹）。資料來自 feed `topics`（HERMES 每週推送）。
// 純函式在 knowledgeView.ts（有測試）；樣式在 portal.css 的 kn-*。

const API_BASE = import.meta.env.BASE_URL ?? '/'
const UNASSIGNED_ID = '__unassigned'

/** available＝false（或形狀不對）時 data 為 null：畫面顯示「尚未收到推送」 */
interface TopicsFeed { available: boolean; data: TopicsData | null }

async function apiFetchTopics(pw: string): Promise<TopicsFeed> {
  const r = await fetch(`${API_BASE}api/feed/topics`, { headers: { 'x-admin-password': pw } })
  if (!r.ok) throw new Error('Failed to fetch topics')
  const raw = await r.json()
  return { available: (raw as { available?: boolean } | null)?.available === true, data: parseTopics(raw) }
}

/** 顯示用的時間：2026-11-05T21:30:00+08:00 → 2026-11-05 21:30 */
function stamp(iso: string): string {
  return iso.slice(0, 16).replace('T', ' ')
}

function monthRange(t: Topic): string {
  if (t.firstMonth && t.lastMonth) return t.firstMonth === t.lastMonth ? t.firstMonth : `${t.firstMonth}～${t.lastMonth}`
  return ''
}

/* ───────── 最近動態的顯示文字（2.82.0） ───────── */

const CHANGE_LABEL: Record<TopicChange, string> = { 'new-page': '新頁面', 'new-topic': '新題目', revised: '改版' }
const WEEKDAYS = ['日', '一', '二', '三', '四', '五', '六']

function dayLabel(date: string): string {
  return `${Number(date.slice(5, 7))}/${Number(date.slice(8, 10))}（${WEEKDAYS[new Date(`${date}T00:00:00Z`).getUTCDay()]}）`
}

function feedSummary(day: DayChanges, today: string, yesterday: string): string {
  const c = day.counts
  const types: string[] = []
  if (c.newPage > 0) types.push(`新頁面 ${c.newPage}`)
  if (c.newTopic > 0) types.push(`新題目 ${c.newTopic}`)
  if (c.revised > 0) types.push(`改版 ${c.revised}`)
  const kinds: string[] = []
  if (c.concept > 0) kinds.push(`概念 ${c.concept}`)
  if (c.method > 0) kinds.push(`方法 ${c.method}`)
  const when = day.date === today ? '・今天' : day.date === yesterday ? '・昨天' : ''
  return `${dayLabel(day.date)}${when}・${types.join('・')}｜${kinds.join('・')}`
}

function Locked({ onRequestUnlock }: { onRequestUnlock: () => void }) {
  return (
    <div className="kn-empty">
      <p>知識頁是知識庫長出來的主題知識：知識樹、每題的圖文頁面、成長紀錄與題目之間的關係。解鎖後才會讀取資料。</p>
      <button type="button" className="kn-btn" onClick={onRequestUnlock}>🔒 解鎖</button>
    </div>
  )
}

/* ───────── 左欄：知識樹（大綱） ───────── */

function TopicRow({ t, selected, change, onOpen }: { t: Topic; selected: boolean; change?: TopicChange; onOpen: (id: string) => void }) {
  return (
    <li>
      <button type="button" className="kn-tt" data-selected={selected} data-unpublished={t.revision === 0} aria-current={selected ? 'page' : undefined} onClick={() => onOpen(t.id)}>
        <span className="kn-tt-name">{t.name}</span>
        {change && <span className="kn-chg kn-chg--sm" data-chg={change} title={CHANGE_LABEL[change]}>{change === 'revised' ? '改' : '新'}</span>}
      </button>
    </li>
  )
}

function OutlineGroup({ id, label, count, level, open, onToggle, children }: {
  id: string; label: string; count: number; level: 'domain' | 'branch'; open: boolean; onToggle: (id: string) => void; children: ReactNode
}) {
  return (
    <li className="kn-og" data-level={level}>
      <button type="button" className="kn-og-head" aria-expanded={open} onClick={() => onToggle(id)}>
        <span className="kn-caret" aria-hidden="true">{open ? '▾' : '▸'}</span>
        <span className="kn-og-name">{label}</span>
        <span className="kn-count">{count}</span>
      </button>
      {open && <ul className="kn-ol">{children}</ul>}
    </li>
  )
}

function TreePanel({ data, now, selectedId, onOpen, pw, onOpenSource }: {
  data: TopicsData; now: Date; selectedId: string | null; onOpen: (id: string) => void; pw: string; onOpenSource: (key: string, q: string) => void
}) {
  const [mode, setMode] = useState<'topic' | 'source'>('topic')
  const [kind, setKind] = useState<TopicKind | 'all'>('all')
  const [q, setQ] = useState('')
  const [recentOnly, setRecentOnly] = useState(false)
  const [toggled, setToggled] = useState<ReadonlySet<string>>(new Set())
  const recent = useMemo(() => recentChangeOf(data.topics, now, 7), [data.topics, now])
  const filtered = useMemo(() => {
    const base = filterTopics(data.topics, { kind, q: mode === 'topic' ? q : '' })
    return recentOnly ? base.filter((t) => recent.has(t.id)) : base
  }, [data.topics, kind, q, mode, recentOnly, recent])
  const built = useMemo(() => buildTree({ topics: filtered, tree: data.tree }), [filtered, data.tree])
  // 預設展開第一層（領域）；選中題目所在的枝與領域自動展開；搜尋或只看近 7 天時命中的祖先全部展開
  const searching = (mode === 'topic' && q.trim() !== '') || kind !== 'all' || recentOnly
  const autoOpen = useMemo(() => {
    const s = new Set<string>()
    for (const d of built.domains) {
      s.add(d.id)
      for (const b of d.branches) {
        if (searching && b.count > 0) s.add(b.id)
        if (selectedId && b.topics.some((t) => t.id === selectedId)) s.add(b.id)
      }
    }
    if (searching || (selectedId && built.unassigned.some((t) => t.id === selectedId))) s.add(UNASSIGNED_ID)
    return s
  }, [built, searching, selectedId])
  // toggled＝使用者按過的（相對於 autoOpen 反轉）
  const isOpen = (id: string) => (toggled.has(id) ? !autoOpen.has(id) : autoOpen.has(id))
  const toggle = (id: string) => setToggled((prev) => {
    const n = new Set(prev)
    if (n.has(id)) n.delete(id)
    else n.add(id)
    return n
  })

  return (
    <nav className="kn-tree" aria-label="知識樹">
      <h2 className="kn-col-title">知識樹</h2>
      <div className="kn-seg" role="group" aria-label="搜尋範圍">
        {([['topic', '題目'], ['source', '原文']] as const).map(([k, label]) => (
          <button key={k} type="button" aria-pressed={mode === k} onClick={() => setMode(k)}>{label}</button>
        ))}
      </div>
      <input type="search" className="kn-search" placeholder={mode === 'topic' ? '搜尋題目名稱' : '搜尋來源原文'} aria-label={mode === 'topic' ? '搜尋題目' : '搜尋原文'} value={q} onChange={(e) => setQ(e.target.value)} />
      {mode === 'source' && <SourceSearchResults pw={pw} q={q} onPick={onOpenSource} />}
      {mode === 'topic' && <>
      <div className="kn-seg" role="group" aria-label="種類篩選">
        {([['all', '全部'], ['concept', '概念'], ['method', '方法']] as const).map(([k, label]) => (
          <button key={k} type="button" aria-pressed={kind === k} onClick={() => setKind(k)}>{label}</button>
        ))}
      </div>
      <button type="button" className="kn-recent-btn" aria-pressed={recentOnly} onClick={() => setRecentOnly((v) => !v)}>只看近 7 天</button>
      {filtered.length === 0 && <p className="kn-muted">沒有符合的題目。</p>}
      <ul className="kn-ol kn-ol--root">
        {built.domains.filter((d) => !searching || d.count > 0).map((d) => (
          <OutlineGroup key={d.id} id={d.id} label={d.name} count={d.count} level="domain" open={isOpen(d.id)} onToggle={toggle}>
            {d.branches.filter((b) => !searching || b.count > 0).map((b) => (
              <OutlineGroup key={b.id} id={b.id} label={b.name} count={b.count} level="branch" open={isOpen(b.id)} onToggle={toggle}>
                {b.topics.map((t) => <TopicRow key={t.id} t={t} selected={t.id === selectedId} change={recent.get(t.id)} onOpen={onOpen} />)}
              </OutlineGroup>
            ))}
          </OutlineGroup>
        ))}
        {built.unassigned.length > 0 && (
          <OutlineGroup id={UNASSIGNED_ID} label="未歸類" count={built.unassigned.length} level="domain" open={isOpen(UNASSIGNED_ID)} onToggle={toggle}>
            {built.unassigned.map((t) => <TopicRow key={t.id} t={t} selected={t.id === selectedId} change={recent.get(t.id)} onOpen={onOpen} />)}
          </OutlineGroup>
        )}
      </ul>
      </>}
    </nav>
  )
}

/* ───────── 中欄：全樹 ───────── */

function Stats({ data, now }: { data: TopicsData; now: Date }) {
  const recentCount = useMemo(() => groupTopics(data.topics, now).recent.length, [data.topics, now])
  return (
    <p className="kn-stats">
      共 <b>{data.total}</b> 題、已有頁面 <b>{data.published}</b> 題、本週長大 <b>{recentCount}</b> 題・更新於 {stamp(data.computedAt)}
    </p>
  )
}

function FullTree({ built, onOpen }: { built: BuiltTree; onOpen: (id: string) => void }) {
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(new Set())
  const layout = useMemo(() => layoutTidyTree(treeToLayoutInput(built), { collapsed, dx: 190 }), [built, collapsed])
  const toggle = (id: string) => setCollapsed((prev) => {
    const n = new Set(prev)
    if (n.has(id)) n.delete(id)
    else n.add(id)
    return n
  })
  if (built.domains.length === 0 && built.unassigned.length === 0) return <p className="kn-muted">還沒有題目。</p>
  const pos = new Map(layout.nodes.map((n) => [n.id, n]))
  const W = layout.width + 240
  return (
    <div className="kn-fulltree">
      <svg viewBox={`0 0 ${W} ${layout.height}`} width={W} height={layout.height} role="group" aria-label="全樹">
        {layout.edges.map((e) => {
          const a = pos.get(e.from)!
          const b = pos.get(e.to)!
          const mx = (a.x + b.x) / 2
          return <path key={`${e.from}-${e.to}`} className="kn-edge" d={`M${a.x},${a.y} C${mx},${a.y} ${mx},${b.y} ${b.x},${b.y}`} />
        })}
        {layout.nodes.map((n) => {
          const isTopic = n.kind === 'topic'
          const folded = collapsed.has(n.id)
          const act = () => (isTopic ? onOpen(n.id) : toggle(n.id))
          return (
            <g key={n.id} className="kn-tnode" data-kind={n.kind} data-folded={folded} role={isTopic ? 'link' : 'button'} tabIndex={0}
              aria-label={isTopic ? n.label : `${n.label}（${folded ? '展開' : '收合'}）`}
              onClick={act} onKeyDown={(ev) => { if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); act() } }}>
              <circle cx={n.x} cy={n.y} r={n.r} />
              <text x={isTopic ? n.x + n.r + 6 : n.x} y={isTopic ? n.y + 4 : n.y - n.r - 5} textAnchor="start">{n.label.length > 14 ? `${n.label.slice(0, 13)}…` : n.label}<title>{n.label}</title></text>
            </g>
          )
        })}
      </svg>
    </div>
  )
}

function RecentChanges({ data, now, onOpen }: { data: TopicsData; now: Date; onOpen: (id: string) => void }) {
  const days = useMemo(() => changesByDay(data.topics, now, 14), [data.topics, now])
  const today = useMemo(() => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Taipei' }).format(now), [now])
  const yesterday = useMemo(() => new Date(Date.parse(`${today}T00:00:00Z`) - 86_400_000).toISOString().slice(0, 10), [today])
  return (
    <section className="kn-feed" aria-label="最近動態">
      <h2 className="kn-h2">最近動態</h2>
      {days.length === 0 ? <p className="kn-muted">近 14 天沒有新增或改版。</p> : days.map((day, i) => (
        <details key={day.date} open={i < 3}>
          <summary>{feedSummary(day, today, yesterday)}</summary>
          <ul className="kn-feed-list">
            {day.items.map((it) => (
              <li key={it.topic.id}>
                <span className="kn-chg" data-chg={it.change}>{CHANGE_LABEL[it.change]}</span>
                <span className="kn-kind" data-kind={it.topic.kind}>{kindLabel(it.topic.kind)}</span>
                <button type="button" className="kn-link" onClick={() => onOpen(it.topic.id)}>{it.topic.name}</button>
                <span className="kn-muted">{it.detail}</span>
              </li>
            ))}
          </ul>
        </details>
      ))}
    </section>
  )
}

function TreeOverview({ data, now, onOpen }: { data: TopicsData; now: Date; onOpen: (id: string) => void }) {
  const built = useMemo(() => buildTree(data), [data])
  return (
    <>
      <Stats data={data} now={now} />
      <RecentChanges data={data} now={now} onOpen={onOpen} />
      <h2 className="kn-h2">全樹</h2>
      <p className="kn-muted">點領域或枝可收合，點題目進入題目頁。{!data.tree && '推送端還沒更新知識樹，題目暫時都在「未歸類」。'}</p>
      <FullTree built={built} onOpen={onOpen} />
    </>
  )
}

/* ───────── 中欄：題目頁 ───────── */

function TopicPage({ t, parsed, hl, cited, topics, quotes, onOpen, onSelect, onView, onViewQ }: {
  t: Topic; parsed: ParsedBody | null; hl: number | null; cited: ReadonlySet<string>; topics: readonly Topic[]
  quotes: readonly HermesTopicQuote[] | null
  onOpen: (id: string) => void; onSelect: (n: number) => void; onView: (n: number) => void; onViewQ: (n: number, q: string) => void
}) {
  const range = monthRange(t)
  const [live, setLive] = useState(false)
  const isMethod = parsed?.format === 'method'
  const liveOn = live && isMethod
  const [textOpen, setTextOpen] = useState(true)
  const showDiagram = !!t.diagram && !liveOn
  const body = parsed ? (
    <>
          {parsed.format === 'concept' && <ConceptBody t={t} parsed={parsed} topics={topics} cited={cited} onOpen={onOpen} />}
          {parsed.format === 'method' && <MethodBody t={t} parsed={parsed} topics={topics} cited={cited} onOpen={onOpen} live={liveOn} />}
          {parsed.format === 'legacy' && parsed.what.length > 0 && (
            <section className="kn-section" aria-label="這件事在幹嘛">
              <h3>這件事在幹嘛</h3>
              <ul className="kn-plain">{parsed.what.map((b, i) => <li key={i}><BulletText b={b} bid={bulletId('what', i)} cited={cited} /></li>)}</ul>
            </section>
          )}
          {parsed.format === 'legacy' && parsed.how.length > 0 && (
            <section className="kn-section" aria-label="怎麼做">
              <h3>怎麼做</h3>
              <ol className="kn-steps">{parsed.how.map((b, i) => <li key={i}><span className="kn-stepno" aria-hidden="true">{i + 1}</span><div><BulletText b={b} bid={bulletId('how', i)} cited={cited} /></div></li>)}</ol>
            </section>
          )}
          {parsed.format === 'legacy' && parsed.caution.length > 0 && (
            <section className="kn-section" aria-label="要注意">
              <h3>要注意</h3>
              <ul className="kn-cautions">{parsed.caution.map((b, i) => <li key={i}><span aria-hidden="true">⚠</span><div><BulletText b={b} bid={bulletId('caution', i)} cited={cited} /></div></li>)}</ul>
            </section>
          )}
          {!liveOn && parsed.unknown.length > 0 && (
            <section className="kn-section" aria-label="還不知道">
              <h3>還不知道</h3>
              <ul className="kn-unknowns">{parsed.unknown.map((b, i) => <li key={i}><span aria-hidden="true">？</span><div><BulletText b={b} bid={bulletId('unknown', i)} cited={cited} /></div></li>)}</ul>
            </section>
          )}
          {!liveOn && parsed.other && <section className="kn-section" aria-label="其他"><p className="kn-other">{parsed.other}</p></section>}
    </>
  ) : null
  return (
    <article className="kn-page" data-live={liveOn}>
      {!liveOn && t.path.length > 0 && <p className="kn-crumb">{t.path.join(' › ')}</p>}
      <h2 className="kn-title">{t.name} <span className="kn-kind" data-kind={t.kind}>{kindLabel(t.kind)}</span></h2>
      {isMethod && <button type="button" className="kn-btn kn-live-btn" aria-pressed={live} onClick={() => setLive((v) => !v)}>{live ? '離開現場模式' : '現場模式'}</button>}
      {!liveOn && t.why && <p className="kn-why">{t.why}</p>}
      {!liveOn && (
        <p className="kn-meta">
          <span>{t.docs} 份來源</span>
          {t.monthsSpan > 0 && <span>橫跨 {t.monthsSpan} 個月{range ? `（${range}）` : ''}</span>}
          <span>{t.updated ? `更新於 ${t.updated}` : '尚未成頁'}</span>
          {t.newDocs > 0 && <span className="kn-new">＋{t.newDocs} 新素材</span>}
        </p>
      )}
      {parsed?.format === 'legacy' && <p className="kn-legacy-note">舊格式，之後會自動換成新版</p>}

      {parsed && parsed.summary && (
        <section className="kn-summary" aria-label="一句話">
          <h3>一句話</h3>
          <p><BulletText b={parsed.summary} bid={bulletId('summary')} cited={cited} /></p>
        </section>
      )}
      {parsed && showDiagram && t.diagram && <KnowledgeDiagram topic={t} diagram={t.diagram} quotes={quotes} onOpenSource={onViewQ} />}

      <div className="kn-reading">
        <div className="kn-reading-main">
          {!parsed && <p className="kn-muted">這題還在累積素材，每週會挑幾題寫成頁面。</p>}
          {parsed && (showDiagram ? (
            <details className="kn-textfold" open={textOpen} onToggle={(e) => setTextOpen(e.currentTarget.open)}>
              <summary>文字版</summary>
              {body}
            </details>
          ) : body)}
        </div>
        <section className="kn-section kn-sources-col" aria-label="來源">
          <h3>來源</h3>
          <SourceList t={t} hl={hl} onSelect={onSelect} onView={onView} />
        </section>
      </div>
    </article>
  )
}

/* ───────── 右欄 ───────── */

function MonthChart({ t }: { t: Topic }) {
  const series = useMemo(() => monthSeries(t.monthCounts), [t.monthCounts])
  const [hover, setHover] = useState<number | null>(null)
  if (series.length === 0) return <p className="kn-muted">沒有逐月資料。</p>
  const max = Math.max(1, ...series.map((m) => m.count))
  const bw = 12
  const gap = 3
  const H = 64
  const W = series.length * (bw + gap)
  const cur = hover !== null ? series[hover] : null
  return (
    <div>
      <svg className="kn-bars" viewBox={`0 0 ${W} ${H}`} width="100%" height={H} preserveAspectRatio="none" role="img" aria-label="素材逐月數量">
        {series.map((m, i) => {
          const h = m.count === 0 ? 1 : Math.max(2, (m.count / max) * (H - 4))
          return <rect key={m.month} x={i * (bw + gap)} y={H - h} width={bw} height={h} data-zero={m.count === 0}
            onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)}><title>{`${m.month}：${m.count}`}</title></rect>
        })}
      </svg>
      <p className="kn-muted kn-bars-note">{cur ? `${cur.month}：${cur.count} 份` : `${series[0]!.month} ～ ${series[series.length - 1]!.month}`}</p>
    </div>
  )
}

function SideColumn({ t, data, onOpen }: { t: Topic | null; data: TopicsData; onOpen: (id: string) => void }) {
  if (!t) {
    return (
      <aside className="kn-side" aria-label="說明">
        <h2 className="kn-col-title">怎麼看</h2>
        <p className="kn-muted">左邊是知識樹：領域下分枝，枝下是題目。選一題就會看到圖文頁面、素材逐月長條圖與成長紀錄。</p>
      </aside>
    )
  }
  const byId = new Map(data.topics.map((x) => [x.id, x]))
  const sameBranch = t.branch ? data.topics.filter((x) => x.branch === t.branch && x.id !== t.id) : []
  const cross = t.related.filter((r) => {
    const o = byId.get(r.id)
    return o && o.branch !== t.branch
  })
  return (
    <aside className="kn-side" aria-label="素材與相關題目">
      <section className="kn-section" aria-label="素材怎麼長的">
        <h3>素材怎麼長的</h3>
        <MonthChart t={t} />
      </section>
      <section className="kn-section" aria-label="成長紀錄">
        <h3>成長紀錄</h3>
        {t.growth.length === 0 ? <p className="kn-muted">還沒有成長紀錄。</p> : (
          <ol className="kn-timeline">
            {t.growth.map((g, i) => <li key={`${g.date}-${i}`}><span className="kn-date">{g.date}</span><span>{cleanGrowthText(g.text)}</span></li>)}
          </ol>
        )}
      </section>
      <section className="kn-section" aria-label="同枝題目">
        <h3>同枝題目</h3>
        {sameBranch.length === 0 ? <p className="kn-muted">這一枝沒有其他題目。</p> : (
          <ul className="kn-related">
            {sameBranch.map((x) => <li key={x.id}><button type="button" className="kn-link" onClick={() => onOpen(x.id)}>{x.name}</button></li>)}
          </ul>
        )}
      </section>
      <section className="kn-section" aria-label="跨枝連結">
        <h3>跨枝連結</h3>
        {cross.length === 0 ? <p className="kn-muted">還沒有跨枝的相關題目。</p> : (
          <ul className="kn-related">
            {cross.map((r) => (
              <li key={r.id}>
                <button type="button" className="kn-link" onClick={() => onOpen(r.id)}>{byId.get(r.id)?.name ?? r.name}</button>
                <span className="kn-muted"> 共同來源 {r.sharedDocs}{r.sharedCases ? `・案例 ${r.sharedCases}` : ''}</span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </aside>
  )
}

/* ───────── 外殼 ───────── */

function Layout({ data, now, topic, topicId, onOpen, onBack, pw }: {
  data: TopicsData; now: Date; topic: Topic | null; topicId: string | null; onOpen: (id: string) => void; onBack: () => void; pw: string
}) {
  const [drawer, setDrawer] = useState(false)
  const [hl, setHl] = useState<number | null>(null)
  const [cited, setCited] = useState<ReadonlySet<string>>(new Set())
  const [panel, setPanel] = useState<{ key: string; q: string } | null>(null)
  const parsed = useMemo(() => (topic?.body ? parseBodyWithMarkers(topic.body) : null), [topic?.body])
  const quotes = useTopicQuotes(pw, topic?.id ?? '')
  const jump = (n: number) => {
    setHl(n)
    document.getElementById(`kn-src-${n}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' })
  }
  // 點來源：標亮本文中引用它的 bullet，並捲到第一個
  const select = (n: number) => {
    setHl(n)
    const ids = parsed ? bulletsCiting(parsed, n) : []
    setCited(new Set(ids))
    if (ids[0]) document.getElementById(`kn-b-${ids[0]}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' })
  }
  const viewSource = (n: number) => { const s = topic?.sources[n - 1]; if (s) setPanel({ key: s.id, q: '' }) }
  // 圖解點來源：同樣開原文面板，但帶 2.77 的原文句（q）捲到引用段落
  const viewSourceQ = (n: number, q: string) => { const s = topic?.sources[n - 1]; if (s) setPanel({ key: s.id, q }) }
  const open = (id: string) => { setDrawer(false); setHl(null); setCited(new Set()); setPanel(null); onOpen(id) }
  const trace: TraceCtx | null = topic ? { pw, topic, quotes, onJump: jump, onViewSource: viewSource } : null
  let center: ReactNode
  if (topicId && !topic) {
    center = (
      <>
        <button type="button" className="kn-back" onClick={onBack}>← 全樹</button>
        <p className="kn-empty">找不到這個題目（可能已移除，或還沒推送到）。</p>
      </>
    )
  } else if (topic) {
    center = (
      <>
        <button type="button" className="kn-back" onClick={onBack}>← 全樹</button>
        <TraceProvider value={trace}><TopicPage key={`${topic.id}:${topic.revision}`} t={topic} parsed={parsed} hl={hl} cited={cited} topics={data.topics} quotes={quotes} onOpen={open} onSelect={select} onView={viewSource} onViewQ={viewSourceQ} /></TraceProvider>
      </>
    )
  } else {
    center = <TreeOverview data={data} now={now} onOpen={open} />
  }
  return (
    <div className="kn-layout" data-drawer={drawer}>
      <button type="button" className="kn-drawer-btn" aria-expanded={drawer} onClick={() => setDrawer((v) => !v)}>☰ 目錄</button>
      <div className="kn-left"><TreePanel data={data} now={now} selectedId={topic?.id ?? null} onOpen={open} pw={pw} onOpenSource={(key, q) => setPanel({ key, q })} /></div>
      <main className="kn-main">{center}</main>
      <div className="kn-right"><SideColumn t={topic} data={data} onOpen={open} /></div>
      {panel && <KnowledgeSourcePanel pw={pw} sourceKey={panel.key} query={panel.q} onClose={() => setPanel(null)} onOpenTopic={open} />}
    </div>
  )
}

export function KnowledgeView({ unlockedPassword, topicId, onRequestUnlock }: {
  unlockedPassword: string | null
  /** null＝全樹；有值＝題目頁（已經 decodeURIComponent） */
  topicId: string | null
  onRequestUnlock: () => void
}) {
  const feed = useAsync(unlockedPassword, apiFetchTopics)
  const now = useNow()
  const unlocked = !!unlockedPassword
  const data = feed.data?.data ?? null
  const openTopic = (id: string) => { window.location.hash = `#knowledge/${encodeURIComponent(id)}` }
  const backToTree = () => { window.location.hash = '#knowledge' }
  const topic = topicId && data ? data.topics.find((t) => t.id === topicId) ?? null : null

  let content: ReactNode
  if (!unlocked) {
    content = <div className="kn-body"><Locked onRequestUnlock={onRequestUnlock} /></div>
  } else if (feed.loading) {
    content = <div className="kn-body"><p className="kn-muted">讀取中…</p></div>
  } else if (feed.error && !data) {
    content = <div className="kn-body"><p className="kn-muted kn-bad">題目資料暫時無法取得，稍後再試。</p></div>
  } else if (!feed.data || !feed.data.available || !data) {
    content = <div className="kn-body"><p className="kn-empty">尚未收到推送，HERMES 部署後才會有資料。</p></div>
  } else {
    content = <Layout data={data} now={now} topic={topic} topicId={topicId} onOpen={openTopic} onBack={backToTree} pw={unlockedPassword as string} />
  }

  return (
    <div className="kn-root">
      <header className="kn-head">
        <button type="button" className="kn-back" onClick={() => { window.location.hash = '' }}>← 返回儀表板</button>
        <h1>知識</h1>
        {unlocked && data && isStale(data.computedAt, now) && <span className="kn-stale">資料已過期（{stamp(data.computedAt)}）</span>}
        {!unlocked && <button type="button" className="kn-btn kn-btn--head" onClick={onRequestUnlock}>🔒 解鎖</button>}
      </header>
      {content}
    </div>
  )
}
