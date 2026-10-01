// ─────────────────────────────────────────────
// 選取節點後的詳情面板。分頁依節點種類不同，各管各的、互不重疊：
//   事件            內容｜關聯｜洞察
//   概念／方法      內容（hub 本文＋出現脈絡時間軸）｜洞察
//   人物／案件／物件  關聯（相鄰實體 chip）｜時間軸（關聯事件，日期在左、標題在右，新→舊）｜洞察｜敘事（L5，有才有）
// 事件清單只出現在「時間軸」：關聯分頁不再重複列事件；L5 的圖譜編織／時效警報獨立成「敘事」分頁，
// 並拆成「標題句＋條列」而不是一整坨文字（見 nodeTimeline.parseNarrative）。
//
// 每種實體都把所有相鄰實體列成可點的 chip，點下去就換選取（外層會把它置中），所以可以一路串下去；
// 「洞察」分頁放 graphInsights.ts 推導出來的東西（共同參與排行、關係缺漏、二度人脈、橋接風險、案件停滯與
// 班底…），這些都不是資料庫裡直接有的欄位，是從圖的拓撲算出來的。
//
// 2026-09-21：全部字級改成 `calc(var(--ds, 1) * Nrem)`——面板外層設一次 --ds，展開態設大一點（1.55）、
// 收合態也比原本略大（1.12）；另有「展開」鈕讓面板蓋滿整個視窗（z-index 高於 3D canvas）。
// ─────────────────────────────────────────────
import { useEffect, useMemo, useState, type CSSProperties } from 'react'
import { COLOR, FONT } from './theme'
import type { HermesGraphData } from './hermesGraphApi'
import { apiFetchHermesDoc, type HermesDoc } from './hermesDocApi'
import { MarkdownView, InlineText } from './MarkdownView'
import { groupByMonth, parseNarrative, sortNewestFirst } from './nodeTimeline'
import { describeSource, stripSourceSection } from './docContent'
import { AttachmentViewer } from './AttachmentViewer'
import {
  buildIndex, resolveWikilink, personInsight, caseInsight, eventInsight, objectInsight, abstractionInsight, entityEvents,
  personId, eventId, caseId, objectId, conceptId, methodId, splitId,
  type GraphIndex, type NodeKind,
} from './graphInsights'

export interface Selection { kind: NodeKind; id: string }

type TabKey = 'content' | 'links' | 'timeline' | 'insight' | 'narrative'

const KIND_LABEL: Record<NodeKind, string> = { person: '人物', event: '事件', case: '案件', object: '物件', concept: '概念', method: '方法' }
const KIND_COLOR: Record<NodeKind, string> = {
  person: '#aab4c4', event: '#8f97a6', case: '#d8d4c8', object: '#93a2b8',
  // 概念／方法在宇宙裡是半透明薄框的抽象層，用偏藍／偏綠跟具體節點的灰階區分
  concept: '#7fa6dc', method: '#86c4a0',
}
function Chip({ label, kind, hint, onClick }: { label: string; kind: NodeKind; hint?: string; onClick: () => void }) {
  return (
    <span
      onClick={onClick}
      title={hint ? `${label}（${hint}）` : label}
      style={{
        display: 'inline-flex', alignItems: 'center', gap: '5px', maxWidth: '100%',
        padding: '3px 9px', borderRadius: '999px', cursor: 'pointer',
        background: 'rgba(255,255,255,0.04)', border: `1px solid ${COLOR.line}`,
        fontSize: 'calc(var(--ds, 1) * 0.68rem)', color: COLOR.ink, lineHeight: 1.5,
      }}
    >
      <span style={{ width: 6, height: 6, borderRadius: '50%', background: KIND_COLOR[kind], flexShrink: 0 }} />
      <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{label}</span>
      {hint && <span style={{ color: COLOR.steelDim, fontFamily: FONT.mono, fontSize: 'calc(var(--ds, 1) * 0.6rem)', flexShrink: 0 }}>{hint}</span>}
    </span>
  )
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div style={{ marginTop: '0.7rem' }}>
      <div style={{ fontFamily: FONT.mono, fontSize: 'calc(var(--ds, 1) * 0.6rem)', color: COLOR.steelDim, letterSpacing: '0.08em', marginBottom: '5px' }}>{title}</div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '5px' }}>{children}</div>
    </div>
  )
}

function Note({ children, tone }: { children: React.ReactNode; tone?: 'warn' | 'plain' }) {
  return (
    <div style={{
      fontSize: 'calc(var(--ds, 1) * 0.68rem)', lineHeight: 1.6, marginTop: '0.55rem',
      color: tone === 'warn' ? COLOR.warn : COLOR.steel,
    }}>{children}</div>
  )
}

// 事件卡上概念／方法 chip 的提示：關係標籤 + 候選標記（只出現過 1 次）
function abstractionHint(index: GraphIndex, id: string, relation: string | null): string | undefined {
  const parts: string[] = []
  if (relation) parts.push(relation)
  if (index.promotedById.get(id) === false) parts.push('候選')
  return parts.length > 0 ? parts.join(' · ') : undefined
}

