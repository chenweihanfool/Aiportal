// 首頁「陪伴」區塊與今日最划算的一件事：純函式（網路只有 apiFetchCompanion）。
// 使用者 2026-10-30：「其他建議 … 2-5照你建議做」（很久沒聯絡、今日最划算的一件事、什麼事讓你變好、歷年今天）。
// 資料來自 feed companion（kb-pipeline companion-pusher.py），不新增模型呼叫，也不要使用者手動輸入。
import { biggestDrag, type HhiRow } from './boardView'
import type { HhiHistoryPoint } from './boardApi'
import type { DailyLife } from './milestones'

const API_BASE = import.meta.env.BASE_URL ?? '/'

export interface CompanionData {
  computedAt: string
  date: string
  onThisDay: Array<{ date: string; kind: 'event' | 'report'; title: string }>
  quietPeople: QuietPerson[]
  socialDays: SocialDay[]
}

export interface QuietPerson {
  name: string; lastDate: string; daysQuiet: number; events: number; lastEvent?: string | null
  /** 平常大約每幾天聯絡一次（推送端算；沒有就不顯示） */
  usualGapDays?: number | null
  /** 超過平常間隔的倍數（推送端算） */
  overdue?: number
}

export interface SocialDay {
  date: string
  people: number
  /** 當天互動的人名（推送端 2026-11 起提供） */
  names?: string[]
  types?: { face_to_face: number; call: number; text: number }
}

export function parseCompanion(raw: unknown): CompanionData | null {
  const root = raw as { available?: boolean; payload?: unknown } | null
  if (!root || root.available !== true) return null
  const p = root.payload as Partial<CompanionData> | null
  if (!p || typeof p.computedAt !== 'string' || !Array.isArray(p.onThisDay) || !Array.isArray(p.quietPeople) || !Array.isArray(p.socialDays)) return null
  return p as CompanionData
}

/** 還沒部署（feed 不存在／沒資料）回 null；連不上丟錯 */
export async function apiFetchCompanion(pw: string): Promise<CompanionData | null> {
  const r = await fetch(`${API_BASE}api/feed/companion`, { headers: { 'x-admin-password': pw } })
  if (r.status === 404) return null
  if (!r.ok) throw new Error('Failed to fetch companion')
  return parseCompanion(await r.json())
}

const MOVES: Record<string, string> = {
  fitness: '今天動一下，排一次訓練',
  calm: '清掉一件逾期或快到期的任務',
  mind: '把一個想法往前推一步，或記下一個新想法',
  social: '約家人或朋友見個面、打通電話',
  travel: '排一趟小旅行，或去吃一家想吃的店',
}

/** 今日最划算的一件事：挑補起來對總分幫助最大的面向；社交優先點名最久沒聯絡的人。財務主要看市場、權重又最大，留著會天天推它，不列入 */
/** actions／today 有給時，先濾掉「已聯絡／暫緩／不再提醒」的人（例如已故的人不會被建議聯絡） */
export function bestMove(rows: HhiRow[], c: CompanionData | null, actions: readonly PersonAction[] = [], today = ''): string | null {
  const r = biggestDrag(rows.filter((x) => x.key in MOVES))
  if (!r || r.value === null) return null
  const gain = ((10 * r.weightPct) / 100).toFixed(1)
  const who = r.key === 'social' && c ? (today ? visibleQuietPeople(c.quietPeople, actions, today) : c.quietPeople)[0] : undefined
  const act = who ? `聯絡一下${who.name}（${who.daysQuiet} 天沒聯絡了）` : MOVES[r.key]
  return act ? `今天最划算：${act}。「${r.label}」每多 10 分，總分約加 ${gain} 分。` : null
}

// ── 人物提醒動作（入口網自己的狀態：已聯絡／暫緩／不再提醒） ──
export type PersonActionKind = 'contacted' | 'snooze' | 'never'
export interface PersonAction { name: string; action: PersonActionKind; until: string | null; reason: string | null; updatedAt: string }
export interface PersonActionBody { action: PersonActionKind; until?: string; reason?: string }

const DAY_MS = 86_400_000
/** YYYY-MM-DD 距 1970-01-01 的天數 */
export const epochDay = (d: string): number => Math.floor(Date.parse(`${d.slice(0, 10)}T00:00:00Z`) / DAY_MS)
/** 時間戳記的台北日期 YYYY-MM-DD */
export function taipeiDateOf(iso: string): string {
  const t = Date.parse(iso)
  if (Number.isNaN(t)) return iso.slice(0, 10)
  return new Date(t + 8 * 3_600_000).toISOString().slice(0, 10)
}

/**
 * 該顯示的「很久沒聯絡」：never 移除；snooze 到期日（含）前移除；
 * contacted 只有在那之後又有新互動（lastDate 晚於動作日）或已過 30 天才再出現。保持原順序。
 */
