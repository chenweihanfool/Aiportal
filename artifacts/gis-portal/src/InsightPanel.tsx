import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { apiFetchInsightDetail } from './insightApi'
import { PROVENANCE_LABEL, RELATION_LABEL, type Insight, type InsightDetail } from './insightModel'
import { PinButton } from './PinButton'
import { pinTargetFor } from './pushTriggers'
import { createPortal } from 'react-dom'
import { DayReportDialog } from './DayReportDialog'
import { buildTimelineDayLink } from './timelineLink'
import { dossierHref } from './dossier'
import { FOCUS_ICON, STAGE_COLOR, STAGE_ICON, STAGE_LABEL, isFocus, stageOf } from './ideasView'
import type { IdeaItem } from './boardApi'
import { bornBand } from './hhiBorn'
import { insightUsages } from './knowledgeSteps'
import { parseTopics, type Topic } from './knowledgeView'

// 心得側邊面板：一則心得的詳情（原文、那一天、連結的人／想法／知識、後來怎麼變）。樣式 it- 前綴在 portal.css。

type DetailState = { id: string; state: 'loading' | 'ok' | 'missing' | 'error'; data: InsightDetail | null }

const DAY_HEADINGS_SHOWN = 4

const API_BASE = import.meta.env.BASE_URL ?? '/'

/** 心得面板「用在」：讀知識頁同一支 feed；失敗或沒有就回 null（不顯示這一區） */
async function fetchTopicsForUsage(pw: string, signal: AbortSignal): Promise<Topic[] | null> {
  const r = await fetch(`${API_BASE}api/feed/topics`, { headers: { 'x-admin-password': pw }, signal })
  if (!r.ok) return null
  return parseTopics(await r.json())?.topics ?? null
}

