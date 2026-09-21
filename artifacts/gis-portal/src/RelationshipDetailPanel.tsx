// ─────────────────────────────────────────────
// 選取節點後的詳情面板：「關聯」「洞察」「時間軸」三個分頁。
//
// 舊版只是唯讀的顯示卡，而且事件卡是死路——只印標題/日期/狀態，案件是純
// 文字不能點，參與者跟物件根本沒列，走到事件就走不下去了。這版每一種實體
// 都把所有相鄰實體列成可點的 chip，點下去就換選取（外層會把它置中），所
// 以可以一路串下去；「洞察」分頁放 graphInsights.ts 推導出來的東西（共同
// 參與排行、關係缺漏、二度人脈、橋接風險、案件停滯與班底…），這些都不是
// 資料庫裡直接有的欄位，是從圖的拓撲算出來的。
//
// 2026-09-21：使用者反映浮動小面板字太小、敘事內容一多就讀不動，而且看資
// 料時還要顧著背景的 3D 場景。兩個對應調整：
//   1. 全部字級改成 `calc(var(--ds, 1) * Nrem)`——面板外層設一次 --ds，展
//      開態設大一點（1.55）、收合態也比原本略大（1.12），不用逐一手改每
//      個字級數字，也不影響 width/maxHeight 這類跟版面結構有關、不該跟著
//      字級縮放的 rem。
//   2. 新增「展開」鈕：面板改成 `position: fixed; inset: 0` 蓋滿整個視窗
//      （z-index 高於 RelationshipUniverse 的 3D canvas），看資料時完全不
//      會被背景場景干擾；展開後版面也從單欄窄卡片改寬（見下方 layout）。
//   3. 原本的「敘事」分頁改名「時間軸」，把 L5 敘事（編織/警報）跟這個節
//      點自己關聯的事件合併成同一條時間軸（TimelineTab）——這是使用者明
//      確要的呈現方式：「敘事、洞察、事件用一個時間軸圖來顯示」。洞察分
//      頁的內容大多是非時間性的拓撲推導（橋接風險、二度人脈…），不是每項
//      都有日期可畫進時間軸，所以洞察維持獨立分頁，只有「有日期」的東西
//      （敘事＋事件）進時間軸。
// ─────────────────────────────────────────────
import { useMemo, useState, type CSSProperties } from 'react'
import { COLOR, FONT } from './theme'
import type { HermesGraphData } from './hermesGraphApi'
import {
  buildIndex, personInsight, caseInsight, eventInsight, objectInsight, entityEvents,
  personId, eventId, caseId, objectId, splitId,
  type GraphIndex, type NodeKind,
} from './graphInsights'

export interface Selection { kind: NodeKind; id: string }

const KIND_LABEL: Record<NodeKind, string> = { person: '人物', event: '事件', case: '案件', object: '物件' }
const KIND_COLOR: Record<NodeKind, string> = { person: '#aab4c4', event: '#8f97a6', case: '#d8d4c8', object: '#93a2b8' }
// 時間軸三種項目共用的顏色/標籤——事件是中性灰（跟 KIND_COLOR.event 同一
// 支色），敘事沿用 L5 既有的 weave=amber／alert=warn 語意。
const TIMELINE_DOT_COLOR: Record<'event' | 'weave' | 'alert', string> = { event: '#8f97a6', weave: COLOR.amber, alert: COLOR.warn }
const TIMELINE_KIND_LABEL: Record<'event' | 'weave' | 'alert', string> = { event: '事件', weave: '編織', alert: '警報' }

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