export function visibleQuietPeople(people: readonly QuietPerson[], actions: readonly PersonAction[], today: string): QuietPerson[] {
  const byName = new Map(actions.map((a) => [a.name, a]))
  return people.filter((p) => {
    const a = byName.get(p.name)
    if (!a) return true
    if (a.action === 'never') return false
    if (a.action === 'snooze') return !(a.until !== null && a.until >= today)
    const acted = taipeiDateOf(a.updatedAt)
    return p.lastDate > acted || epochDay(today) - epochDay(acted) >= 30
  })
}

/** 每天輪替：取前 9 人分成每 n 人一組，組號＝今天距 1970-01-01 的天數 % 組數；不足 n 人回全部 */
export function rotateQuiet<T>(list: readonly T[], today: string, n = 3): T[] {
  const top = list.slice(0, n * 3)
  if (top.length <= n) return top
  const groups = Math.ceil(top.length / n)
  const g = epochDay(today) % groups
  return top.slice(g * n, g * n + n)
}

export async function apiFetchPersonActions(pw: string): Promise<PersonAction[]> {
  const r = await fetch(`${API_BASE}api/companion/person-actions`, { headers: { 'x-admin-password': pw } })
  if (r.status === 404) return []
  if (!r.ok) throw new Error('Failed to fetch person actions')
  const j = (await r.json()) as { actions?: PersonAction[] }
  return Array.isArray(j.actions) ? j.actions : []
}

export async function apiPutPersonAction(pw: string, name: string, body: PersonActionBody): Promise<void> {
  const r = await fetch(`${API_BASE}api/companion/person-actions/${encodeURIComponent(name)}`, {
    method: 'PUT', headers: { 'x-admin-password': pw, 'content-type': 'application/json' }, body: JSON.stringify(body),
  })
  if (!r.ok) throw new Error('Failed to save person action')
}

export async function apiDeletePersonAction(pw: string, name: string): Promise<void> {
  const r = await fetch(`${API_BASE}api/companion/person-actions/${encodeURIComponent(name)}`, { method: 'DELETE', headers: { 'x-admin-password': pw } })
  if (!r.ok && r.status !== 204) throw new Error('Failed to delete person action')
}

// ── 什麼事讓你變好 ──
export const MIN_INSIGHT_DAYS = 5

export interface ActivityInsight { ready: boolean; lines: string[]; pending: string }

const nextDay = (d: string) => new Date(Date.parse(`${d}T12:00:00Z`) + DAY_MS).toISOString().slice(0, 10)

const INSIGHT_KEYS: Array<{ key: string; label: string; has: (l: DailyLife[string]) => boolean }> = [
  { key: 'social', label: '見人', has: (l) => l.socialPeople > 0 },
  { key: 'places', label: '新店', has: (l) => l.newPlaces.length > 0 },
  { key: 'trip', label: '旅行', has: (l) => l.trip !== null },
  { key: 'workout', label: '運動', has: (l) => l.workouts.length > 0 },
]

/**
 * 什麼事讓你變好：見人／新店／旅行／運動四項，有做的日子 vs 沒做的日子，隔天幸福指數平均差多少。
 * 只比 SCALE_SINCE 之後、且隔天也有分數的日子；每項有／沒有兩邊各滿 MIN_INSIGHT_DAYS 天才成立。
 * lines＝成立的項目依 |差| 降冪前 3 項；pending＝還沒成立項目的進度（以兩邊較少的那邊計）。
 */
export function activityInsight(history: readonly HhiHistoryPoint[], life: DailyLife | null): ActivityInsight {
  if (!life) return { ready: false, lines: [], pending: '資料累積中。' }
  const score = new Map(history.filter((h) => h.date >= SCALE_SINCE).map((h) => [h.date.slice(0, 10), h.displayedScore]))
  const avg = (xs: number[]) => xs.reduce((s, x) => s + x, 0) / xs.length
  const done: Array<{ label: string; diff: number }> = []
  const waiting: string[] = []
  for (const k of INSIGHT_KEYS) {
    const yes: number[] = []
    const no: number[] = []
    for (const [d, v] of score) {
      const next = score.get(nextDay(d))
      if (next === undefined) continue
      const l = life[d]
      ;(l && k.has(l) ? yes : no).push(next - v)
    }
    if (yes.length >= MIN_INSIGHT_DAYS && no.length >= MIN_INSIGHT_DAYS) done.push({ label: k.label, diff: avg(yes) - avg(no) })
    else waiting.push(`${k.label} ${Math.min(yes.length, no.length)}／${MIN_INSIGHT_DAYS}`)
  }
  done.sort((a, b) => Math.abs(b.diff) - Math.abs(a.diff))
  const lines = done.slice(0, 3).map(({ label, diff }) => {
    if (Math.abs(diff) < 0.5) return `${label}的日子，隔天幸福指數和平常差不多`
    return `${label}的日子，隔天幸福指數${diff > 0 ? '多' : '少'} ${Math.round(Math.abs(diff) * 10) / 10} 分`
  })
  return { ready: lines.length > 0, lines, pending: waiting.length > 0 ? `累積中：${waiting.join('、')}` : '' }
}

/** 幸福指數換成絕對分的第一天（之前的分數是另一把尺） */
export const SCALE_SINCE = '2026-10-30'
