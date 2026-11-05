import { useMemo, useState, type ReactNode } from 'react'
import { MarkdownView } from './MarkdownView'
import { useAsync, useNow } from './homeHooks'
import {
  filterTopics, groupTopics, isStale, kindLabel, layoutGraph, parseTopics,
  type Topic, type TopicKind, type TopicsData,
} from './knowledgeView'

// 知識頁（#knowledge＝題目牆、#knowledge/<id>＝單題頁，2026-11-05）。資料來自 feed `topics`（HERMES 每週推送）。
// 純函式在 knowledgeView.ts（有測試）；樣式在 portal.css 的 kn-*。

const API_BASE = import.meta.env.BASE_URL ?? '/'

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
      <p>知識頁是知識庫長出來的主題知識：題目牆、每題的頁面內容、成長紀錄與題目之間的關係。解鎖後才會讀取資料。</p>
      <button type="button" className="kn-btn" onClick={onRequestUnlock}>🔒 解鎖</button>
    </div>
  )
}

function TopicCard({ t, onOpen }: { t: Topic; onOpen: (id: string) => void }) {
  const range = monthRange(t)
  return (
    <li>
      <button type="button" className="kn-card" onClick={() => onOpen(t.id)}>
        <span className="kn-card-top">
          <b>{t.name}</b>
          <span className="kn-kind" data-kind={t.kind}>{kindLabel(t.kind)}</span>
        </span>
        {t.why && <span className="kn-why">{t.why}</span>}
        <span className="kn-meta">
          <span>{t.docs} 份來源</span>
          {t.monthsSpan > 0 && <span>橫跨 {t.monthsSpan} 個月{range ? `（${range}）` : ''}</span>}
          <span>{t.updated ? `更新於 ${t.updated}` : '尚未成頁'}</span>
          {t.newDocs > 0 && <span className="kn-new">＋{t.newDocs} 新素材</span>}
        </span>
      </button>
    </li>
  )
}

function TopicWall({ data, now, onOpen }: { data: TopicsData; now: Date; onOpen: (id: string) => void }) {
  const [kind, setKind] = useState<TopicKind | 'all'>('all')
  const [q, setQ] = useState('')
  const filtered = useMemo(() => filterTopics(data.topics, { kind, q }), [data.topics, kind, q])
  const groups = useMemo(() => groupTopics(filtered, now), [filtered, now])
  const recentCount = useMemo(() => groupTopics(data.topics, now).recent.length, [data.topics, now])
  const sections: Array<{ key: string; title: string; items: Topic[] }> = [
    { key: 'recent', title: '本週長大', items: groups.recent },
    { key: 'page', title: '已有頁面', items: groups.page },
    { key: 'growing', title: '還在累積', items: groups.growing },
  ]
  const graph = useMemo(() => layoutGraph(data.topics, 640, 420), [data.topics])
  const nameOf = useMemo(() => new Map(data.topics.map((t) => [t.id, t.name])), [data.topics])

  return (
    <>
      <p className="kn-stats">
        共 <b>{data.total}</b> 題、已有頁面 <b>{data.published}</b> 題、本週長大 <b>{recentCount}</b> 題・更新於 {stamp(data.computedAt)}
      </p>
      <div className="kn-filter">
        <div className="kn-seg" role="group" aria-label="種類篩選">
          {([['all', '全部'], ['concept', '概念'], ['method', '方法']] as const).map(([k, label]) => (
            <button key={k} type="button" aria-pressed={kind === k} onClick={() => setKind(k)}>{label}</button>
          ))}
        </div>
        <input type="search" className="kn-search" placeholder="搜尋題目或說明" aria-label="搜尋題目" value={q} onChange={(e) => setQ(e.target.value)} />
      </div>

      {filtered.length === 0 && <p className="kn-muted">沒有符合的題目。</p>}
      {sections.filter((s) => s.items.length > 0).map((s) => (
        <section key={s.key} className="kn-group" aria-label={s.title}>
          <h2>{s.title} <span className="kn-count">{s.items.length}</span></h2>
          <ul className="kn-cards">
            {s.items.map((t) => <TopicCard key={t.id} t={t} onOpen={onOpen} />)}
          </ul>
        </section>
      ))}

      <section className="kn-group" aria-label="題目關係圖">
        <h2>題目關係圖</h2>
        {graph.nodes.length === 0 ? (
          <p className="kn-muted">題目之間還沒有共同來源。</p>
        ) : (
          <svg className="kn-graph" viewBox="0 0 640 420" role="img" aria-label="題目之間的共同來源">
            {graph.edges.map((e) => {
              const a = graph.nodes.find((n) => n.id === e.a)!
              const b = graph.nodes.find((n) => n.id === e.b)!
              return <line key={`${e.a}-${e.b}`} x1={a.x} y1={a.y} x2={b.x} y2={b.y} strokeWidth={Math.min(4, 1 + e.w * 0.6)} />
            })}
            {graph.nodes.map((n) => (
              <g key={n.id} className="kn-node" role="link" tabIndex={0} aria-label={n.name}
                onClick={() => onOpen(n.id)}
                onKeyDown={(ev) => { if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); onOpen(n.id) } }}>
                <circle cx={n.x} cy={n.y} r={n.r} />
                <text x={n.x} y={n.y + n.r + 12} textAnchor="middle">{nameOf.get(n.id) ?? n.id}</text>
              </g>
            ))}
          </svg>
        )}
      </section>
    </>
  )
}