// 洞察分頁最上面的「目前評價」——L5 每輪覆蓋的第一人稱快照，跟分頁其他內
// 容（拓撲推導出來的洞察）不是同一種東西，用左側色條 + 斜體跟其他區塊區
// 分開來，視覺上讀成「這是一則被寫下來的評語」而不是一項數據。
function AssessmentNote({ assessment }: { assessment: { date: string; text: string } }) {
  return (
    <div style={{
      marginBottom: '0.7rem', padding: '0.6rem 0.75rem', borderRadius: '6px',
      background: 'rgba(255,255,255,0.03)', borderLeft: `3px solid ${COLOR.amber}`,
    }}>
      <div style={{
        fontFamily: FONT.mono, fontSize: 'calc(var(--ds, 1) * 0.58rem)', color: COLOR.steelDim,
        letterSpacing: '0.08em', marginBottom: '4px',
      }}>目前評價 · {assessment.date}</div>
      <div style={{ fontSize: 'calc(var(--ds, 1) * 0.7rem)', lineHeight: 1.65, color: COLOR.ink, fontStyle: 'italic' }}>
        {assessment.text}
      </div>
    </div>
  )
}

export function RelationshipDetailPanel({
  graph, unlockedPassword, selection, onSelect, onClose, onSetPathAnchor, pathAnchor, trail, onTrailJump,
}: {
  graph: NonNullable<HermesGraphData['graph']>
  unlockedPassword: string | null
  selection: Selection
  onSelect: (sel: Selection) => void
  onClose: () => void
  onSetPathAnchor: (id: string | null) => void
  pathAnchor: string | null
  trail: Selection[]
  onTrailJump: (index: number) => void
}) {
  const [tab, setTab] = useState<TabKey>('content')
  const [expanded, setExpanded] = useState(false)
  const index: GraphIndex = useMemo(() => buildIndex(graph), [graph])
  const { kind, name } = splitId(selection.id)

  const title = kind === 'event' ? (index.eventById.get(name)?.title ?? name) : name
  const go = (id: string) => onSelect({ kind: splitId(id).kind, id })
  // 分頁依節點種類而定（見檔頭）；目前選的分頁不在這個節點的分頁清單裡時，退回第一個。
  const hasNarrative = (kind === 'person' || kind === 'case' || kind === 'object') && (index.narrativesByHub.get(selection.id)?.length ?? 0) > 0
  const tabs: TabKey[] = kind === 'event' ? ['content', 'links', 'insight']
    : kind === 'concept' || kind === 'method' ? ['content', 'insight']
    : ['links', 'timeline', 'insight', ...(hasNarrative ? ['narrative' as const] : [])]
  const effectiveTab: TabKey = tabs.includes(tab) ? tab : tabs[0]
  const tabLabel = (t: TabKey) => t === 'content' ? '內容' : t === 'links' ? '關聯' : t === 'timeline' ? '時間軸' : t === 'insight' ? '洞察' : '敘事'

  // --ds 只控制字級（見檔頭說明），跟版面尺寸（下面的 containerStyle）分
  //開算，展開時兩者都變大，但邏輯互不依賴。
  const dsStyle = { '--ds': expanded ? 1.55 : 1.12 } as CSSProperties

  const containerStyle: CSSProperties = expanded
    ? {
        position: 'fixed', inset: 0, zIndex: 500, display: 'flex', flexDirection: 'column',
        background: COLOR.panelDeep, ...dsStyle,
      }
    : {
        position: 'absolute', left: '1.2rem', bottom: '1.2rem', width: 'min(480px, calc(100% - 2.4rem))',
        maxHeight: 'calc(100% - 2.4rem)', display: 'flex', flexDirection: 'column',
        background: 'rgba(18,19,25,0.97)', border: `1px solid ${COLOR.line}`, borderRadius: '6px', ...dsStyle,
      }

  return (
    <div style={containerStyle}>
      <div style={{ padding: expanded ? '1.1rem 1.6rem 0' : '0.8rem 1rem 0', flexShrink: 0 }}>
        {trail.length > 1 && (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px', alignItems: 'center', marginBottom: '6px', fontFamily: FONT.mono, fontSize: 'calc(var(--ds, 1) * 0.58rem)', color: COLOR.steelDim }}>
            {trail.slice(-5).map((t, i, arr) => {
              const absolute = trail.length - arr.length + i
              const label = t.kind === 'event' ? (index.eventById.get(splitId(t.id).name)?.title ?? '') : splitId(t.id).name
              const short = label.length > 8 ? `${label.slice(0, 7)}…` : label
              return (
                <span key={`${t.id}-${absolute}`}>
                  {i > 0 && <span style={{ margin: '0 3px' }}>›</span>}
                  <span
                    onClick={() => onTrailJump(absolute)}
                    style={{ cursor: 'pointer', color: i === arr.length - 1 ? COLOR.amber : COLOR.steelDim }}
                  >{short}</span>
                </span>
              )
            })}
          </div>
        )}

        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '10px' }}>
          <div style={{ fontSize: 'calc(var(--ds, 1) * 0.84rem)', color: COLOR.ink, fontWeight: 600, lineHeight: 1.4 }}>{title}</div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexShrink: 0 }}>
            <span
              onClick={() => setExpanded(x => !x)}
              title={expanded ? '收起面板' : '展開滿版閱讀'}
              style={{ cursor: 'pointer', color: expanded ? COLOR.amber : COLOR.steelDim, fontSize: 'calc(var(--ds, 1) * 0.8rem)' }}
            >{expanded ? '⤡' : '⤢'}</span>
            <span onClick={onClose} style={{ cursor: 'pointer', color: COLOR.steelDim, fontSize: 'calc(var(--ds, 1) * 0.85rem)' }}>✕</span>
          </div>
        </div>

        <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', marginTop: '6px' }}>
          {tabs.map(t => (
            <span key={t} onClick={() => setTab(t)} style={{
              cursor: 'pointer', fontFamily: FONT.mono, fontSize: 'calc(var(--ds, 1) * 0.64rem)', paddingBottom: '3px',
              color: effectiveTab === t ? COLOR.amber : COLOR.steelDim,
              borderBottom: `1px solid ${effectiveTab === t ? COLOR.amber : 'transparent'}`,
            }}>{tabLabel(t)}</span>
          ))}
          <div style={{ flex: 1 }} />
          <span
            onClick={() => onSetPathAnchor(pathAnchor === selection.id ? null : selection.id)}
            style={{ cursor: 'pointer', fontFamily: FONT.mono, fontSize: 'calc(var(--ds, 1) * 0.6rem)', color: pathAnchor === selection.id ? COLOR.amber : COLOR.steelDim }}
          >{pathAnchor === selection.id ? '● 已設為路徑起點' : '設為路徑起點'}</span>
        </div>
      </div>

      <div style={{
        padding: expanded ? '0 1.6rem 1.6rem' : '0 1rem 0.9rem', overflowY: 'auto', flex: 1, minHeight: 0,
        maxWidth: expanded ? '1080px' : undefined, width: '100%', margin: expanded ? '0 auto' : undefined,
      }}>
        {effectiveTab === 'content'
          ? <ContentTab password={unlockedPassword} kind={kind} name={name} go={go} resolve={t => resolveWikilink(index, t)} />
          : effectiveTab === 'links'
          ? <LinksTab index={index} kind={kind} name={name} go={go} />
          : effectiveTab === 'insight'
          ? <InsightTab index={index} kind={kind} name={name} go={go} />
          : effectiveTab === 'timeline'
          ? <EventTimelineTab index={index} kind={kind} name={name} go={go} expanded={expanded} />
          : <NarrativeTab index={index} selectionId={selection.id} go={go} expanded={expanded} />}
      </div>
    </div>
  )
}

