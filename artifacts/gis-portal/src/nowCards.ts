// 首頁「現在用得上」區塊的純邏輯（無 DOM、無網路）：從既有資料組卡片、排序、濾掉回饋過的、時間軌座標。
// 設計見 ~/.claude/pm/runs/now-push/spec.md P3；回饋 API 契約見 docs/push-feedback-api.md。
import type { CompanionData, PersonAction, QuietPerson } from './companion'
import { rotateQuiet, visibleQuietPeople } from './companion'
import type { NudgeMatch, NudgeRecall, TopicNudges } from './topicNudges'

export type CardKind = 'topic' | 'resume' | 'recall' | 'quiet' | 'brief' | 'onthisday'
export type NowDay = 'today' | 'tomorrow'

export interface NowCard {
  key: string
  kind: CardKind
  forDate: string
  /** HH:MM；沒有時間的卡片是 null */
  at: string | null
  /** 為什麼是現在 */
  why: string
  title: string
  /** 說明（每項一行） */
  lines: string[]
  /** topic 的要點 */
  point: string
  /** 排序用：數字越小越前面 */
  rank: number
  /** topic／recall 的知識頁 id */
  topicId?: string
  /** quiet 的人名（動作用；不進 cardKey） */
  person?: string
}

export interface FeedbackState {
  suppressed: string[]
  later: Array<{ cardKey: string; until: string }>
}

export const MAX_CARDS = 5

/** FNV-1a 32 位，轉 36 進位：穩定、不可逆，讓 cardKey 不含任務標題或人名原文 */
export function hash(s: string): string {
  let h = 0x811c9dc5
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return (h >>> 0).toString(36)
}

export function cardKeyOf(c: { kind: 'topic'; topicId: string; matchedBy?: string | null; caseName?: string | null; firstTrigger: string }
  | { kind: 'resume'; caseName: string }
  | { kind: 'recall'; topicId: string }
  | { kind: 'quiet'; name: string }
  | { kind: 'brief'; date: string }
  | { kind: 'onthisday'; date: string; title: string }): string {
  switch (c.kind) {
    case 'topic': return `topic:${c.topicId}:${c.matchedBy || 'terms'}:${c.caseName || hash(c.firstTrigger)}`
    case 'resume': return `resume:${c.caseName}`
    case 'recall': return `recall:${c.topicId}`
    case 'quiet': return `quiet:${hash(c.name)}`
    case 'brief': return `brief:${c.date}`
    case 'onthisday': return `onthisday:${c.date}:${hash(c.title)}`
  }
}

const DAY_MS = 86_400_000
export const addDays = (iso: string, n: number): string => new Date(Date.parse(`${iso}T00:00:00Z`) + n * DAY_MS).toISOString().slice(0, 10)

/** 台北時間 21:00 之後預設開「明天」 */
export function defaultDay(nowMs: number): NowDay {
  const taipeiHour = new Date(nowMs + 8 * 3_600_000).getUTCHours()
  return taipeiHour >= 21 ? 'tomorrow' : 'today'
}

/** HH:MM → 小時（小數）；格式不對回 null */
export function atHours(at: string | null | undefined): number | null {
  const m = /^(\d{1,2}):(\d{2})$/.exec(at ?? '')
  if (!m) return null
  const h = Number(m[1]), mi = Number(m[2])
  if (h > 23 || mi > 59) return null
  return h + mi / 60
}

export const RAIL_START = 8
export const RAIL_END = 22
export const RAIL_TICKS = [8, 10, 12, 14, 16, 18, 20, 22]

/** 08–22 時 → 0～100（%），範圍外夾到兩端；時間不合法回 null */
export function railPos(at: string | number | null | undefined): number | null {
  const h = typeof at === 'number' ? at : atHours(at)
  if (h === null || Number.isNaN(h)) return null
  const c = Math.min(RAIL_END, Math.max(RAIL_START, h))
  return Math.round(((c - RAIL_START) / (RAIL_END - RAIL_START)) * 1000) / 10
}

const RANK = { topicCase: 0, resume: 1, topicTerms: 2, recall: 3, quiet: 4, onthisday: 5, brief: 6 } as const

function topicCard(m: NudgeMatch): NowCard {
  const first = m.triggers[0]?.title ?? ''
  const byCase = m.matchedBy === 'case'
  return {
    key: cardKeyOf({ kind: 'topic', topicId: m.topicId, matchedBy: m.matchedBy, caseName: m.caseName, firstTrigger: first }),
    kind: 'topic', forDate: m.forDate, at: m.at ?? null,
    why: m.why || (first ? `任務「${first}」` : '和你近期的事有關'),
    title: m.name, lines: m.path.length > 0 ? [m.path.join(' › ')] : [], point: m.point ?? '',
    rank: byCase ? RANK.topicCase : RANK.topicTerms, topicId: m.topicId,
  }
}

function recallCard(r: NudgeRecall, today: string): NowCard {
  return {
    key: cardKeyOf({ kind: 'recall', topicId: r.topicId }), kind: 'recall', forDate: today, at: null,
    why: r.reason, title: r.name, lines: r.path.length > 0 ? [r.path.join(' › ')] : [], point: r.point ?? '', rank: RANK.recall, topicId: r.topicId,
  }
}

/** 歷年今天：date 是那件事發生的日期（YYYY-MM-DD），為什麼是現在＝「N 年前的今天」 */
function onThisDayCard(e: { date: string; title: string }, today: string): NowCard {
  const years = Number(today.slice(0, 4)) - Number(e.date.slice(0, 4))
  return {
    key: cardKeyOf({ kind: 'onthisday', date: e.date, title: e.title }), kind: 'onthisday', forDate: today, at: null,
    why: years >= 1 ? `${years} 年前的今天` : '往年的今天', title: e.title, lines: [], point: '', rank: RANK.onthisday,
  }
}

