// 首頁「現在用得上」（3.23.0）：兩種新推播卡——想法快過期（ideaAge）、旅遊新鮮度倒數（travelFresh）。
// 純函式，不碰 DOM、不發網路；資料沒到或讀失敗時回 null，卡片就不出現。
import { RANK, cardKeyOf, type NowCard } from './nowCards'

/** 想法年齡的候選狀態：還沒實行、也還沒結束的 */
const IDEA_STATUSES = ['new', 'evaluating'] as const
/** 產生滿 28 天還沒實行就不再計分 */
export const IDEA_EXPIRE_DAYS = 28
/** 21 天起提醒（還剩 7 天以內） */
export const IDEA_WARN_FROM_DAYS = 21
const IDEA_MAX = 3

/** 旅遊：距上次旅行 21 天起倒數，往前看 14 天後的分數 */
export const TRAVEL_WARN_FROM_DAYS = 21
export const TRAVEL_LOOKAHEAD_DAYS = 14

export interface IdeaForAge {
  id: string
  title: string
  status: string
  /** YYYY-MM-DD（或帶時間的 ISO 字串） */
  bornAt: string
  backfill: boolean
}

export interface TravelForFresh {
  daysSinceLastTrip: number | null
  hasUpcomingTrip: boolean
  travelScore: number | null
  recencyScore: number | null
  frequencyScore: number | null
  foodScore: number | null
}

export interface PlaceForFresh {
  id: string
  name: string
  area: string | null
  status: string
  addedAt: string
}

const DAY_MS = 86_400_000

/** 四捨五入（後端 roundHalfUp 的非負版）；recency／總分都是非負 */
const roundHalf = (x: number): number => Math.floor(x + 0.5)

/** ISO 8601 週次（週一起算），例如 2026-11-22 → 2026-W47 */
export function isoWeek(iso: string): string {
  const d = new Date(Date.parse(`${iso.slice(0, 10)}T00:00:00Z`))
  const day = (d.getUTCDay() + 6) % 7 // 週一＝0
  d.setUTCDate(d.getUTCDate() - day + 3) // 移到這一週的週四
  const year = d.getUTCFullYear()
  const jan4 = new Date(Date.UTC(year, 0, 4))
  const jan4Day = (jan4.getUTCDay() + 6) % 7
  const firstThursday = new Date(jan4.getTime() + (3 - jan4Day) * DAY_MS)
  const week = 1 + Math.round((d.getTime() - firstThursday.getTime()) / (7 * DAY_MS))
  return `${year}-W${String(week).padStart(2, '0')}`
}

/** 相距幾天（今天 − 日期）；日期壞掉回 null */
function ageDays(today: string, iso: string): number | null {
  const t = Date.parse(`${today.slice(0, 10)}T00:00:00Z`)
  const b = Date.parse(`${iso.slice(0, 10)}T00:00:00Z`)
  if (!Number.isFinite(t) || !Number.isFinite(b)) return null
  return Math.round((t - b) / DAY_MS)
}

/** 想法快過期卡：21 ≤ 年齡 < 28 的未實行想法，依 bornAt 由舊到新最多 3 個；沒有回 null */
export function ideaAgeCard({ ideas, today }: { ideas: readonly IdeaForAge[] | null; today: string }): NowCard | null {
  if (!ideas) return null
  const picked: Array<{ idea: IdeaForAge; age: number }> = []
  for (const idea of ideas) {
    if (idea.backfill) continue
    if (!(IDEA_STATUSES as readonly string[]).includes(idea.status)) continue
    const age = ageDays(today, idea.bornAt)
    if (age === null || age < IDEA_WARN_FROM_DAYS || age >= IDEA_EXPIRE_DAYS) continue
    picked.push({ idea, age })
  }
  if (picked.length === 0) return null
  picked.sort((a, b) => a.idea.bornAt.localeCompare(b.idea.bornAt) || a.idea.id.localeCompare(b.idea.id))
  const top = picked.slice(0, IDEA_MAX)
  return {
    key: cardKeyOf({ kind: 'ideaAge', week: isoWeek(today) }),
    kind: 'ideaAge', forDate: today, at: null,
    why: '產生滿 28 天還沒實行就不再計分',
    title: `${top.length} 個想法快過期`,
    lines: top.map(({ idea, age }) => `${idea.title}（還剩 ${IDEA_EXPIRE_DAYS - age} 天）`),
    point: '',
    rank: RANK.ideaAge,
    href: '#ideas',
  }
}

/** 天數 → recency 子分數（3 天內＝100，線性遞減，約 93 天＝0）；與後端 travelScore.ts 一致 */
export function recencyFor(days: number): number {
  if (days <= 3) return 100
  return Math.max(0, roundHalf(100 - (days - 3) * (100 / 90)))
}

/** 總分：有美食分數時 0.4／0.4／0.2，沒有時 0.5／0.5；期待加分先當 0 */
function totalScore(recency: number, frequency: number, food: number | null): number {
  const mixed = food === null ? 0.5 * recency + 0.5 * frequency : 0.4 * recency + 0.4 * frequency + 0.2 * food
  return Math.min(100, Math.max(0, roundHalf(mixed)))
}

/** 旅遊新鮮度倒數卡：距上次旅行 ≥ 21 天、沒有已排定行程時，算 14 天後的總分；資料不足回 null */
export function travelFreshCard({ travel, places, today }: {
  travel: TravelForFresh | null
  places: readonly PlaceForFresh[] | null
  today: string
}): NowCard | null {
  if (!travel || travel.hasUpcomingTrip) return null
  const days = travel.daysSinceLastTrip
  if (days === null || days < TRAVEL_WARN_FROM_DAYS) return null
  // 頻率不變是規格前提；讀不到頻率就算不出總分，卡片先不出現
  if (travel.frequencyScore === null) return null

  const food = travel.foodScore
  const currentRecency = travel.recencyScore ?? recencyFor(days)
  const current = travel.travelScore !== null ? Math.round(travel.travelScore) : totalScore(currentRecency, travel.frequencyScore, food)
  const after = totalScore(recencyFor(days + TRAVEL_LOOKAHEAD_DAYS), travel.frequencyScore, food)

  const lines: string[] = []
  const want = (places ?? []).filter((p) => p.status === 'want')
  if (want.length > 0) {
    const oldest = [...want].sort((a, b) => a.addedAt.localeCompare(b.addedAt) || a.id.localeCompare(b.id))[0]!
    lines.push(oldest.area ? `去 ${oldest.name}（${oldest.area}）？` : `去 ${oldest.name}？`)
  }

  return {
    key: cardKeyOf({ kind: 'travelFresh', week: isoWeek(today) }),
    kind: 'travelFresh', forDate: today, at: null,
    why: `距上次旅行 ${days} 天`,
    title: `再 ${TRAVEL_LOOKAHEAD_DAYS} 天沒出門，旅遊分數約 ${current} → ${after}`,
    lines,
    point: '',
    rank: RANK.travelFresh,
    href: '#food',
  }
}
