// ─────────────────────────────────────────────
// 選取節點後的詳情面板：「關聯」與「洞察」兩個分頁。
//
// 舊版只是唯讀的顯示卡，而且事件卡是死路——只印標題/日期/狀態，案件是純
// 文字不能點，參與者跟物件根本沒列，走到事件就走不下去了。這版每一種實體
// 都把所有相鄰實體列成可點的 chip，點下去就換選取（外層會把它置中），所
// 以可以一路串下去；「洞察」分頁放 graphInsights.ts 推導出來的東西（共同
// 參與排行、關係缺漏、二度人脈、橋接風險、案件停滯與班底…），這些都不是
// 資料庫裡直接有的欄位，是從圖的拓撲算出來的。
// ─────────────────────────────────────────────
import { useMemo, useState } from 'react'
import { COLOR, FONT } from './theme'
import type { HermesGraphData } from './hermesGraphApi'
import {
  buildIndex, personInsight, caseInsight, eventInsight, objectInsight,
  personId, eventId, caseId, objectId, splitId,
  type GraphIndex, type NodeKind,
} from './graphInsights'

export interface Selection { kind: NodeKind; id: string }

const KIND_LABEL: Record<NodeKind, string> = { person: '人物', event: '事件', case: '案件', object: '物件' }
const KIND_COLOR: Record<NodeKind, string> = { person: '#aab4c4', event: '#8f97a6', case: '#d8d4c8', object: '#93a2b8' }

function Chip({ label, kind, hint, onClick }: { label: string; kind: NodeKind; hint?: string; onClick: () => void }) {
  return (
    <span
      onClick={onClick}
      title={hint ? `${label}（${hint}）` : label}
      style={{
        display: 'inline-flex', alignItems: 'center', gap: '5px', maxWidth: '100%',
        padding: '3px 9px', borderRadius: '999px', cursor: 'pointer',
        background: 'rgba(255,255,255,0.04)', border: `1px solid ${COLOR.line}`,
        fontSize: '0.68rem', color: COLOR.ink, lineHeight: 1.5,
      }}
    >
      <span style={{ width: 6, height: 6, borderRadius: '50%', background: KIND_COLOR[kind], flexShrink: 0 }} />
      <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{label}</span>
      {hint && <span style={{ color: COLOR.steelDim, fontFamily: FONT.mono, fontSize: '0.6rem', flexShrink: 0 }}>{hint}</span>}
    </span>
  )
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div style={{ marginTop: '0.7rem' }}>
      <div style={{ fontFamily: FONT.mono, fontSize: '0.6rem', color: COLOR.steelDim, letterSpacing: '0.08em', marginBottom: '5px' }}>{title}</div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '5px' }}>{children}</div>
    </div>
  )
}

function Note({ children, tone }: { children: React.ReactNode; tone?: 'warn' | 'plain' }) {
  return (
    <div style={{
      fontSize: '0.68rem', lineHeight: 1.6, marginTop: '0.55rem',
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
  const [tab, setTab] = useState<'links' | 'insight'>('links')
  const index: GraphIndex = useMemo(() => buildIndex(graph), [graph])
  const { kind, name } = splitId(selection.id)

  const title = kind === 'event' ? (index.eventById.get(name)?.title ?? name) : name
  const go = (id: string) => onSelect({ kind: splitId(id).kind, id })

  return (
    <div style={{
      position: 'absolute', left: '1.2rem', bottom: '1.2rem', width: 'min(430px, calc(100% - 2.4rem))',
      maxHeight: 'calc(100% - 2.4rem)', display: 'flex', flexDirection: 'column',
      background: 'rgba(18,19,25,0.96)', border: `1px solid ${COLOR.line}`, borderRadius: '6px',
    }}>
      <div style={{ padding: '0.8rem 1rem 0' }}>
        {trail.length > 1 && (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px', alignItems: 'center', marginBottom: '6px', fontFamily: FONT.mono, fontSize: '0.58rem', color: COLOR.steelDim }}>
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
          <div style={{ fontSize: '0.84rem', color: COLOR.ink, fontWeight: 600, lineHeight: 1.4 }}>{title}</div>
          <span onClick={onClose} style={{ cursor: 'pointer', color: COLOR.steelDim, fontSize: '0.85rem', flexShrink: 0 }}>✕</span>
        </div>

        <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', marginTop: '6px' }}>
          {(['links', 'insight'] as const).map(t => (
            <span key={t} onClick={() => setTab(t)} style={{
              cursor: 'pointer', fontFamily: FONT.mono, fontSize: '0.64rem', paddingBottom: '3px',
              color: tab === t ? COLOR.amber : COLOR.steelDim,
              borderBottom: `1px solid ${tab === t ? COLOR.amber : 'transparent'}`,
            }}>{t === 'links' ? '關聯' : '洞察'}</span>
          ))}
          <div style={{ flex: 1 }} />
          <span
            onClick={() => onSetPathAnchor(pathAnchor === selection.id ? null : selection.id)}
            style={{ cursor: 'pointer', fontFamily: FONT.mono, fontSize: '0.6rem', color: pathAnchor === selection.id ? COLOR.amber : COLOR.steelDim }}
          >{pathAnchor === selection.id ? '● 已設為路徑起點' : '設為路徑起點'}</span>
        </div>
      </div>

      <div style={{ padding: '0 1rem 0.9rem', overflowY: 'auto' }}>
        {tab === 'links'
          ? <LinksTab index={index} kind={kind} name={name} go={go} />
          : <InsightTab index={index} kind={kind} name={name} go={go} />}
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
        <div style={{ fontFamily: FONT.mono, fontSize: '0.64rem', color: COLOR.steelDim, marginTop: '0.6rem' }}>
          人物 · {events.length} 事件 · {related.length} 位已記關係人物
        </div>
        {related.length > 0 && (
          <Section title="關係人物">
            {related.map(r => <Chip key={r.other} label={r.other} kind="person" onClick={() => go(personId(r.other))} />)}
          </Section>
        )}
        {/* L5 寫在 People/*.md「## 關係人物」的敘述，之前完全沒被用到 */}
        {related.filter(r => r.description).map(r => (
          <div key={`d-${r.other}`} style={{ fontSize: '0.66rem', color: COLOR.steel, lineHeight: 1.6, marginTop: '5px' }}>
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
        <div style={{ fontFamily: FONT.mono, fontSize: '0.64rem', color: COLOR.steelDim, marginTop: '0.6rem' }}>
          事件 · {ev?.date}{ev?.status ? ` · ${ev.status}` : ''}
        </div>
        {ev?.tags && ev.tags.length > 0 && (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px', marginTop: '6px' }}>
            {ev.tags.map(t => (
              <span key={t} style={{ fontSize: '0.6rem', color: COLOR.steelDim, background: COLOR.panel, border: `1px solid ${COLOR.line}`, borderRadius: '999px', padding: '1px 7px' }}>{t}</span>
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
        <div style={{ fontFamily: FONT.mono, fontSize: '0.64rem', color: COLOR.steelDim, marginTop: '0.6rem' }}>
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
      <div style={{ fontFamily: FONT.mono, fontSize: '0.64rem', color: COLOR.steelDim, marginTop: '0.6rem' }}>
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
