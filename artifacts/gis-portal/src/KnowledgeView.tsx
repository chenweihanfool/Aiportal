import { useMemo, useState, type ReactNode } from 'react'
import { InlineText } from './MarkdownView'
import { useAsync, useNow } from './homeHooks'
import {
  buildTree, filterTopics, groupTopics, isStale, kindLabel, layoutTidyTree, monthSeries, parseBody, parseTopics, treeToLayoutInput,
  type Bullet, type BuiltTree, type Topic, type TopicKind, type TopicsData,
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

function Locked({ onRequestUnlock }: { onRequestUnlock: () => void }) {
  return (
    <div className="kn-empty">
      <p>知識頁是知識庫長出來的主題知識：知識樹、每題的圖文頁面、成長紀錄與題目之間的關係。解鎖後才會讀取資料。</p>
      <button type="button" className="kn-btn" onClick={onRequestUnlock}>🔒 解鎖</button>
    </div>
  )
}

/* ───────── 左欄：知識樹（大綱） ───────── */

function TopicRow({ t, selected, onOpen }: { t: Topic; selected: boolean; onOpen: (id: string) => void }) {
  return (
    <li>
      <button type="button" className="kn-tt" data-selected={selected} data-unpublished={t.revision === 0} aria-current={selected ? 'page' : undefined} onClick={() => onOpen(t.id)}>
        <span className="kn-tt-name">{t.name}</span>
        {t.newDocs > 0 && <span className="kn-dot" title={`＋${t.newDocs} 新素材`} aria-label={`${t.newDocs} 筆新素材`} />}
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

function TreePanel({ data, selectedId, onOpen }: { data: TopicsData; selectedId: string | null; onOpen: (id: string) => void }) {
  const [kind, setKind] = useState<TopicKind | 'all'>('all')
  const [q, setQ] = useState('')
  const [toggled, setToggled] = useState<ReadonlySet<string>>(new Set())
  const filtered = useMemo(() => filterTopics(data.topics, { kind, q }), [data.topics, kind, q])
  const built = useMemo(() => buildTree({ topics: filtered, tree: data.tree }), [filtered, data.tree])
  // 預設展開第一層（領域）；選中題目所在的枝與領域自動展開；搜尋時命中的祖先全部展開
  const searching = q.trim() !== '' || kind !== 'all'
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
      <input type="search" className="kn-search" placeholder="搜尋題目名稱" aria-label="搜尋題目" value={q} onChange={(e) => setQ(e.target.value)} />
      <div className="kn-seg" role="group" aria-label="種類篩選">
        {([['all', '全部'], ['concept', '概念'], ['method', '方法']] as const).map(([k, label]) => (
          <button key={k} type="button" aria-pressed={kind === k} onClick={() => setKind(k)}>{label}</button>
        ))}
      </div>
      {filtered.length === 0 && <p className="kn-muted">沒有符合的題目。</p>}
      <ul className="kn-ol kn-ol--root">
        {built.domains.filter((d) => !searching || d.count > 0).map((d) => (
          <OutlineGroup key={d.id} id={d.id} label={d.name} count={d.count} level="domain" open={isOpen(d.id)} onToggle={toggle}>
            {d.branches.filter((b) => !searching || b.count > 0).map((b) => (
              <OutlineGroup key={b.id} id={b.id} label={b.name} count={b.count} level="branch" open={isOpen(b.id)} onToggle={toggle}>
                {b.topics.map((t) => <TopicRow key={t.id} t={t} selected={t.id === selectedId} onOpen={onOpen} />)}
              </OutlineGroup>
            ))}
          </OutlineGroup>
        ))}
        {built.unassigned.length > 0 && (
          <OutlineGroup id={UNASSIGNED_ID} label="未歸類" count={built.unassigned.length} level="domain" open={isOpen(UNASSIGNED_ID)} onToggle={toggle}>
            {built.unassigned.map((t) => <TopicRow key={t.id} t={t} selected={t.id === selectedId} onOpen={onOpen} />)}
          </OutlineGroup>
        )}
      </ul>
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

function TreeOverview({ data, now, onOpen }: { data: TopicsData; now: Date; onOpen: (id: string) => void }) {
  const built = useMemo(() => buildTree(data), [data])
  return (
    <>
      <Stats data={data} now={now} />
      <h2 className="kn-h2">全樹</h2>
      <p className="kn-muted">點領域或枝可收合，點題目進入題目頁。{!data.tree && '推送端還沒更新知識樹，題目暫時都在「未歸類」。'}</p>
      <FullTree built={built} onOpen={onOpen} />
    </>
  )
}

/* ───────── 中欄：題目頁 ───────── */

function Refs({ refs, t, onJump }: { refs: number[]; t: Topic; onJump: (n: number) => void }) {
  if (refs.length === 0) return null
  return (
    <span className="kn-refs">
      {refs.map((n, i) => (
        <button key={`${n}-${i}`} type="button" className="kn-ref" title={t.sources[n - 1]?.title ?? `來源 ${n}`} aria-label={`來源 ${n}：${t.sources[n - 1]?.title ?? ''}`} onClick={() => onJump(n)}>{n}</button>
      ))}
    </span>
  )
}

function BulletText({ b, t, onJump }: { b: Bullet; t: Topic; onJump: (n: number) => void }) {
  return (
    <>
      <InlineText text={b.text} />
      {b.single && <span className="kn-single">僅一例</span>}
      <Refs refs={b.refs} t={t} onJump={onJump} />
    </>
  )
}

function TopicPage({ t, onJump, hl }: { t: Topic; onJump: (n: number) => void; hl: number | null }) {
  const parsed = useMemo(() => (t.body ? parseBody(t.body) : null), [t.body])
  const range = monthRange(t)
  return (
    <article className="kn-page">
      {t.path.length > 0 && <p className="kn-crumb">{t.path.join(' › ')}</p>}
      <h2 className="kn-title">{t.name} <span className="kn-kind" data-kind={t.kind}>{kindLabel(t.kind)}</span></h2>
      {t.why && <p className="kn-why">{t.why}</p>}
      <p className="kn-meta">
        <span>{t.docs} 份來源</span>
        {t.monthsSpan > 0 && <span>橫跨 {t.monthsSpan} 個月{range ? `（${range}）` : ''}</span>}
        <span>{t.updated ? `更新於 ${t.updated}` : '尚未成頁'}</span>
        {t.newDocs > 0 && <span className="kn-new">＋{t.newDocs} 新素材</span>}
      </p>

      {!parsed && <p className="kn-muted">這題還在累積素材，每週會挑幾題寫成頁面。</p>}
      {parsed && (
        <>
          {parsed.summary && (
            <section className="kn-summary" aria-label="一句話">
              <h3>一句話</h3>
              <p><BulletText b={parsed.summary} t={t} onJump={onJump} /></p>
            </section>
          )}
          {parsed.what.length > 0 && (
            <section className="kn-section" aria-label="這件事在幹嘛">
              <h3>這件事在幹嘛</h3>
              <ul className="kn-plain">{parsed.what.map((b, i) => <li key={i}><BulletText b={b} t={t} onJump={onJump} /></li>)}</ul>
            </section>
          )}
          {parsed.how.length > 0 && (
            <section className="kn-section" aria-label="怎麼做">
              <h3>怎麼做</h3>
              <ol className="kn-steps">{parsed.how.map((b, i) => <li key={i}><span className="kn-stepno" aria-hidden="true">{i + 1}</span><div><BulletText b={b} t={t} onJump={onJump} /></div></li>)}</ol>
            </section>
          )}
          {parsed.caution.length > 0 && (
            <section className="kn-section" aria-label="要注意">
              <h3>要注意</h3>
              <ul className="kn-cautions">{parsed.caution.map((b, i) => <li key={i}><span aria-hidden="true">⚠</span><div><BulletText b={b} t={t} onJump={onJump} /></div></li>)}</ul>
            </section>
          )}
          {parsed.unknown.length > 0 && (
            <section className="kn-section" aria-label="還不知道">
              <h3>還不知道</h3>
              <ul className="kn-unknowns">{parsed.unknown.map((b, i) => <li key={i}><span aria-hidden="true">？</span><div><BulletText b={b} t={t} onJump={onJump} /></div></li>)}</ul>
            </section>
          )}
          {parsed.other && <section className="kn-section" aria-label="其他"><p className="kn-other">{parsed.other}</p></section>}
        </>
      )}

      <section className="kn-section" aria-label="來源">
        <h3>來源</h3>
        {t.sources.length === 0 ? <p className="kn-muted">沒有列出來源。</p> : (
          <ol className="kn-sources">
            {t.sources.slice(0, 40).map((s, i) => (
              <li key={s.id} id={`kn-src-${i + 1}`} data-hl={hl === i + 1}>{s.title}{s.month && <span className="kn-date"> {s.month}</span>}</li>
            ))}
          </ol>
        )}
      </section>
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
            {t.growth.map((g, i) => <li key={`${g.date}-${i}`}><span className="kn-date">{g.date}</span><span>{g.text}</span></li>)}
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

function Layout({ data, now, topic, topicId, onOpen, onBack }: {
  data: TopicsData; now: Date; topic: Topic | null; topicId: string | null; onOpen: (id: string) => void; onBack: () => void
}) {
  const [drawer, setDrawer] = useState(false)
  const [hl, setHl] = useState<number | null>(null)
  const jump = (n: number) => {
    setHl(n)
    document.getElementById(`kn-src-${n}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' })
  }
  const open = (id: string) => { setDrawer(false); setHl(null); onOpen(id) }
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
        <TopicPage t={topic} onJump={jump} hl={hl} />
      </>
    )
  } else {
    center = <TreeOverview data={data} now={now} onOpen={open} />
  }
  return (
    <div className="kn-layout" data-drawer={drawer}>
      <button type="button" className="kn-drawer-btn" aria-expanded={drawer} onClick={() => setDrawer((v) => !v)}>☰ 目錄</button>
      <div className="kn-left"><TreePanel data={data} selectedId={topic?.id ?? null} onOpen={open} /></div>
      <main className="kn-main">{center}</main>
      <div className="kn-right"><SideColumn t={topic} data={data} onOpen={open} /></div>
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
    content = <Layout data={data} now={now} topic={topic} topicId={topicId} onOpen={openTopic} onBack={backToTree} />
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