// 內容分頁（內容層）：事件＝正文＋來源；概念／方法＝hub 本文（有才有）＋「出現脈絡」時間軸。
// 內容由 HERMES 每 10 分鐘增量推送；查無＝尚未同步（不是錯誤），明說而不是顯示空白。
type DocState = { status: 'loading' } | { status: 'missing' } | { status: 'error' } | { status: 'ok'; doc: HermesDoc }

function ContentTab({ password, kind, name, go, resolve }: { password: string | null; kind: NodeKind; name: string; go: (id: string) => void; resolve: (target: string) => string | null }) {
  const [state, setState] = useState<DocState>({ status: 'loading' })
  const [viewing, setViewing] = useState<string | null>(null)   // 正在預覽的附件路徑
  useEffect(() => {
    if (!password || (kind !== 'event' && kind !== 'concept' && kind !== 'method')) return
    let cancelled = false
    setState({ status: 'loading' })
    apiFetchHermesDoc(password, kind, name)
      .then(doc => { if (!cancelled) setState(doc ? { status: 'ok', doc } : { status: 'missing' }) })
      .catch(() => { if (!cancelled) setState({ status: 'error' }) })
    return () => { cancelled = true }
  }, [password, kind, name])

  if (state.status === 'loading') return <Note>載入內容中…</Note>
  if (state.status === 'error') return <Note tone="warn">暫時無法取得內容，稍後再試。</Note>
  if (state.status === 'missing') {
    return <Note>這筆內容還沒同步到入口網站（HERMES 每 10 分鐘推送一次；新事件或剛部署時可能還沒到）。關聯與洞察分頁不受影響。</Note>
  }
  const doc = state.doc
  // 事件正文的「## 來源」段與下方結構化來源列重複，有來源列時就拿掉
  const rawBody = doc.kind === 'event' && doc.sources.length > 0 ? stripSourceSection(doc.bodyMd) : doc.bodyMd
  const bodyText = rawBody
  const bodySize = 'calc(var(--ds, 1) * 0.74rem)'

  if (doc.kind === 'event') {
    return (
      <>
        <div style={{ fontFamily: FONT.mono, fontSize: 'calc(var(--ds, 1) * 0.64rem)', color: COLOR.steelDim, marginTop: '0.6rem' }}>
          事件{doc.date ? ` · ${doc.date}` : ''}
        </div>
        {bodyText.trim()
          ? <div style={{ marginTop: '0.4rem' }}><MarkdownView text={bodyText} fontSize={bodySize} resolveWikilink={resolve} onNavigate={go} onOpenAttachment={password ? setViewing : undefined} /></div>
          : <Note>這個事件的檔案沒有正文，只有標題與欄位。</Note>}
        {doc.truncated && <Note tone="warn">正文過長，這裡只顯示前段（完整內容在 vault 的事件檔）。</Note>}
        {doc.sources.length > 0 && (
          <Section title="來源">
            {doc.sources.map(s => {
              const line = describeSource(s)
              const previewable = s.type === 'attachment' && !!password
              return (
                <span key={`${s.type}:${s.path}`} title={s.path}
                  role={previewable ? 'button' : undefined} tabIndex={previewable ? 0 : undefined}
                  onClick={previewable ? () => setViewing(s.path) : undefined}
                  onKeyDown={previewable ? e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setViewing(s.path) } } : undefined}
                  style={{
                  display: 'inline-flex', gap: '6px', alignItems: 'baseline', maxWidth: '100%', padding: '3px 9px', borderRadius: '999px',
                  background: 'rgba(255,255,255,0.03)', border: `1px solid ${previewable ? COLOR.amberDim : COLOR.line}`, fontSize: 'calc(var(--ds, 1) * 0.66rem)',
                  color: previewable ? COLOR.amber : COLOR.ink, cursor: previewable ? 'pointer' : 'default',
                }}>
                  <span style={{ color: COLOR.steelDim, fontFamily: FONT.mono, fontSize: 'calc(var(--ds, 1) * 0.58rem)' }}>{line.label}</span>
                  <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{line.text}</span>
                </span>
              )
            })}
          </Section>
        )}
        {viewing && password && <AttachmentViewer password={password} path={viewing} onClose={() => setViewing(null)} />}
      </>
    )
  }

  const label = doc.kind === 'concept' ? '概念' : '方法'
  return (
    <>
      <div style={{ fontFamily: FONT.mono, fontSize: 'calc(var(--ds, 1) * 0.64rem)', color: COLOR.steelDim, marginTop: '0.6rem' }}>
        {label} · {doc.contexts.length} 個事件 · {doc.promoted ? '已晉升' : '候選（僅 1 個事件，尚未被重複驗證）'}
      </div>
      {doc.aliases.length > 0 && <Note>事件裡的其他說法：{doc.aliases.map(a => `「${a}」`).join('、')}（管線已合併到這個名稱）。</Note>}
      {bodyText.trim() && <div style={{ marginTop: '0.4rem' }}><MarkdownView text={bodyText} fontSize={bodySize} resolveWikilink={resolve} onNavigate={go} /></div>}
      {doc.truncated && <Note tone="warn">說明過長，這裡只顯示前段。</Note>}
      <Section title="出現脈絡（新→舊）">{null}</Section>
      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.7rem', marginTop: '-0.1rem' }}>
        {doc.contexts.map(c => (
          <div key={c.eventId} style={{ borderLeft: `2px solid ${COLOR.line}`, paddingLeft: '0.7rem' }}>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px', alignItems: 'baseline', fontFamily: FONT.mono, fontSize: 'calc(var(--ds, 1) * 0.6rem)', color: COLOR.steelDim }}>
              <span>{c.date}</span>
              {c.relation && <span style={{ color: COLOR.amberDim }}>{c.relation}</span>}
              {c.as && <span>原措辭「{c.as}」</span>}
            </div>
            <div
              onClick={() => go(eventId(c.eventId))}
              style={{ cursor: 'pointer', fontSize: 'calc(var(--ds, 1) * 0.74rem)', color: COLOR.ink, lineHeight: 1.5, marginTop: '2px' }}
            >{c.title}</div>
            {c.evidence && (
              <div style={{ fontSize: 'calc(var(--ds, 1) * 0.68rem)', color: COLOR.steel, lineHeight: 1.6, marginTop: '3px', fontStyle: 'italic' }}>
                日記：「{c.evidence}」
              </div>
            )}
            {c.excerpt && <div style={{ fontSize: 'calc(var(--ds, 1) * 0.66rem)', color: COLOR.steelDim, lineHeight: 1.6, marginTop: '3px' }}>{c.excerpt}</div>}
          </div>
        ))}
      </div>
      {!doc.contexts.some(c => c.evidence) && (
        <Note>日記裡的逐字引文要等管線開始記錄後，對之後新出現的引用才有；目前這裡只顯示事件標題與正文摘錄。</Note>
      )}
    </>
  )
}

