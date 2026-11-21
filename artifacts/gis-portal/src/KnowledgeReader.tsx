import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { KnowledgeSourcePanel } from './KnowledgeSourcePanel'
import { SourceList, TraceProvider, useTopicQuotes, type TraceCtx } from './KnowledgeTrace'
import { BulletText, ClaimBullet, ConceptBody, MethodBody, Section } from './KnowledgeParts'
import { ClaimRow, ClaimText, ClaimsProvider, useClaimsController } from './KnowledgeClaimActions'
import { KnowledgeDiagram } from './KnowledgeDiagram'
import type { HermesTopicQuote } from './hermesDocApi'
import {
  bulletId, bulletsCiting, cleanGrowthText, formatClaimStats, kindLabel, monthSeries, parseBodyWithMarkers,
  type ParsedBody, type Topic, type TopicsData,
} from './knowledgeView'

// 閱讀區（3.21.0）：知識島裡「完整頁面」展開後的內容＝原題目頁（TopicPage）＋右側欄四節（素材怎麼長的、成長紀錄、同枝題目、跨枝連結）。
// 原本在 KnowledgeView 的三欄 Layout 裡，搬到這裡；樣式沿用 kn-*，外殼是 krd-*。

function monthRange(t: Topic): string {
  if (t.firstMonth && t.lastMonth) return t.firstMonth === t.lastMonth ? t.firstMonth : `${t.firstMonth}～${t.lastMonth}`
  return ''
}

function TopicPage({ t, parsed, hl, cited, topics, quotes, pw, now, onOpen, onSelect, onView, onViewQ }: {
  t: Topic; parsed: ParsedBody | null; hl: number | null; cited: ReadonlySet<string>; topics: readonly Topic[]
  quotes: readonly HermesTopicQuote[] | null
  pw: string; now: Date
  onOpen: (id: string) => void; onSelect: (n: number) => void; onView: (n: number) => void; onViewQ: (n: number, q: string) => void
}) {
  const claims = useClaimsController(pw, t, parsed, topics, now)
  const range = monthRange(t)
  const [textOpen, setTextOpen] = useState(true)
  const showDiagram = !!t.diagram
  // 圖解 ↔ 步驟卡：互相捲過去並高亮 2 秒
  const [hlStep, setHlStep] = useState<string | null>(null)
  const [hlNode, setHlNode] = useState<string | null>(null)
  const timers = useRef<{ step?: number; node?: number }>({})
  useEffect(() => () => { window.clearTimeout(timers.current.step); window.clearTimeout(timers.current.node) }, [])
  const scrollTo = (id: string) => {
    const el = document.getElementById(id)
    if (el && typeof el.scrollIntoView === 'function') el.scrollIntoView({ behavior: 'smooth', block: 'center' })
  }
  const onNodeStep = useCallback((nodeId: string): boolean => {
    const step = (t.steps ?? []).find((s) => s.node === nodeId)
    if (!step) return false
    setHlStep(step.id)
    window.clearTimeout(timers.current.step)
    timers.current.step = window.setTimeout(() => setHlStep(null), 2000)
    // 文字版折起時先打開，卡片才找得到
    setTextOpen(true)
    window.setTimeout(() => scrollTo(`kn-step-card-${step.id}`), 0)
    return true
  }, [t.steps])
  const goDiagram = (nodeId: string) => {
    setHlNode(nodeId)
    window.clearTimeout(timers.current.node)
    timers.current.node = window.setTimeout(() => setHlNode(null), 2000)
    scrollTo('kn-diagram')
  }
  const body = parsed ? (
    <>
          {parsed.format === 'concept' && <ConceptBody t={t} parsed={parsed} topics={topics} cited={cited} onOpen={onOpen} />}
          {parsed.format === 'method' && <MethodBody t={t} parsed={parsed} topics={topics} cited={cited} onOpen={onOpen} pw={pw} onView={onView} highlightStep={hlStep} onGoDiagram={goDiagram} />}
          {parsed.format === 'legacy' && parsed.what.length > 0 && (
            <Section label="這件事在幹嘛" addKey="what">
              <ul className="kn-plain">{parsed.what.map((b, i) => <li key={i}><ClaimBullet b={b} bid={bulletId('what', i)} cited={cited} /></li>)}</ul>
            </Section>
          )}
          {parsed.format === 'legacy' && parsed.how.length > 0 && (
            <Section label="怎麼做" addKey="how">
              <ol className="kn-steps">{parsed.how.map((b, i) => <li key={i}><span className="kn-stepno" aria-hidden="true">{i + 1}</span><div><ClaimBullet b={b} bid={bulletId('how', i)} cited={cited} /></div></li>)}</ol>
            </Section>
          )}
          {parsed.format === 'legacy' && parsed.caution.length > 0 && (
            <Section label="要注意" addKey="caution">
              <ul className="kn-cautions">{parsed.caution.map((b, i) => <li key={i}><span aria-hidden="true">⚠</span><div><ClaimBullet b={b} bid={bulletId('caution', i)} cited={cited} /></div></li>)}</ul>
            </Section>
          )}
          {parsed.unknown.length > 0 && (
            <Section label="還不知道" addKey="unknown">
              <ul className="kn-unknowns">{parsed.unknown.map((b, i) => <li key={i}><span aria-hidden="true">？</span><div><ClaimBullet b={b} bid={bulletId('unknown', i)} cited={cited} /></div></li>)}</ul>
            </Section>
          )}
          {parsed.other && <section className="kn-section" aria-label="其他"><p className="kn-other">{parsed.other}</p></section>}
    </>
  ) : null
  return (
    <ClaimsProvider value={claims}>
    <article className="kn-page">
      {t.path.length > 0 && <p className="kn-crumb">{t.path.join(' › ')}</p>}
      <h2 className="kn-title">{t.name} <span className="kn-kind" data-kind={t.kind}>{kindLabel(t.kind)}</span></h2>
      {t.claimStats && <p className="kn-ca-stats">{formatClaimStats(t.claimStats)}</p>}
      {t.why && <p className="kn-why">{t.why}</p>}
      <p className="kn-meta">
        <span>{t.docs} 份來源</span>
        {t.monthsSpan > 0 && <span>橫跨 {t.monthsSpan} 個月{range ? `（${range}）` : ''}</span>}
        <span>{t.updated ? `更新於 ${t.updated}` : '尚未成頁'}</span>
        {t.newDocs > 0 && <span className="kn-new">＋{t.newDocs} 新素材</span>}
      </p>
      {parsed?.format === 'legacy' && <p className="kn-legacy-note">舊格式，之後會自動換成新版</p>}

      {parsed && parsed.summary && (
        <section className="kn-summary" aria-label="一句話">
          <h3>一句話</h3>
          <ClaimRow bid={bulletId('summary')} b={parsed.summary}>
            {(v) => <p><ClaimText v={v}><BulletText b={v.override ? { ...parsed.summary!, refs: [], single: false } : parsed.summary!} bid={bulletId('summary')} cited={cited} text={v.text} /></ClaimText></p>}
          </ClaimRow>
        </section>
      )}
      {parsed && showDiagram && t.diagram && <div id="kn-diagram"><KnowledgeDiagram topic={t} diagram={t.diagram} quotes={quotes} onOpenSource={onViewQ} onNodeStep={onNodeStep} highlightNode={hlNode} /></div>}

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
    </ClaimsProvider>
  )
}

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