function TopicPage({ t, data, onOpen }: { t: Topic; data: TopicsData; onOpen: (id: string) => void }) {
  const nameOf = new Map(data.topics.map((x) => [x.id, x.name]))
  const range = monthRange(t)
  return (
    <article className="kn-page">
      <h2 className="kn-title">{t.name} <span className="kn-kind" data-kind={t.kind}>{kindLabel(t.kind)}</span></h2>
      {t.why && <p className="kn-why">{t.why}</p>}
      <p className="kn-meta">
        <span>{t.docs} 份來源</span>
        {t.monthsSpan > 0 && <span>橫跨 {t.monthsSpan} 個月{range ? `（${range}）` : ''}</span>}
        <span>{t.updated ? `更新於 ${t.updated}` : '尚未成頁'}</span>
        {t.newDocs > 0 && <span className="kn-new">＋{t.newDocs} 新素材</span>}
      </p>

      <section className="kn-section" aria-label="頁面內容">
        {t.body ? (
          <MarkdownView text={t.body} fontSize="0.9rem" />
        ) : (
          <p className="kn-muted">這題還在累積素材，每週會挑幾題寫成頁面。</p>
        )}
      </section>

      <section className="kn-section" aria-label="這次長了什麼">
        <h3>這次長了什麼</h3>
        {t.growth.length === 0 ? <p className="kn-muted">還沒有成長紀錄。</p> : (
          <ol className="kn-timeline">
            {t.growth.map((g, i) => <li key={`${g.date}-${i}`}><span className="kn-date">{g.date}</span><span>{g.text}</span></li>)}
          </ol>
        )}
      </section>

      <section className="kn-section" aria-label="來源">
        <h3>來源</h3>
        {t.sources.length === 0 ? <p className="kn-muted">沒有列出來源。</p> : (
          <ul className="kn-sources">
            {t.sources.slice(0, 40).map((s) => <li key={s.id}>{s.title}</li>)}
          </ul>
        )}
      </section>

      <section className="kn-section" aria-label="相關題目">
        <h3>相關題目</h3>
        {t.related.length === 0 ? <p className="kn-muted">還沒有相關題目。</p> : (
          <ul className="kn-related">
            {t.related.slice(0, 5).map((r) => (
              <li key={r.id}>
                <button type="button" className="kn-link" onClick={() => onOpen(r.id)}>{nameOf.get(r.id) ?? r.name}</button>
                <span className="kn-muted"> 共同來源 {r.sharedDocs}{r.sharedCases ? `・案例 ${r.sharedCases}` : ''}</span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </article>
  )
}

export function KnowledgeView({ unlockedPassword, topicId, onRequestUnlock }: {
  unlockedPassword: string | null
  /** null＝題目牆；有值＝單題頁（已經 decodeURIComponent） */
  topicId: string | null
  onRequestUnlock: () => void
}) {
  const feed = useAsync(unlockedPassword, apiFetchTopics)
  const now = useNow()
  const unlocked = !!unlockedPassword
  const data = feed.data?.data ?? null
  const openTopic = (id: string) => { window.location.hash = `#knowledge/${encodeURIComponent(id)}` }
  const backToWall = () => { window.location.hash = '#knowledge' }
  const topic = topicId && data ? data.topics.find((t) => t.id === topicId) ?? null : null

  let content: ReactNode
  if (!unlocked) {
    content = <Locked onRequestUnlock={onRequestUnlock} />
  } else if (feed.loading) {
    content = <p className="kn-muted">讀取中…</p>
  } else if (feed.error && !data) {
    content = <p className="kn-muted kn-bad">題目資料暫時無法取得，稍後再試。</p>
  } else if (!feed.data || !feed.data.available || !data) {
    content = <p className="kn-empty">尚未收到推送，HERMES 部署後才會有資料。</p>
  } else if (topicId) {
    content = topic ? (
      <>
        <button type="button" className="kn-back" onClick={backToWall}>← 題目牆</button>
        <TopicPage t={topic} data={data} onOpen={openTopic} />
      </>
    ) : (
      <>
        <button type="button" className="kn-back" onClick={backToWall}>← 題目牆</button>
        <p className="kn-empty">找不到這個題目（可能已移除，或還沒推送到）。</p>
      </>
    )
  } else {
    content = <TopicWall data={data} now={now} onOpen={openTopic} />
  }

  return (
    <div className="kn-root">
      <header className="kn-head">
        <button type="button" className="kn-back" onClick={() => { window.location.hash = '' }}>← 返回儀表板</button>
        <h1>知識</h1>
        {unlocked && data && isStale(data.computedAt, now) && <span className="kn-stale">資料已過期（{stamp(data.computedAt)}）</span>}
        {!unlocked && <button type="button" className="kn-btn kn-btn--head" onClick={onRequestUnlock}>🔒 解鎖</button>}
      </header>
      <div className="kn-body">{content}</div>
    </div>
  )
}