function quietCard(p: QuietPerson, today: string): NowCard {
  return {
    key: cardKeyOf({ kind: 'quiet', name: p.name }), kind: 'quiet', forDate: today, at: null,
    why: p.usualGapDays ? `平常約 ${p.usualGapDays} 天聯絡一次，已 ${p.daysQuiet} 天` : `已 ${p.daysQuiet} 天沒聯絡`,
    title: `很久沒跟 ${p.name} 聯絡了`, lines: [`最後聯絡 ${p.lastDate}`], point: '', rank: RANK.quiet, person: p.name,
  }
}

export interface BuildInput {
  nudges: TopicNudges | null
  companion: CompanionData | null
  /** null＝提醒設定還沒讀到：不推「很久沒聯絡」（免得推到已設為不再提醒的人） */
  personActions: readonly PersonAction[] | null
  /** 明日報告：date＝報告日、summary＝一行摘要；沒有就 null */
  brief: { date: string; summary: string } | null
  day: NowDay
  todayIso: string
}

export function buildCards({ nudges, companion, personActions, brief, day, todayIso }: BuildInput): NowCard[] {
  const date = day === 'today' ? todayIso : addDays(todayIso, 1)
  const out: NowCard[] = []
  for (const m of nudges?.matches ?? []) if (m.forDate === date) out.push(topicCard(m))
  for (const r of nudges?.resumes ?? []) {
    if (r.forDate !== date) continue
    out.push({
      key: cardKeyOf({ kind: 'resume', caseName: r.caseName }), kind: 'resume', forDate: date, at: r.at ?? null,
      why: r.why, title: r.caseName, lines: (r.events ?? []).slice(0, 3).map((e) => `${e.date.slice(5).replace('-', '/')} ${e.title}`), point: '', rank: RANK.resume,
    })
  }
  if (day === 'today') {
    for (const r of nudges?.recall ?? []) out.push(recallCard(r, todayIso))
    if (companion && personActions) {
      for (const p of rotateQuiet(visibleQuietPeople(companion.quietPeople, personActions, todayIso), todayIso)) out.push(quietCard(p, todayIso))
    }
    if (companion) {
      const seen = new Set<string>()
      for (const e of companion.onThisDay ?? []) {
        if (!e || typeof e.date !== 'string' || typeof e.title !== 'string') continue
        const c = onThisDayCard(e, todayIso)
        if (seen.has(c.key)) continue
        seen.add(c.key)
        out.push(c)
      }
    }
  } else if (brief) {
    out.push({
      key: cardKeyOf({ kind: 'brief', date: brief.date }), kind: 'brief', forDate: brief.date, at: null,
      why: '每晚 21:00 整理', title: '明日報告', lines: brief.summary ? [brief.summary] : [], point: '', rank: RANK.brief,
    })
  }
  return sortCards(out)
}

/** 有時間的依時間先（同時間看 rank），其餘依 rank（同 rank 保持原順序） */
export function sortCards(cards: readonly NowCard[]): NowCard[] {
  const idx = new Map(cards.map((c, i) => [c, i]))
  return [...cards].sort((a, b) => {
    const ha = atHours(a.at), hb = atHours(b.at)
    if (ha !== null && hb !== null) return ha - hb || a.rank - b.rank || idx.get(a)! - idx.get(b)!
    if (ha !== null) return -1
    if (hb !== null) return 1
    return a.rank - b.rank || idx.get(a)! - idx.get(b)!
  })
}

/** 歷年今天最多留 1 張 */
export const MAX_ONTHISDAY = 1

/** 濾掉 suppressed、尚未到期的 later、本機暫存的「沒用」，歷年今天最多留 1 張，再取前 MAX_CARDS 則 */
export function visibleCards(cards: readonly NowCard[], feedback: FeedbackState | null, nowMs: number, pendingUseless: readonly string[] = []): NowCard[] {
  const gone = new Set([...(feedback?.suppressed ?? []), ...pendingUseless])
  const later = new Map((feedback?.later ?? []).map((l) => [l.cardKey, Date.parse(l.until)]))
  let onThisDay = 0
  return cards.filter((c) => {
    if (gone.has(c.key)) return false
    const until = later.get(c.key)
    if (until !== undefined && !Number.isNaN(until) && nowMs < until) return false
    if (c.kind === 'onthisday' && ++onThisDay > MAX_ONTHISDAY) return false
    return true
  }).slice(0, MAX_CARDS)
}

/** 標題列右側的「NN / 05」 */
export const countLabel = (n: number): string => `${String(n).padStart(2, '0')} / ${String(MAX_CARDS).padStart(2, '0')}`

/** 一個資料來源「已結束」：成功（含 404 回 null）或失敗都算；還在等才是 false */
export const settled = (s: { loadedAt: number | null; error: boolean }): boolean => s.loadedAt !== null || s.error

/** 四個來源（topic-nudges、companion、person-actions、push feedback）都結束了才能渲染卡片與送 shown；失敗當空 */
export const nowReady = (parts: ReadonlyArray<{ loadedAt: number | null; error: boolean }>): boolean => parts.every(settled)

/** 補送完畢後仍要留在 pending 的鍵：只有 POST 成功的才移除 */
export function remainingPending<T extends { cardKey: string; forDate: string }>(pending: readonly T[], okKeys: ReadonlySet<string>): T[] {
  return pending.filter((p) => !okKeys.has(`${p.cardKey}|${p.forDate}`))
}