export function InsightPanel({ pw, id, fallback, onClose, onSelect, ideas = null, onOpenIdea, hhiScores = null }: {
  pw: string | null; id: string; fallback: Insight | null; onClose: () => void; onSelect: (id: string) => void
  ideas?: IdeaItem[] | null; onOpenIdea?: (id: string) => void; hhiScores?: Map<string, number> | null
}) {
  const [det, setDet] = useState<DetailState | null>(null)
  const [showDay, setShowDay] = useState(false)
  const [moreDay, setMoreDay] = useState(false)
  const [topicsData, setTopicsData] = useState<Topic[] | null>(null)
  useEffect(() => {
    if (!pw) { setTopicsData(null); return }
    const ctl = new AbortController()
    fetchTopicsForUsage(pw, ctl.signal).then((t) => { if (!ctl.signal.aborted) setTopicsData(t) }).catch(() => { if (!ctl.signal.aborted) setTopicsData(null) })
    return () => ctl.abort()
  }, [pw])
  const usages = useMemo(() => (topicsData ? insightUsages(topicsData, id) : []), [topicsData, id])
  const closeRef = useRef<HTMLButtonElement>(null)
  useEffect(() => { closeRef.current?.focus() }, [])
  useEffect(() => {
    // 日報視窗開著時 Esc 只關視窗，不連心得面板一起關
    const f = (e: KeyboardEvent) => { if (e.key === 'Escape' && !showDay) onClose() }
    window.addEventListener('keydown', f)
    return () => window.removeEventListener('keydown', f)
  }, [onClose, showDay])
  const dateBtnRef = useRef<HTMLButtonElement>(null)
  const closeDay = useCallback(() => { setShowDay(false); setTimeout(() => dateBtnRef.current?.focus(), 0) }, [])
  useEffect(() => { setShowDay(false); setMoreDay(false) }, [id])
  useEffect(() => {
    if (!pw) { setDet(null); return }
    const ctl = new AbortController()
    setDet({ id, state: 'loading', data: null })
    apiFetchInsightDetail(pw, id, ctl.signal)
      .then((d) => { if (!ctl.signal.aborted) setDet({ id, state: d ? 'ok' : 'missing', data: d }) })
      .catch(() => { if (!ctl.signal.aborted) setDet({ id, state: 'error', data: null }) })
    return () => ctl.abort()
  }, [pw, id])

  const cur = det && det.id === id ? det : null
  const d = cur?.state === 'ok' ? cur.data : null
  const text = d?.text ?? fallback?.text ?? ''
  const date = d?.date ?? fallback?.date ?? ''
  const bornScore = date ? hhiScores?.get(date.slice(0, 10)) : undefined
  const born = bornScore === undefined ? null : bornBand(bornScore)
  const relation = d?.relation ?? fallback?.relation ?? null
  const provenance = d?.provenance ?? fallback?.provenance ?? null
  const items = d && d.threadItems.length > 0 ? d.threadItems : fallback ? [fallback] : []
  const links = d?.links ?? fallback?.links ?? null
  const people = [...(links?.people ?? [])].sort((a, b) => Number(b.sameSegment) - Number(a.sameSegment))
  const ideaLinks = links?.ideas ?? []
  const topics = links?.topics ?? []
  const noLinks = !!d && people.length === 0 && ideaLinks.length === 0 && topics.length === 0
  const headings = d?.day.headings ?? []
  const ideaById = new Map((ideas ?? []).map((i) => [i.id, i] as const))
  const pinTarget = text ? pinTargetFor({ kind: 'insight', id, title: text.length > 60 ? `${text.slice(0, 59)}…` : text }) : null

  return (
    <>
      <div className="it-back-drop" onClick={onClose} aria-hidden />
      <aside className="it-panel" role="dialog" aria-label="心得詳情" data-testid="insight-panel">
        <div className="it-panel-top">
          <span className="it-kd">心得{d ? `・${d.cluster.name}` : ''}</span>
          <button ref={closeRef} type="button" className="it-x" onClick={onClose} aria-label="關閉心得面板">關閉 ✕</button>
        </div>
        <h3 className="it-panel-text" data-testid="insight-panel-text">{text || '（找不到這則心得）'}</h3>
        <div className="it-meta">
          {date && (
            <button ref={dateBtnRef} type="button" className="it-date" data-testid="insight-date" aria-haspopup="dialog" onClick={() => setShowDay(true)}>
              {date}{d?.time ?? fallback?.time ? ` ${d?.time ?? fallback?.time}` : ''}・看那天日報
            </button>
          )}
          {relation && <span className={`it-rel it-rel-${relation}`}>{RELATION_LABEL[relation]}</span>}
          {bornScore !== undefined && (
            <span className={`it-born it-born-${born}`} data-testid="insight-born-score">
              那天幸福指數 {bornScore}{born === 'high' ? ' 高' : born === 'low' ? ' 低' : ''}
            </span>
          )}
          {provenance && <span className="it-prov">{PROVENANCE_LABEL[provenance]}</span>}
        </div>
        {(d || date) && <h4 className="it-lb">那一天</h4>}
        {headings.length > 0 && (
          <div data-testid="insight-day-headings">
            <p className="it-dim it-day-lead">那天的幾件事</p>
            <ul className="it-day-list">
              {(moreDay ? headings : headings.slice(0, DAY_HEADINGS_SHOWN)).map((h) => <li key={h}>{h}</li>)}
            </ul>
            {headings.length > DAY_HEADINGS_SHOWN && !moreDay && (
              <button type="button" className="it-more" data-testid="insight-day-more" onClick={() => setMoreDay(true)}>還有 {headings.length - DAY_HEADINGS_SHOWN} 件</button>
            )}
          </div>
        )}
        {people.length > 0 && (
          <div className="it-grp" data-testid="insight-people">
            <p className="it-dim it-day-lead">見了誰</p>
            <ul className="it-chips">
              {people.map((p) => (
                <li key={p.id}>
                  {p.dossier !== null
                    ? <a className="it-chip" href={dossierHref('person', p.dossier)} aria-label={`開啟人物卷宗：${p.name}`}>{p.name}{p.sameSegment && <span className="it-chip-tag">同一段</span>}</a>
                    : <span className="it-chip it-chip-off" title="還沒有人物卷宗" aria-label={`${p.name}（還沒有人物卷宗）`}>{p.name}{p.sameSegment && <span className="it-chip-tag">同一段</span>}</span>}
                </li>
              ))}
            </ul>
          </div>
        )}
        {ideaLinks.length > 0 && (
          <div className="it-grp" data-testid="insight-ideas">
            <p className="it-dim it-day-lead">在做的想法</p>
            <ul className="it-chips">
              {ideaLinks.map((it) => {
                const found = ideaById.get(it.id)
                const stage = found ? stageOf(found.status) : null
                const inner = (
                  <>
                    {stage && <i className="it-chip-dot" style={{ background: STAGE_COLOR[stage] }} aria-hidden />}
                    <span className="it-chip-x">{it.title}</span>
                    {found && stage && <span className="it-chip-tag">{STAGE_ICON[stage]} {STAGE_LABEL[stage]}{isFocus(found.status) ? ` ${FOCUS_ICON}` : ''}</span>}
                    {it.mentioned && <span className="it-chip-tag">有提到</span>}
                  </>
                )
                return (
                  <li key={it.id}>
                    {onOpenIdea
                      ? <button type="button" className="it-chip" aria-label={`在想法庫開啟：${it.title}`} onClick={() => onOpenIdea(it.id)}>{inner}</button>
                      : <span className="it-chip it-chip-off" aria-label={it.title}>{inner}</span>}
                  </li>
                )
              })}
            </ul>
          </div>
        )}
        {noLinks && <p className="it-dim it-nolinks" data-testid="insight-nolinks">這則還沒連上人、想法或知識</p>}
        <h4 className="it-lb">日記原文</h4>
        {!cur || cur.state === 'loading' ? <p className="it-dim">載入中…</p>
          : cur.state === 'error' ? <p className="it-dim" role="status">原文暫時讀不到，稍後再試。</p>
          : cur.state === 'missing' || !d ? <p className="it-dim">這一則沒有原文資料。</p>
          : <>
            <blockquote className="it-evidence" data-testid="insight-evidence">{d.evidence || '（沒有原文）'}</blockquote>
            {d.source && <div className="it-src">出處：{d.source}</div>}
          </>}
        <h4 className="it-lb">後來怎麼變</h4>
        {items.length <= 1 && <p className="it-dim" data-testid="insight-alone">還沒有後續的印證或修正</p>}
        <ol className="it-thread" data-testid="insight-thread" aria-label="後來怎麼變的時間線">
          {items.map((t) => (
            <li key={t.id} className={t.id === id ? 'it-cur' : undefined} aria-current={t.id === id ? 'true' : undefined}>
              <button type="button" onClick={() => { if (t.id !== id) onSelect(t.id) }}>
                <span className="it-t-d">{t.date}</span>
                <span className={`it-rel it-rel-${t.relation}`}>{RELATION_LABEL[t.relation]}</span>
                <span className="it-t-x">{t.text}</span>
              </button>
            </li>
          ))}
        </ol>
        {topics.length > 0 && (
          <>
            <h4 className="it-lb">相關知識</h4>
            <ul className="it-chips" data-testid="insight-topics">
              {topics.map((t) => (
                <li key={t.id}><a className="it-chip" href={`#knowledge/${encodeURIComponent(t.id)}`} aria-label={`開啟知識頁：${t.name}`}>{t.name}</a></li>
              ))}
            </ul>
          </>
        )}
        {usages.length > 0 && (
          <div className="it-grp" data-testid="insight-usages">
            <h4 className="it-lb">用在</h4>
            <ul className="it-usage">
              {usages.map((u) => (
                <li key={`${u.topicId}:${u.stepNo}`}>
                  <a className="it-usage-link" href={`#knowledge/${encodeURIComponent(u.topicId)}`}>用在：{u.topicName} › 步驟 {u.stepNo} {u.stepTitle}</a>
                </li>
              ))}
            </ul>
          </div>
        )}
        <div className="it-act"><PinButton pw={pw} target={pinTarget} /></div>
      </aside>
      {showDay && date && pw && createPortal(
        <DayReportDialog date={date} password={pw} onClose={closeDay} timelineHref={buildTimelineDayLink(date, `insight/${encodeURIComponent(id)}`)} />,
        document.body,
      )}
    </>
  )
}