function LinksTab({ index, kind, name, go }: { index: GraphIndex; kind: NodeKind; name: string; go: (id: string) => void }) {
  if (kind === 'person') {
    const events = Array.from(index.personEvents.get(name) ?? [])
      .map(id => index.eventById.get(id)).filter(Boolean)
      .sort((a, b) => b!.date.localeCompare(a!.date))
    const related = Array.from(index.relationDescription.entries())
      .filter(([key]) => key.split('|').includes(name))
      .map(([key, description]) => ({ other: key.split('|').find(n => n !== name) ?? '', description }))
    const cases = new Map<string, number>()
    for (const ev of events) if (ev?.case) cases.set(ev.case, (cases.get(ev.case) ?? 0) + 1)

    return (
      <>
        <div style={{ fontFamily: FONT.mono, fontSize: 'calc(var(--ds, 1) * 0.64rem)', color: COLOR.steelDim, marginTop: '0.6rem' }}>
          人物 · {events.length} 事件 · {related.length} 位已記關係人物
        </div>
        {related.length > 0 && (
          <Section title="關係人物">
            {related.map(r => <Chip key={r.other} label={r.other} kind="person" onClick={() => go(personId(r.other))} />)}
          </Section>
        )}
        {/* L5 寫在 People/*.md「## 關係人物」的敘述，之前完全沒被用到 */}
        {related.filter(r => r.description).map(r => (
          <div key={`d-${r.other}`} style={{ fontSize: 'calc(var(--ds, 1) * 0.66rem)', color: COLOR.steel, lineHeight: 1.6, marginTop: '5px' }}>
            <span style={{ color: COLOR.ink }}>{r.other}</span>
            <span style={{ color: COLOR.steelDim }}>：{r.description}</span>
          </div>
        ))}
        {cases.size > 0 && (
          <Section title="參與案件">
            {Array.from(cases.entries()).map(([c, n]) => <Chip key={c} label={c} kind="case" hint={`${n}`} onClick={() => go(caseId(c))} />)}
          </Section>
        )}
      </>
    )
  }

  if (kind === 'event') {
    const ev = index.eventById.get(name)
    const parts = index.eventParticipants.get(name) ?? []
    const objs = index.eventObjects.get(name) ?? []
    const concepts = index.eventConcepts.get(name) ?? []
    const methods = index.eventMethods.get(name) ?? []
    return (
      <>
        <div style={{ fontFamily: FONT.mono, fontSize: 'calc(var(--ds, 1) * 0.64rem)', color: COLOR.steelDim, marginTop: '0.6rem' }}>
          事件 · {ev?.date}{ev?.status ? ` · ${ev.status}` : ''}
        </div>
        {ev?.tags && ev.tags.length > 0 && (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px', marginTop: '6px' }}>
            {ev.tags.map(t => (
              <span key={t} style={{ fontSize: 'calc(var(--ds, 1) * 0.6rem)', color: COLOR.steelDim, background: COLOR.panel, border: `1px solid ${COLOR.line}`, borderRadius: '999px', padding: '1px 7px' }}>{t}</span>
            ))}
          </div>
        )}
        {parts.length > 0 && (
          <Section title="參與者">
            {parts.map(p => <Chip key={p.person} label={p.person} kind="person" hint={p.role} onClick={() => go(personId(p.person))} />)}
          </Section>
        )}
        {ev?.case && (
          <Section title="所屬案件">
            <Chip label={ev.case} kind="case" onClick={() => go(caseId(ev.case!))} />
          </Section>
        )}
        {objs.length > 0 && (
          <Section title="相關物件">
            {objs.map(o => <Chip key={o} label={o} kind="object" onClick={() => go(objectId(o))} />)}
          </Section>
        )}
        {concepts.length > 0 && (
          <Section title="體現的概念">
            {concepts.map(c => <Chip key={c.name} label={c.name} kind="concept" hint={abstractionHint(index, conceptId(c.name), c.relation)} onClick={() => go(conceptId(c.name))} />)}
          </Section>
        )}
        {methods.length > 0 && (
          <Section title="使用的方法">
            {methods.map(m => <Chip key={m.name} label={m.name} kind="method" hint={abstractionHint(index, methodId(m.name), m.relation)} onClick={() => go(methodId(m.name))} />)}
          </Section>
        )}
        {parts.length === 0 && !ev?.case && objs.length === 0 && concepts.length === 0 && methods.length === 0 && (
          <Note tone="warn">這是一筆孤立事件：沒有參與者、沒有掛案件、也沒有關聯物件。</Note>
        )}
      </>
    )
  }

  if (kind === 'case') {
    const ids = index.caseEvents.get(name) ?? []
    const people = new Map<string, number>()
    for (const id of ids) for (const p of index.eventParticipants.get(id) ?? []) people.set(p.person, (people.get(p.person) ?? 0) + 1)
    return (
      <>
        <div style={{ fontFamily: FONT.mono, fontSize: 'calc(var(--ds, 1) * 0.64rem)', color: COLOR.steelDim, marginTop: '0.6rem' }}>
          案件{index.caseStatus.get(name) ? ` · ${index.caseStatus.get(name)}` : ''} · {ids.length} 事件
        </div>
        {people.size > 0 && (
          <Section title="具名人物">
            {Array.from(people.entries()).sort((a, b) => b[1] - a[1]).map(([p, n]) =>
              <Chip key={p} label={p} kind="person" hint={`${n}`} onClick={() => go(personId(p))} />)}
          </Section>
        )}
      </>
    )
  }

  // 概念／方法沒有「關聯」分頁（相鄰的只有事件，已在「內容」分頁的出現脈絡裡）
  if (kind === 'concept' || kind === 'method') return null

  const ids = index.objectEvents.get(name) ?? []
  const handlers = new Map<string, number>()
  for (const id of ids) for (const p of index.eventParticipants.get(id) ?? []) handlers.set(p.person, (handlers.get(p.person) ?? 0) + 1)
  return (
    <>
      <div style={{ fontFamily: FONT.mono, fontSize: 'calc(var(--ds, 1) * 0.64rem)', color: COLOR.steelDim, marginTop: '0.6rem' }}>
        物件{index.objectType.get(name) ? ` · ${index.objectType.get(name)}` : ''} · {ids.length} 事件
      </div>
      {handlers.size > 0 && (
        <Section title="經手人">
          {Array.from(handlers.entries()).sort((a, b) => b[1] - a[1]).map(([p, n]) =>
            <Chip key={p} label={p} kind="person" hint={`${n}`} onClick={() => go(personId(p))} />)}
        </Section>
      )}
    </>
  )
}