function ReaderSide({ t, data, onOpen }: { t: Topic; data: TopicsData; onOpen: (id: string) => void }) {
  const byId = new Map(data.topics.map((x) => [x.id, x]))
  const sameBranch = t.branch ? data.topics.filter((x) => x.branch === t.branch && x.id !== t.id) : []
  const cross = t.related.filter((r) => {
    const o = byId.get(r.id)
    return o && o.branch !== t.branch
  })
  return (
    <aside className="kn-side krd-side" aria-label="素材與相關題目">
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

export function KnowledgeReader({ topic, data, pw, now, onOpen }: {
  topic: Topic; data: TopicsData; pw: string; now: Date
  /** 點同枝／跨枝題目、原文面板裡的題目：切到該題並展開閱讀區 */
  onOpen: (id: string) => void
}) {
  const [hl, setHl] = useState<number | null>(null)
  const [cited, setCited] = useState<ReadonlySet<string>>(new Set())
  const [panel, setPanel] = useState<{ key: string; q: string } | null>(null)
  const parsed = useMemo(() => (topic.body ? parseBodyWithMarkers(topic.body) : null), [topic.body])
  const quotes = useTopicQuotes(pw, topic.id)
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
  const viewSource = (n: number) => { const s = topic.sources[n - 1]; if (s) setPanel({ key: s.id, q: '' }) }
  // 圖解點來源：同樣開原文面板，但帶 2.77 的原文句（q）捲到引用段落
  const viewSourceQ = (n: number, q: string) => { const s = topic.sources[n - 1]; if (s) setPanel({ key: s.id, q }) }
  const open = (id: string) => { setHl(null); setCited(new Set()); setPanel(null); onOpen(id) }
  const trace: TraceCtx = { pw, topic, quotes, onJump: jump, onViewSource: viewSource }
  // 原文面板開著時 Esc 只關面板（KnowledgeSourcePanel 自己處理），這裡不另外攔
  return (
    <div className="krd" data-testid="krd">
      <main className="krd-main">
        <TraceProvider value={trace}><TopicPage key={`${topic.id}:${topic.revision}`} t={topic} parsed={parsed} hl={hl} cited={cited} topics={data.topics} quotes={quotes} pw={pw} now={now} onOpen={open} onSelect={select} onView={viewSource} onViewQ={viewSourceQ} /></TraceProvider>
      </main>
      <ReaderSide t={topic} data={data} onOpen={open} />
      {panel && <KnowledgeSourcePanel pw={pw} sourceKey={panel.key} query={panel.q} onClose={() => setPanel(null)} onOpenTopic={open} />}
    </div>
  )
}
