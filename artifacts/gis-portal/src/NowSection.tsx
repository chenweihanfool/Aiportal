import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { apiPutPersonAction, type PersonAction, type CompanionData, type PersonActionBody } from './companion'
import { useAsync } from './homeHooks'
import { apiFetchFeedback, apiPostFeedback, type FeedbackAction, type FeedbackBody } from './nowCardsApi'
import {
  RAIL_TICKS, addDays, atHours, buildCards, countLabel, defaultDay, railPos, visibleCards, type FeedbackState, type NowCard, type NowDay,
} from './nowCards'
import { knowledgeHref, type TopicNudges } from './topicNudges'

// 首頁「現在用得上」（2.87.0）：搜尋區正下方的時間軌＋最多 5 張推送卡，每張說得出「為什麼是現在」。
// 純邏輯在 nowCards.ts；樣式 nw- 前綴在 portal.css，顏色變數只定義在 .nw-root。

const PENDING_KEY = 'nw-pending-useless'
const LATER_FOREVER = '9999-12-31T00:00:00Z'
const NO_FEEDBACK: FeedbackState = { suppressed: [], later: [] }

type Pending = Array<Pick<FeedbackBody, 'cardKey' | 'cardKind' | 'forDate'>>

function readPending(): Pending {
  try {
    const raw = window.localStorage.getItem(PENDING_KEY)
    const v = raw ? (JSON.parse(raw) as unknown) : []
    return Array.isArray(v) ? v.filter((x): x is Pending[number] => !!x && typeof x.cardKey === 'string' && typeof x.cardKind === 'string' && typeof x.forDate === 'string') : []
  } catch { return [] }
}
function writePending(list: Pending): void {
  try {
    if (list.length === 0) window.localStorage.removeItem(PENDING_KEY)
    else window.localStorage.setItem(PENDING_KEY, JSON.stringify(list))
  } catch { /* 存不了就算了 */ }
}

const reducedMotion = () => typeof window !== 'undefined' && !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches

export function NowSection({ pw, nowMs, todayIso, nudges, companion, personActions, briefInfo, onActionsChange }: {
  /** null＝未解鎖：整個區塊不顯示 */
  pw: string | null
  nowMs: number
  todayIso: string
  nudges: TopicNudges | null
  companion: CompanionData | null
  /** null＝提醒設定還沒讀到 */
  personActions: PersonAction[] | null
  /** 明日報告：date＝報告日、summary＝一行摘要；沒有就 null */
  briefInfo: { date: string; summary: string } | null
  /** 很久沒聯絡的動作寫入成功後，通知上層重新讀取陪伴資料 */
  onActionsChange: () => void
}) {
  const [day, setDay] = useState<NowDay>(() => defaultDay(nowMs))
  const feedback = useAsync(pw, apiFetchFeedback)
  const [localSuppressed, setLocalSuppressed] = useState<string[]>([])
  const [localLater, setLocalLater] = useState<string[]>([])
  const [pending, setPending] = useState<Pending>(() => readPending())
  const [gone, setGone] = useState<string[]>([])
  const [hot, setHot] = useState<string | null>(null)
  const [toast, setToast] = useState('')
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const shownSent = useRef<Set<string>>(new Set())
  const cardEls = useRef<Map<string, HTMLElement>>(new Map())

  const say = useCallback((m: string) => {
    setToast(m)
    if (toastTimer.current) clearTimeout(toastTimer.current)
    toastTimer.current = setTimeout(() => setToast(''), 2400)
  }, [])
  useEffect(() => () => { if (toastTimer.current) clearTimeout(toastTimer.current) }, [])

  // 上次送失敗的「沒用」：載入時先重送，成功才刪
  useEffect(() => {
    if (!pw) return
    const list = readPending()
    if (list.length === 0) return
    let cancelled = false
    void (async () => {
      for (const p of list) {
        try {
          await apiPostFeedback(pw, { ...p, action: 'useless' })
          const left = readPending().filter((x) => !(x.cardKey === p.cardKey && x.forDate === p.forDate))
          writePending(left)
          if (!cancelled) setPending(left)
        } catch { /* 留著，下次再送 */ }
      }
    })()
    return () => { cancelled = true }
  }, [pw])

  const brief = day === 'tomorrow' ? briefInfo : null
  const all = useMemo(
    () => buildCards({ nudges, companion, personActions, brief, day, todayIso }),
    [nudges, companion, personActions, brief, day, todayIso],
  )
  const fb: FeedbackState = useMemo(() => {
    const server = feedback.data ?? NO_FEEDBACK
    return {
      suppressed: [...server.suppressed, ...localSuppressed],
      later: [...server.later, ...localLater.map((cardKey) => ({ cardKey, until: LATER_FOREVER }))],
    }
  }, [feedback.data, localSuppressed, localLater])
  const cards = useMemo(() => visibleCards(all, fb, nowMs, pending.map((p) => p.cardKey)), [all, fb, nowMs, pending])

  const send = useCallback((card: NowCard, action: FeedbackAction) => {
    if (!pw) return
    apiPostFeedback(pw, { cardKey: card.key, cardKind: card.kind, action, forDate: card.forDate }).catch(() => {
      if (action !== 'useless') return
      const next = [...readPending().filter((x) => !(x.cardKey === card.key && x.forDate === card.forDate)), { cardKey: card.key, cardKind: card.kind, forDate: card.forDate }]
      writePending(next)
      setPending(next)
    })
  }, [pw])

  const onShown = useCallback((card: NowCard) => {
    const k = `${card.key}|${card.forDate}`
    if (shownSent.current.has(k)) return
    shownSent.current.add(k)
    send(card, 'shown')
  }, [send])

  const leave = (card: NowCard, then: () => void) => {
    setGone((g) => [...g, card.key])
    window.setTimeout(() => { then(); setGone((g) => g.filter((x) => x !== card.key)) }, reducedMotion() ? 0 : 320)
  }
  const useful = (card: NowCard) => { send(card, 'useful'); say('記下了：這個時機、這一頁，對你有用') }
  const later = (card: NowCard) => { send(card, 'later'); say('20:00 再提醒一次'); leave(card, () => setLocalLater((l) => [...l, card.key])) }
  const useless = (card: NowCard) => {
    send(card, 'useless'); say('不再因為這個原因推這一頁')
    leave(card, () => setLocalSuppressed((l) => [...l, card.key]))
  }

  const scrollToCard = (key: string) => {
    cardEls.current.get(key)?.scrollIntoView({ block: 'center', behavior: reducedMotion() ? 'auto' : 'smooth' })
  }

  const quietAct = async (card: NowCard, body: PersonActionBody) => {
    if (!pw || !card.person) return
    try {
      await apiPutPersonAction(pw, card.person, body)
      setLocalSuppressed((l) => [...l, card.key])
      onActionsChange()
    } catch { say('儲存失敗，請稍後再試。') }
  }
  const snooze = (card: NowCard) => quietAct(card, { action: 'snooze', until: addDays(todayIso, 30) })
  const never = (card: NowCard) => {
    if (!window.confirm(`以後不再提醒你聯絡「${card.person}」？之後可以在陪伴區塊還原。`)) return
    return quietAct(card, { action: 'never' })
  }

  if (!pw) return null

  const nowHour = day === 'today' ? ((nowMs + 8 * 3_600_000) % 86_400_000) / 3_600_000 : null
  const timed = cards.filter((c) => atHours(c.at) !== null)
  const emptyText = day === 'today' ? '今天沒有需要推給你的。' : '明天沒有需要推給你的。'

  return (
    <section className="nw-root" aria-labelledby="nw-h" data-testid="now-section">
      <div className="nw-head">
        <h2 id="nw-h" className="nw-title">現在用得上</h2>
        <span className="nw-lb" data-testid="now-count">{countLabel(cards.length)}</span>
        <div className="nw-seg" role="group" aria-label="切換今天或明天">
          <button type="button" className={day === 'today' ? 'nw-on' : ''} aria-pressed={day === 'today'} onClick={() => setDay('today')}>今天</button>
          <button type="button" className={day === 'tomorrow' ? 'nw-on' : ''} aria-pressed={day === 'tomorrow'} onClick={() => setDay('tomorrow')}>明天</button>
        </div>
      </div>

      {timed.length > 0 && (
        <div className="nw-rail" data-testid="now-rail" role="group" aria-label="時間軌">
          <div className="nw-bar" />
          {RAIL_TICKS.map((h, i) => (
            <span key={h} className="nw-tick" data-alt={i % 2 === 1 ? '1' : undefined} style={{ left: `${railPos(h)}%` }} aria-hidden>{String(h).padStart(2, '0')}</span>
          ))}
          {nowHour !== null && <div className="nw-now" style={{ left: `${railPos(nowHour)}%` }} data-testid="now-marker" aria-hidden />}
          {timed.map((c) => (
            <button key={c.key} type="button" className={`nw-pt${c.rank <= 1 || c.kind === 'quiet' ? ' nw-w' : ''}${nowHour !== null && (atHours(c.at) ?? 0) < nowHour ? ' nw-past' : ''}${hot === c.key ? ' nw-hot' : ''}`}
              style={{ left: `${railPos(c.at)}%` }} title={`${c.at} ${c.why}`} aria-label={`${c.at}　${c.title}，捲到這張卡`}
              onMouseEnter={() => setHot(c.key)} onMouseLeave={() => setHot(null)} onFocus={() => setHot(c.key)} onBlur={() => setHot(null)}
              onClick={() => scrollToCard(c.key)} />
          ))}
        </div>
      )}

      {cards.length === 0 ? <p className="nw-empty" data-testid="now-empty">{emptyText}</p> : (
        <div className="nw-list">
          {cards.map((c) => (
            <NowCardView key={c.key} card={c} hot={hot === c.key} gone={gone.includes(c.key)} setRef={(el) => { if (el) cardEls.current.set(c.key, el); else cardEls.current.delete(c.key) }}
              onHot={(on) => setHot(on ? c.key : null)} onShown={onShown}
              onOpened={() => send(c, 'opened')} onUseful={() => useful(c)} onLater={() => later(c)} onUseless={() => useless(c)}
              onContacted={() => void quietAct(c, { action: 'contacted' })} onSnooze={() => void snooze(c)} onNever={() => void never(c)} />
          ))}
        </div>
      )}
      <div className="nw-toast" role="status" aria-live="polite">{toast}</div>
    </section>
  )
}