function InsightTab({ index, kind, name, go }: { index: GraphIndex; kind: NodeKind; name: string; go: (id: string) => void }) {
  // 「目前評價」只對人/案/物三種樞紐節點有意義（事件不是樞紐，L5 不會給
  // 事件寫評價），跟其餘三個分支各自的洞察內容放在同一個 id 命名慣例下查。
  const assessment = kind === 'person' ? index.currentAssessmentByHub.get(personId(name))
    : kind === 'case' ? index.currentAssessmentByHub.get(caseId(name))
    : kind === 'object' ? index.currentAssessmentByHub.get(objectId(name))
    : undefined

  if (kind === 'person') {
    const ins = personInsight(index, name)
    const nothing = ins.collaborators.length === 0 && ins.secondDegree.length === 0 && ins.bridgeGroups.length === 0
    return (
      <>
        {assessment && <AssessmentNote assessment={assessment} />}
        {ins.collaborators.length > 0 && (
          <Section title="最常同場的人">
            {ins.collaborators.map(c => (
              <Chip key={c.name} label={c.name} kind="person" hint={`${c.sharedEvents} 次`} onClick={() => go(personId(c.name))} />
            ))}
          </Section>
        )}
        {ins.bridgeGroups.length > 1 && (
          <Note tone="warn">
            橋接風險：這個人是以下 {ins.bridgeGroups.length} 群人之間唯一的連結——
            {ins.bridgeGroups.map(gp => `「${gp.join('、')}」`).join('、')}
            。把他抽掉，這幾群人在圖上就完全斷開了。
          </Note>
        )}
        {ins.missingRelations.length > 0 && (
          <>
            <Section title="關係缺漏（有共同事件，但 People/*.md 沒記）">
              {ins.missingRelations.map(r => (
                <Chip key={r.name} label={r.name} kind="person" hint={`${r.sharedEvents} 次`} onClick={() => go(personId(r.name))} />
              ))}
            </Section>
            <Note>這些配對確實同場過，但 L3 TASK C5 還沒寫進「## 關係人物」。</Note>
          </>
        )}
        {ins.secondDegree.length > 0 && (
          <>
            <Section title="二度人脈（沒同場過，但有共同的人）">
              {ins.secondDegree.slice(0, 14).map(s => (
                <Chip key={s.name} label={s.name} kind="person" hint={`經 ${s.via.join('、')}`} onClick={() => go(personId(s.name))} />
              ))}
            </Section>
          </>
        )}
        {ins.firstDate && (
          <Note>活動期間：{ins.firstDate} ~ {ins.lastDate}。</Note>
        )}
        {nothing && <Note>目前這個人只出現在單人事件裡，沒有可推導的共同參與關係。</Note>}
      </>
    )
  }

  if (kind === 'case') {
    const ins = caseInsight(index, name)
    return (
      <>
        {assessment && <AssessmentNote assessment={assessment} />}
        <Note>
          期間 {ins.firstDate} ~ {ins.lastDate}
          {ins.spanDays !== null && `（跨 ${ins.spanDays} 天）`}
          ，共 {ins.totalEvents} 筆事件。
        </Note>
        {ins.staleDays !== null && ins.staleDays > 60 && (
          <Note tone="warn">已停滯 {ins.staleDays} 天沒有新事件（最後一筆 {ins.lastDate}）。</Note>
        )}
        {ins.longestGap && ins.longestGap.days > 30 && (
          <Note>最長空窗 {ins.longestGap.days} 天：{ins.longestGap.from} → {ins.longestGap.to}。</Note>
        )}
        {ins.coreTeam.length > 0 && (
          <Section title="班底（重複出現）">
            {ins.coreTeam.map(p => <Chip key={p.name} label={p.name} kind="person" hint={`${p.events} 次`} onClick={() => go(personId(p.name))} />)}
          </Section>
        )}
        {ins.oneOffPeople.length > 0 && (
          <Section title="只出現一次">
            {ins.oneOffPeople.map(p => <Chip key={p} label={p} kind="person" onClick={() => go(personId(p))} />)}
          </Section>
        )}
        {ins.eventsWithoutPeople > 0 && (
          <Note>
            {ins.eventsWithoutPeople}/{ins.totalEvents} 筆事件沒有任何具名人物
            {ins.eventsWithoutPeople === ins.totalEvents ? '——這個案子目前完全沒有人物關聯。' : '。'}
          </Note>
        )}
      </>
    )
  }

  if (kind === 'event') {
    const ins = eventInsight(index, name)
    return (
      <>
        {ins.positionInCase && (
          <Note>案件時序第 {ins.positionInCase.index} / {ins.positionInCase.total} 筆{ins.gapFromPrev !== null ? `，距前一筆 ${ins.gapFromPrev} 天` : ''}。</Note>
        )}
        {(ins.prevInCase || ins.nextInCase) && (
          <Section title="同案件前後事件">
            {ins.prevInCase && <Chip label={`← ${ins.prevInCase.title}`} kind="event" hint={ins.prevInCase.date} onClick={() => go(eventId(ins.prevInCase!.id))} />}
            {ins.nextInCase && <Chip label={`${ins.nextInCase.title} →`} kind="event" hint={ins.nextInCase.date} onClick={() => go(eventId(ins.nextInCase!.id))} />}
          </Section>
        )}
        {ins.sameDay.length > 0 && (
          <Section title="同一天的其他事件">
            {ins.sameDay.map(e => <Chip key={e.id} label={e.title} kind="event" onClick={() => go(eventId(e.id))} />)}
          </Section>
        )}
        {ins.isolated && <Note tone="warn">孤立事件：沒有任何關聯可以推導。</Note>}
        {!ins.isolated && !ins.positionInCase && ins.sameDay.length === 0 && <Note>沒有同案件時序或同日事件可對照。</Note>}
      </>
    )
  }

  if (kind === 'concept' || kind === 'method') {
    const ins = abstractionInsight(index, kind, name)
    const label = kind === 'concept' ? '概念' : '方法'
    return (
      <>
        {ins.firstDate && <Note>出現期間：{ins.firstDate} ~ {ins.lastDate}，共 {ins.eventCount} 個事件。</Note>}
        {!ins.promoted && (
          <Note tone="warn">這是候選{label}：只在 1 個事件出現過，是不是同一個說法的不同寫法、或單次語意判斷的雜訊，還需要更多事件驗證。</Note>
        )}
        {ins.relations.length > 0 && (
          <Note>與事件的關係：{ins.relations.map(r => `${r.relation} ${r.events} 次`).join('、')}。</Note>
        )}
        {ins.people.length > 0 && (
          <Section title="出現過的人物">
            {ins.people.map(p => <Chip key={p.name} label={p.name} kind="person" hint={`${p.events} 次`} onClick={() => go(personId(p.name))} />)}
          </Section>
        )}
        {ins.cases.length > 0 && (
          <Section title="跨越的案件">
            {ins.cases.map(c => <Chip key={c.name} label={c.name} kind="case" hint={`${c.events} 次`} onClick={() => go(caseId(c.name))} />)}
          </Section>
        )}
        {ins.coConcepts.length > 0 && (
          <Section title="常一起出現的概念">
            {ins.coConcepts.map(c => <Chip key={c.name} label={c.name} kind="concept" hint={`${c.events} 次`} onClick={() => go(conceptId(c.name))} />)}
          </Section>
        )}
        {ins.coMethods.length > 0 && (
          <Section title="常一起出現的方法">
            {ins.coMethods.map(m => <Chip key={m.name} label={m.name} kind="method" hint={`${m.events} 次`} onClick={() => go(methodId(m.name))} />)}
          </Section>
        )}
        {ins.cases.length > 1 && <Note>這個{label}跨了 {ins.cases.length} 個案件——這正是抽象層存在的價值：不同脈絡下重複出現的做法或想法。</Note>}
      </>
    )
  }

  const ins = objectInsight(index, name)
  return (
    <>
      {assessment && <AssessmentNote assessment={assessment} />}
      {ins.firstDate && <Note>出現期間：{ins.firstDate} ~ {ins.lastDate}。</Note>}
      {ins.handlers.length > 0 && (
        <Section title="經手人">
          {ins.handlers.map(h => <Chip key={h.name} label={h.name} kind="person" hint={`${h.events} 次`} onClick={() => go(personId(h.name))} />)}
        </Section>
      )}
      {ins.cases.length > 0 && (
        <Section title="關聯案件">
          {ins.cases.map(c => <Chip key={c} label={c} kind="case" onClick={() => go(caseId(c))} />)}
        </Section>
      )}
      {ins.reusedAcrossCases && <Note tone="warn">這個物件跨了 {ins.cases.length} 個案件，可能是共用文件或歸檔需要確認。</Note>}
      {ins.handlers.length === 0 && ins.cases.length === 0 && <Note>這個物件目前只掛在沒有人物、也沒有案件的事件上。</Note>}
    </>
  )
}