export function RelationshipDetailPanel({
  graph, selection, onSelect, onClose, onSetPathAnchor, pathAnchor, trail, onTrailJump,
}: {
  graph: NonNullable<HermesGraphData['graph']>
  selection: Selection
  onSelect: (sel: Selection) => void
  onClose: () => void
  onSetPathAnchor: (id: string | null) => void
  pathAnchor: string | null
  trail: Selection[]
  onTrailJump: (index: number) => void
}) {
  const [tab, setTab] = useState<'links' | 'insight' | 'timeline'>('links')
  const [expanded, setExpanded] = useState(false)
  const index: GraphIndex = useMemo(() => buildIndex(graph), [graph])
  const { kind, name } = splitId(selection.id)

  const title = kind === 'event' ? (index.eventById.get(name)?.title ?? name) : name
  const go = (id: string) => onSelect({ kind: splitId(id).kind, id })
  // 時間軸分頁只對人/案/物三種樞紐節點有意義（事件節點自己就是時間軸上的
  // 一個點，沒有「它自己的時間軸」可畫）——事件被選取時退回關聯分頁，不留
  // 一個內容永遠是空的分頁。
  const tabs = kind === 'event' ? (['links', 'insight'] as const) : (['links', 'insight', 'timeline'] as const)
  const effectiveTab = tab === 'timeline' && kind === 'event' ? 'links' : tab
  const tabLabel = (t: typeof effectiveTab) => t === 'links' ? '關聯' : t === 'insight' ? '洞察' : '時間軸'

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
        {effectiveTab === 'links'
          ? <LinksTab index={index} kind={kind} name={name} go={go} />
          : effectiveTab === 'insight'
          ? <InsightTab index={index} kind={kind} name={name} go={go} />
          : <TimelineTab index={index} kind={kind} name={name} selectionId={selection.id} go={go} expanded={expanded} />}
      </div>
    </div>
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
        <Section title="參與事件">
          {events.map(ev => <Chip key={ev!.id} label={ev!.title} kind="event" hint={ev!.date} onClick={() => go(eventId(ev!.id))} />)}
        </Section>
      </>
    )
  }

  if (kind === 'event') {
    const ev = index.eventById.get(name)
    const parts = index.eventParticipants.get(name) ?? []
    const objs = index.eventObjects.get(name) ?? []
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
        {parts.length === 0 && !ev?.case && objs.length === 0 && (
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
        <Section title="事件時序（舊→新）">
          {ids.map(id => {
            const ev = index.eventById.get(id)
            return ev ? <Chip key={id} label={ev.title} kind="event" hint={ev.date} onClick={() => go(eventId(id))} /> : null
          })}
        </Section>
      </>
    )
  }

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
      <Section title="出現於事件">
        {ids.map(id => {
          const ev = index.eventById.get(id)
          return ev ? <Chip key={id} label={ev.title} kind="event" hint={ev.date} onClick={() => go(eventId(id))} /> : null
        })}
      </Section>
    </>
  )
}