function NowCardView({ card, hot, gone, setRef, onHot, onShown, onOpened, onUseful, onLater, onUseless, onContacted, onSnooze, onNever }: {
  card: NowCard
  hot: boolean
  gone: boolean
  setRef: (el: HTMLElement | null) => void
  onHot: (on: boolean) => void
  onShown: (c: NowCard) => void
  onOpened: () => void
  onUseful: () => void
  onLater: () => void
  onUseless: () => void
  onContacted: () => void
  onSnooze: () => void
  onNever: () => void
}) {
  const ref = useRef<HTMLElement | null>(null)
  useEffect(() => {
    const el = ref.current
    if (!el || typeof IntersectionObserver === 'undefined') return
    const io = new IntersectionObserver((entries) => {
      if (entries.some((e) => e.isIntersecting && e.intersectionRatio >= 0.5)) { onShown(card); io.disconnect() }
    }, { threshold: [0.5] })
    io.observe(el)
    return () => io.disconnect()
  }, [card, onShown])

  const warn = card.rank <= 1 || card.kind === 'quiet'
  const scrollToBrief = () => {
    onOpened()
    document.getElementById('sec-brief')?.scrollIntoView({ block: 'start', behavior: reducedMotion() ? 'auto' : 'smooth' })
  }
  return (
    <article ref={(el) => { ref.current = el; setRef(el) }} className={`nw-card${hot ? ' nw-hot' : ''}${gone ? ' nw-gone' : ''}`} data-kind={card.kind} data-testid="now-card"
      onMouseEnter={() => onHot(true)} onMouseLeave={() => onHot(false)} onFocus={() => onHot(true)} onBlur={() => onHot(false)}>
      <div className={`nw-why${warn ? ' nw-w' : ''}`} title={card.why}>{card.why}</div>
      <h3 className="nw-h3">{card.title}</h3>
      {card.lines.length > 0 && (
        <p className="nw-p">{card.lines.map((l, i) => <span key={i} className="nw-line">{l}</span>)}</p>
      )}
      {card.point && <div className="nw-point">{card.point}</div>}
      <div className="nw-act">
        {card.kind === 'topic' || card.kind === 'recall' ? (
          <a className="nw-cta" href={knowledgeHref(card.topicId ?? '')} onClick={onOpened}>看這一頁</a>
        ) : card.kind === 'resume' ? (
          <a className="nw-cta" href="#relations" onClick={onOpened}>看關係</a>
        ) : card.kind === 'brief' ? (
          <button type="button" className="nw-cta" onClick={scrollToBrief}>看全文</button>
        ) : (
          <>
            <button type="button" className="nw-cta" onClick={onContacted} aria-label={`已聯絡：${card.person}`}>已聯絡</button>
            <button type="button" className="nw-gh" onClick={onSnooze} aria-label={`暫緩 30 天：${card.person}`}>暫緩 30 天</button>
            <button type="button" className="nw-gh" onClick={onNever} aria-label={`不再提醒：${card.person}`}>不再提醒</button>
          </>
        )}
        <button type="button" className="nw-gh" onClick={onUseful} aria-label={`有用：${card.title}`}>有用</button>
        <span className="nw-sp" />
        <button type="button" className="nw-gh" onClick={onLater} aria-label={`晚點：${card.title}`}>晚點</button>
        <button type="button" className="nw-gh" onClick={onUseless} aria-label={`沒用：${card.title}`}>沒用</button>
      </div>
    </article>
  )
}