// ── 時間軸分頁：這個節點關聯的事件，日期在左、標題在右，由新到舊，依月份分組 ──
// 事件清單只出現在這裡（關聯分頁不再重複列）；概念／方法的出現脈絡在它們的「內容」分頁。
function EventTimelineTab({
  index, kind, name, go, expanded,
}: { index: GraphIndex; kind: NodeKind; name: string; go: (id: string) => void; expanded: boolean }) {
  const groups = useMemo(
    () => groupByMonth(sortNewestFirst(entityEvents(index, kind, name))),
    [index, kind, name],
  )
  const total = groups.reduce((n, g) => n + g.rows.length, 0)
  if (total === 0) return <Note>這個節點目前沒有關聯的事件。</Note>

  const dotSize = expanded ? 11 : 8
  const dateW = expanded ? '8.4rem' : '5.6rem'
  return (
    <div style={{ marginTop: '0.5rem' }}>
      <div style={{ fontFamily: FONT.mono, fontSize: 'calc(var(--ds, 1) * 0.62rem)', color: COLOR.steelDim, marginBottom: '2px' }}>
        共 {total} 筆關聯事件 · 新→舊
      </div>
      {groups.map(g => (
        <div key={g.month}>
          <div style={{
            fontFamily: FONT.mono, fontSize: 'calc(var(--ds, 1) * 0.62rem)', color: COLOR.amberDim, letterSpacing: '0.06em',
            margin: '0.8rem 0 0.3rem', paddingBottom: '2px', borderBottom: `1px solid ${COLOR.line}`,
          }}>{g.month} · {g.rows.length}</div>
          <div style={{ position: 'relative' }}>
            {/* 垂直軸線：在日期欄與標題欄之間 */}
            <div style={{ position: 'absolute', left: `calc(${dateW} + ${dotSize / 2}px)`, top: 4, bottom: 4, width: 1, background: COLOR.line }} />
            {g.rows.map(r => (
              <div key={r.id} style={{ display: 'flex', alignItems: 'flex-start', gap: '0.6rem', padding: '0.28rem 0' }}>
                <div style={{
                  flex: `0 0 ${dateW}`, fontFamily: FONT.mono, fontSize: 'calc(var(--ds, 1) * 0.64rem)', color: COLOR.steelDim,
                  paddingTop: '2px', whiteSpace: 'nowrap',
                }}>{r.date}</div>
                <div style={{ flexShrink: 0, width: dotSize, paddingTop: '5px', position: 'relative', zIndex: 1 }}>
                  <span style={{ display: 'block', width: dotSize, height: dotSize, borderRadius: '50%', background: KIND_COLOR.event, boxShadow: `0 0 0 3px ${COLOR.panelDeep}` }} />
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div
                    onClick={() => go(eventId(r.id))}
                    style={{ cursor: 'pointer', fontSize: 'calc(var(--ds, 1) * 0.74rem)', color: COLOR.ink, lineHeight: 1.5 }}
                  >{r.title}</div>
                  {(r.status || (r.case && kind !== 'case')) && (
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px', fontFamily: FONT.mono, fontSize: 'calc(var(--ds, 1) * 0.58rem)', color: COLOR.steelDim, marginTop: '1px' }}>
                      {r.status && <span>{r.status}</span>}
                      {r.case && kind !== 'case' && <span>案 · {r.case}</span>}
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  )
}

// ── 敘事分頁：L5 的圖譜編織（weave）與時效警報（alert）──
// 原本是一整坨文字。這裡拆成「日期在左、右側是標題句＋條列」，前幾則展開、其餘收合；條列裡的
// 「標籤：內容」標籤獨立成小標，[[連結]] 可以點。拆解是啟發式的（見 nodeTimeline.parseNarrative），不改 L5 輸出。
const NARRATIVE_OPEN = 3       // 預設展開最新幾則
const NARRATIVE_ITEMS = 6      // 每則預設顯示幾條，其餘「展開」

function NarrativeTab({
  index, selectionId, go, expanded,
}: { index: GraphIndex; selectionId: string; go: (id: string) => void; expanded: boolean }) {
  const entries = index.narrativesByHub.get(selectionId) ?? []      // 已由新到舊排序
  const [showOlder, setShowOlder] = useState(false)
  const resolve = (t: string) => resolveWikilink(index, t)
  if (entries.length === 0) return <Note>目前沒有 L5 敘事。</Note>
  const visible = showOlder ? entries : entries.slice(0, NARRATIVE_OPEN)
  const dateW = expanded ? '8.4rem' : '5.6rem'
  return (
    <div style={{ marginTop: '0.5rem' }}>
      <div style={{ fontFamily: FONT.mono, fontSize: 'calc(var(--ds, 1) * 0.62rem)', color: COLOR.steelDim, marginBottom: '4px' }}>
        L5 敘事 · 共 {entries.length} 則 · 新→舊
      </div>
      {visible.map((n, i) => (
        <NarrativeEntry key={`${n.date}-${n.type}-${i}`} entry={n} dateW={dateW} resolve={resolve} go={go} />
      ))}
      {entries.length > NARRATIVE_OPEN && (
        <div
          onClick={() => setShowOlder(v => !v)}
          style={{ cursor: 'pointer', textAlign: 'center', margin: '0.7rem 0 0.2rem', fontFamily: FONT.mono, fontSize: 'calc(var(--ds, 1) * 0.62rem)', color: COLOR.amberDim }}
        >{showOlder ? '收合較早的敘事' : `顯示較早的 ${entries.length - NARRATIVE_OPEN} 則`}</div>
      )}
    </div>
  )
}

function NarrativeEntry({
  entry, dateW, resolve, go,
}: { entry: { date: string; type: 'weave' | 'alert'; text: string }; dateW: string; resolve: (t: string) => string | null; go: (id: string) => void }) {
  const parsed = useMemo(() => parseNarrative(entry.text), [entry.text])
  const [all, setAll] = useState(false)
  const shown = all ? parsed.items : parsed.items.slice(0, NARRATIVE_ITEMS)
  const isAlert = entry.type === 'alert'
  const accent = isAlert ? COLOR.warn : COLOR.amber
  const text = (t: string) => <InlineText text={t} resolveWikilink={resolve} onNavigate={go} />
  return (
    <div style={{ display: 'flex', gap: '0.7rem', padding: '0.7rem 0', borderBottom: `1px solid ${COLOR.line}` }}>
      <div style={{ flex: `0 0 ${dateW}`, paddingTop: '2px' }}>
        <div style={{ fontFamily: FONT.mono, fontSize: 'calc(var(--ds, 1) * 0.64rem)', color: COLOR.steelDim, whiteSpace: 'nowrap' }}>{entry.date}</div>
        <div style={{ fontFamily: FONT.mono, fontSize: 'calc(var(--ds, 1) * 0.58rem)', color: accent, marginTop: '2px' }}>{isAlert ? '⚠ 警報' : '編織'}</div>
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        {parsed.headline && (
          <div style={{ fontSize: 'calc(var(--ds, 1) * 0.76rem)', color: COLOR.ink, lineHeight: 1.6, fontWeight: 600 }}>{text(parsed.headline)}</div>
        )}
        {shown.length > 0 && (
          <ul style={{ margin: parsed.headline ? '0.35rem 0 0' : 0, padding: 0, listStyle: 'none', display: 'flex', flexDirection: 'column', gap: '0.35rem' }}>
            {shown.map((it, k) => (
              <li key={k} style={{ display: 'flex', gap: '0.5rem', alignItems: 'baseline', fontSize: 'calc(var(--ds, 1) * 0.72rem)', color: COLOR.steel, lineHeight: 1.7 }}>
                {it.label
                  ? <span style={{ flexShrink: 0, fontFamily: FONT.mono, fontSize: 'calc(var(--ds, 1) * 0.6rem)', color: accent, border: `1px solid ${COLOR.line}`, borderRadius: '999px', padding: '0 7px' }}>{it.label}</span>
                  : <span style={{ flexShrink: 0, color: COLOR.steelDim }}>·</span>}
                <span style={{ minWidth: 0 }}>{text(it.text)}</span>
              </li>
            ))}
          </ul>
        )}
        {parsed.items.length > NARRATIVE_ITEMS && (
          <div
            onClick={() => setAll(v => !v)}
            style={{ cursor: 'pointer', marginTop: '0.4rem', fontFamily: FONT.mono, fontSize: 'calc(var(--ds, 1) * 0.6rem)', color: COLOR.amberDim }}
          >{all ? '收合' : `展開其餘 ${parsed.items.length - NARRATIVE_ITEMS} 條`}</div>
        )}
      </div>
    </div>
  )
}