function InsightTab({ index, kind, name, go }: { index: GraphIndex; kind: NodeKind; name: string; go: (id: string) => void }) {
  if (kind === 'person') {
    const ins = personInsight(index, name)
    const nothing = ins.collaborators.length === 0 && ins.secondDegree.length === 0 && ins.bridgeGroups.length === 0
    return (
      <>
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

  const ins = objectInsight(index, name)
  return (
    <>
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

// 敘事文字裡的 [[名稱]] 解析成可點連結——解析不到對應節點（wikilink 指到
// 圖上沒有的東西，或事件標題對不上重組後的檔名）就原樣顯示文字，不是每個
// 連結都保證能點，見 graphInsights.ts 的 nodeIdByLabel 說明。
function NarrativeText({ text, index, go }: { text: string; index: GraphIndex; go: (id: string) => void }) {
  const parts = text.split(/(\[\[[^\]]+\]\])/g)
  return (
    <>
      {parts.map((part, i) => {
        const m = part.match(/^\[\[([^\]]+)\]\]$/)
        if (!m) return <span key={i}>{part}</span>
        const target = index.nodeIdByLabel.get(m[1])
        if (!target) return <span key={i}>{m[1]}</span>
        return (
          <span
            key={i}
            onClick={() => go(target)}
            style={{ color: COLOR.amber, cursor: 'pointer', textDecoration: 'underline', textUnderlineOffset: '2px' }}
          >{m[1]}</span>
        )
      })}
    </>
  )
}

// 時間軸分頁：這個節點自己關聯的事件（entityEvents）跟 L5 樞紐敘事（圖譜
// 編織 weave + 時效警報 alert，narrativesByHub）合併成同一條依日期新到舊
// 排序的時間軸，用左側色點區分三種項目——這是使用者明確要的呈現方式
// （「敘事、洞察、事件用一個時間軸圖來顯示」）。洞察分頁的內容大多沒有日
// 期可畫（橋接風險、二度人脈這類是拓撲推導，不是時間點事件），所以洞察
// 維持獨立分頁，這裡只合併「真的有日期」的兩種來源。
// `expanded` 只影響時間軸左側色點／間距這幾個原本用 px 寫死、不受 --ds
// 字級縮放影響的視覺元素，展開時一起放大，不然滿版模式下這幾個點會顯得
// 過小、跟旁邊放大的文字不成比例。
type TimelineEntry =
  | { itemKind: 'event'; date: string; id: string; title: string; status: string | null }
  | { itemKind: 'narrative'; date: string; type: 'weave' | 'alert'; text: string }

function TimelineTab({
  index, kind, name, selectionId, go, expanded,
}: { index: GraphIndex; kind: NodeKind; name: string; selectionId: string; go: (id: string) => void; expanded: boolean }) {
  const items: TimelineEntry[] = useMemo(() => {
    const events = entityEvents(index, kind, name)
      .map((e): TimelineEntry => ({ itemKind: 'event', date: e.date, id: e.id, title: e.title, status: e.status }))
    const narratives = (index.narrativesByHub.get(selectionId) ?? [])
      .map((n): TimelineEntry => ({ itemKind: 'narrative', date: n.date, type: n.type, text: n.text }))
    return [...events, ...narratives].sort((a, b) => b.date.localeCompare(a.date))
  }, [index, kind, name, selectionId])

  if (items.length === 0) {
    return <Note>目前沒有可畫進時間軸的關聯事件或 L5 敘事內容。</Note>
  }

  const dotSize = expanded ? 12 : 8
  const railGap = expanded ? '1.3rem' : '0.85rem'
  const railItemGap = expanded ? '1.1rem' : '0.65rem'

  return (
    <div style={{ marginTop: '0.6rem', position: 'relative' }}>
      <div style={{ position: 'absolute', left: dotSize / 2 - 0.5, top: 4, bottom: 4, width: 1, background: COLOR.line }} />
      <div style={{ display: 'flex', flexDirection: 'column', gap: railGap }}>
        {items.map((it, i) => {
          const typeKey = it.itemKind === 'event' ? 'event' : it.type
          return (
            <div key={`${it.date}-${i}`} style={{ display: 'flex', gap: railItemGap }}>
              <div style={{ flexShrink: 0, width: dotSize, display: 'flex', justifyContent: 'center', paddingTop: '4px', position: 'relative', zIndex: 1 }}>
                <span style={{ width: dotSize, height: dotSize, borderRadius: '50%', background: TIMELINE_DOT_COLOR[typeKey], display: 'block', boxShadow: `0 0 0 3px ${COLOR.panelDeep}` }} />
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: 'flex', gap: '8px', alignItems: 'center', fontFamily: FONT.mono, fontSize: 'calc(var(--ds, 1) * 0.62rem)', color: COLOR.steelDim }}>
                  <span>{it.date}</span>
                  <span style={{ color: TIMELINE_DOT_COLOR[typeKey] }}>{TIMELINE_KIND_LABEL[typeKey]}</span>
                  {it.itemKind === 'event' && it.status && <span>· {it.status}</span>}
                </div>
                {it.itemKind === 'event' ? (
                  <div
                    onClick={() => go(eventId(it.id))}
                    style={{ cursor: 'pointer', fontSize: 'calc(var(--ds, 1) * 0.76rem)', color: COLOR.ink, lineHeight: 1.5, marginTop: '3px' }}
                  >{it.title}</div>
                ) : (
                  <div style={{ fontSize: 'calc(var(--ds, 1) * 0.74rem)', color: COLOR.steel, lineHeight: 1.8, marginTop: '3px' }}>
                    <NarrativeText text={it.text} index={index} go={go} />
                  </div>
                )}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
