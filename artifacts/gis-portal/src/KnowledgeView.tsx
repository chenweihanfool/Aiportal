import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { KnowledgeSourcePanel } from './KnowledgeSourcePanel'
import { SourceSearchResults } from './KnowledgeSearch'
import { KnowledgeIslands } from './KnowledgeIslands'
import { useAsync, useNow } from './homeHooks'
import { filterTopics, groupTopics, isStale, parseTopics, recentChangeOf, type TopicChange, type TopicsData } from './knowledgeView'
import { formatKnowledgeHash } from './knowledgeRoute'
import { goto, setNavNames } from './navBack'
import { BackToOrigin } from './BackToOrigin'

// 知識頁（3.21.0 起只有島嶼：#knowledge＝全景、#knowledge/<id>＝進島展開該題）。資料來自 feed `topics`（HERMES 每週推送）。
// 純函式在 knowledgeView.ts／knowledgeRoute.ts（有測試）；島嶼在 KnowledgeIslands.tsx，閱讀區在 KnowledgeReader.tsx；樣式在 portal.css 的 kn-*／kis-*／krd-*。

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

const CHANGE_LABEL: Record<TopicChange, string> = { 'new-page': '新頁面', 'new-topic': '新題目', revised: '改版' }

function Locked({ onRequestUnlock }: { onRequestUnlock: () => void }) {
  return (
    <div className="kn-empty">
      <p>知識頁是知識庫長出來的主題知識：知識島、每題的圖文頁面、成長紀錄與題目之間的關係。解鎖後才會讀取資料。</p>
      <button type="button" className="kn-btn" onClick={onRequestUnlock}>🔒 解鎖</button>
    </div>
  )
}

const goTopic = (id: string) => { goto(formatKnowledgeHash({ view: 'topic', topicId: id, stationId: null })) }

function Stats({ data, now }: { data: TopicsData; now: Date }) {
  const recentCount = useMemo(() => groupTopics(data.topics, now).recent.length, [data.topics, now])
  return (
    <p className="kn-stats">
      共 <b>{data.total}</b> 題、已有頁面 <b>{data.published}</b> 題、本週長大 <b>{recentCount}</b> 題・更新於 {stamp(data.computedAt)}
    </p>
  )
}

/** 全景頁首：統計行、搜尋（題目／原文）、本週變動 */
function OverviewHead({ data, now, pw }: { data: TopicsData; now: Date; pw: string }) {
  const [mode, setMode] = useState<'topic' | 'source'>('topic')
  const [q, setQ] = useState('')
  const [panel, setPanel] = useState<{ key: string; q: string } | null>(null)
  const recent = useMemo(() => recentChangeOf(data.topics, now, 7), [data.topics, now])
  const recentTopics = useMemo(() => data.topics.filter((t) => recent.has(t.id)), [data.topics, recent])
  const hits = useMemo(() => (mode === 'topic' && q.trim() !== '' ? filterTopics(data.topics, { kind: 'all', q }).slice(0, 20) : []), [data.topics, mode, q])
  return (
    <section className="krd-head" aria-label="知識頁首">
      <Stats data={data} now={now} />
      <div className="krd-search">
        <div className="kn-seg" role="group" aria-label="搜尋範圍">
          {([['topic', '題目'], ['source', '原文']] as const).map(([k, label]) => (
            <button key={k} type="button" aria-pressed={mode === k} onClick={() => setMode(k)}>{label}</button>
          ))}
        </div>
        <input type="search" className="kn-search" placeholder={mode === 'topic' ? '搜尋題目名稱' : '搜尋來源原文'} aria-label={mode === 'topic' ? '搜尋題目' : '搜尋原文'} value={q} onChange={(e) => setQ(e.target.value)} />
      </div>
      {mode === 'topic' && q.trim() !== '' && (
        hits.length === 0
          ? <p className="kn-muted">沒有符合的題目。</p>
          : <ul className="krd-hits" aria-label="題目搜尋結果">
            {hits.map((t) => <li key={t.id}><button type="button" className="kn-link" onClick={() => goTopic(t.id)}>{t.name}</button></li>)}
          </ul>
      )}
      {mode === 'source' && <SourceSearchResults pw={pw} q={q} onPick={(key, qq) => setPanel({ key, q: qq })} />}
      {recentTopics.length > 0 && (
        <div className="krd-week" aria-label="本週變動">
          <span className="krd-week-h">本週變動</span>
          {recentTopics.map((t) => {
            const c = recent.get(t.id)!
            return (
              <button key={t.id} type="button" className="krd-chip" title={CHANGE_LABEL[c]} onClick={() => goTopic(t.id)}>
                <span className="kn-chg kn-chg--sm" data-chg={c}>{c === 'revised' ? '改' : '新'}</span>{t.name}
              </button>
            )
          })}
        </div>
      )}
      {panel && <KnowledgeSourcePanel pw={pw} sourceKey={panel.key} query={panel.q} onClose={() => setPanel(null)} onOpenTopic={(id) => { setPanel(null); goTopic(id) }} />}
    </section>
  )
}

export function KnowledgeView({ unlockedPassword, onRequestUnlock }: {
  unlockedPassword: string | null
  onRequestUnlock: () => void
}) {
  const feed = useAsync(unlockedPassword, apiFetchTopics)
  const now = useNow()
  const unlocked = !!unlockedPassword
  const data = feed.data?.data ?? null
  // 3.27.0：從知識頁跳出去時，「‹ 回到 知識：<題名>」顯示題名而不是 id
  useEffect(() => {
    const byId = new Map((data?.topics ?? []).map((t) => [t.id, t.name]))
    setNavNames(() => ({ topic: (id) => byId.get(id) }))
    return () => setNavNames(() => ({}))
  }, [data])

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
    content = <div className="kn-body"><KnowledgeIslands data={data} pw={unlockedPassword as string} now={now} head={<OverviewHead data={data} now={now} pw={unlockedPassword as string} />} /></div>
  }

  return (
    <div className="kn-root">
      <header className="kn-head">
        <BackToOrigin fallback={<button type="button" className="kn-back" onClick={() => { goto('') }}>← 返回儀表板</button>} />
        <h1>知識</h1>
        {unlocked && data && isStale(data.computedAt, now) && <span className="kn-stale">資料已過期（{stamp(data.computedAt)}）</span>}
        {!unlocked && <button type="button" className="kn-btn kn-btn--head" onClick={onRequestUnlock}>🔒 解鎖</button>}
      </header>
      {content}
    </div>
  )
}
