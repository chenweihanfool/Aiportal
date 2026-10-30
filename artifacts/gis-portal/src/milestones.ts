// 日／週／月／季／年報的 🏁 里程碑卡：用「做了幾件事」取代 AI 打的每日分數走勢。純函式，不碰 DOM（網路只有 apiFetchTasksDone）。
// 使用者 2026-10-25：「日報的14天走勢用AI打的分數沒什麼意義 能否改成里程碑設計 內容幫我設計 例如當日完成任務數 + 新增想法數 + 想法完成數」
// 「把里程碑設計擴大到 周 月 季 年報 同時顧及視覺化呈現」。設計：docs/milestones.md。
//   成果＝完成任務（feed tasks-done）＋ 新想法（想法庫 bornAt）＋ 想法實行（想法庫 history 第一次 done），三項各算 1，不加權。
// 使用者 2026-10-30：「日報也想照同樣方式看到具體案件」→ 每天另記標題（items），卡片與柱子的提示窗逐條列出。
import type { IdeaItem } from './boardApi'
import { tipText } from './reportsView'
import { eachDay, prevRange, type Range } from './periodStats'

const API_BASE = import.meta.env.BASE_URL ?? '/'

export type MsLevel = 'day' | 'week' | 'month' | 'quarter' | 'year'
export type PartKey = 'tasks' | 'ideasNew' | 'ideasDone'
export const PARTS: ReadonlyArray<{ key: PartKey; icon: string; label: string; unit: string }> = [
  { key: 'tasks', icon: '✅', label: '完成任務', unit: '項' },
  { key: 'ideasNew', icon: '💡', label: '新想法', unit: '個' },
  { key: 'ideasDone', icon: '🚀', label: '想法實行', unit: '個' },
]
/** 走勢要畫幾期（含本期） */
export const TREND_N: Record<MsLevel, number> = { day: 14, week: 12, month: 12, quarter: 8, year: 5 }
export const UNIT_WORD: Record<MsLevel, string> = { day: '天', week: '週', month: '個月', quarter: '季', year: '年' }
/** 年度累計的關卡（三項共用） */
export const LADDER = [1, 5, 10, 25, 50, 100, 150, 200, 300, 500, 750, 1000, 1500, 2000, 3000, 5000, 10000] as const

// ── 資料：每天完成幾項任務（feed tasks-done v1，推送端 kb-pipeline vikunja-gantt-pusher.py） ──
/** titlesByDate：推送端 2026-10-30 起才帶（只有近期的日子），沒有的日子提示窗只寫數量 */
export interface TasksDone { since: string | null; byDate: Record<string, number>; titlesByDate?: Record<string, string[]>; computedAt: string }

const DATE = /^\d{4}-\d{2}-\d{2}$/
export function parseTasksDone(raw: unknown): TasksDone | null {
  const root = raw as { available?: boolean; payload?: unknown } | null
  if (!root || root.available !== true) return null
  const p = root.payload as { computedAt?: unknown; since?: unknown; days?: unknown } | null
  if (!p || typeof p.computedAt !== 'string' || !Array.isArray(p.days)) return null
  const byDate: Record<string, number> = {}
  const titlesByDate: Record<string, string[]> = {}
  for (const d of p.days as Array<{ date?: unknown; count?: unknown; titles?: unknown }>) {
    if (d && typeof d.date === 'string' && DATE.test(d.date) && typeof d.count === 'number' && d.count > 0) {
      byDate[d.date] = d.count
      if (Array.isArray(d.titles)) titlesByDate[d.date] = d.titles.filter((t): t is string => typeof t === 'string')
    }
  }
  const out: TasksDone = { since: typeof p.since === 'string' && DATE.test(p.since) ? p.since : null, byDate, computedAt: p.computedAt }
  if (Object.keys(titlesByDate).length > 0) out.titlesByDate = titlesByDate
  return out
}

/** 還沒部署（feed 不存在／沒資料）回 null；連不上丟錯 */
export async function apiFetchTasksDone(pw: string): Promise<TasksDone | null> {
  const r = await fetch(`${API_BASE}api/feed/tasks-done`, { headers: { 'x-admin-password': pw } })
  if (r.status === 404) return null
  if (!r.ok) throw new Error('Failed to fetch tasks-done')
  return parseTasksDone(await r.json())
}

// ── 每天的三項計數 ──
export type Counts = Record<PartKey, number>
/** 每項的具體標題（任務名稱、想法標題）；任務標題推送端沒給的日子是空陣列，數量照 Counts */
export type Items = Record<PartKey, string[]>
export interface DailyIndex { at: (date: string) => Counts; items: (date: string) => Items; tasksSince: string | null }

/** 想法：bornAt 那天算一個新想法；history 裡第一次 done 那天算一個實行（重開又完成不重算） */
export function dailyIndex(ideas: readonly IdeaItem[], tasks: TasksDone | null): DailyIndex {
  const born: Record<string, string[]> = {}
  const done: Record<string, string[]> = {}
  for (const it of ideas) {
    if (typeof it.bornAt === 'string' && DATE.test(it.bornAt.slice(0, 10))) (born[it.bornAt.slice(0, 10)] ??= []).push(it.title)
    // 回補想法的 done 是補登日（10/09 一天 44 筆），不是真的那天實行
    const first = it.backfill ? undefined : (it.history ?? []).filter((h) => h.status === 'done' && typeof h.at === 'string' && DATE.test(h.at.slice(0, 10)))
      .map((h) => h.at.slice(0, 10)).sort()[0]
    if (first) (done[first] ??= []).push(it.title)
  }
  const byDate = tasks?.byDate ?? {}
  const titles = tasks?.titlesByDate ?? {}
  return {
    at: (d) => ({ tasks: byDate[d] ?? 0, ideasNew: born[d]?.length ?? 0, ideasDone: done[d]?.length ?? 0 }),
    items: (d) => ({ tasks: titles[d] ?? [], ideasNew: born[d] ?? [], ideasDone: done[d] ?? [] }),
    tasksSince: tasks?.since ?? null,
  }
}

const zero = (): Counts => ({ tasks: 0, ideasNew: 0, ideasDone: 0 })
const add = (a: Counts, b: Counts): Counts => ({ tasks: a.tasks + b.tasks, ideasNew: a.ideasNew + b.ideasNew, ideasDone: a.ideasDone + b.ideasDone })
export const totalOf = (c: Counts) => c.tasks + c.ideasNew + c.ideasDone
const minDate = (a: string, b: string) => (a < b ? a : b)
const shift = (d: string, n: number) => new Date(Date.parse(`${d}T12:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10)

/** 區間合計；只算到今天（未來的日子不算） */
export function sumRange(ix: DailyIndex, r: Range, today: string): Counts {
  const end = minDate(r[1], today)
  if (end < r[0]) return zero()
  return eachDay([r[0], end]).reduce((acc, d) => add(acc, ix.at(d)), zero())
}

/** 區間內每項的標題（由舊到新）；只算到今天 */
export function itemsRange(ix: DailyIndex, r: Range, today: string): Items {
  const out: Items = { tasks: [], ideasNew: [], ideasDone: [] }
  const end = minDate(r[1], today)
  if (end < r[0]) return out
  for (const d of eachDay([r[0], end])) {
    const it = ix.items(d)
    for (const { key } of PARTS) out[key].push(...it[key])
  }
  return out
}

/** 一項的提示窗：「✅ 完成任務 4」＋逐條標題（超過 8 項寫「另 N 項」）；數量多於標題時補一句（舊資料沒有任務標題） */
export function partTip(key: PartKey, count: number, titles: readonly string[], unknown = false): string {
  const p = PARTS.find((x) => x.key === key)!
  const head = `${p.icon} ${p.label} ${unknown ? '—' : count}`
  if (unknown) return `${head}（還沒有資料）`
  if (count === 0) return head
  if (titles.length === 0) return `${head}（這段時間沒有標題紀錄）`
  const text = tipText(head, titles)
  return titles.length < count ? `${text}\n（另 ${count - titles.length} 項沒有標題紀錄）` : text
}

// ── 走勢：本期往前 N 期 ──
export interface Bucket extends Counts {
  range: [string, string]
  label: string
  total: number
  current: boolean
  /** 這期還沒結束 */
  partial: boolean
  /** 這期整段都在任務資料開始之前（任務數不可信，畫成 0 但標出來） */
  noTasks: boolean
  /** 這期每項的標題（提示窗用） */
  items: Items
}

export function bucketLabel(level: MsLevel, r: Range): string {
  const y = r[0].slice(2, 4), m = Number(r[0].slice(5, 7)), d = Number(r[0].slice(8, 10))
  if (level === 'day') return String(d)
  if (level === 'week') return `${m}/${d}`
  if (level === 'month') return m === 1 ? `${y}/1` : `${m}月`
  if (level === 'quarter') return `${y}Q${Math.floor((m - 1) / 3) + 1}`
  return r[0].slice(0, 4)
}

export function buckets(ix: DailyIndex, level: MsLevel, range: Range, today: string, n = TREND_N[level]): Bucket[] {
  const ranges: Array<[string, string]> = [[range[0], range[1]]]
  while (ranges.length < n) ranges.unshift(prevRange(ranges[0]))
  return ranges.map((r, i) => {
    const c = sumRange(ix, r, today)
    return {
      ...c, range: r, label: bucketLabel(level, r), total: totalOf(c), current: i === ranges.length - 1, partial: r[1] > today,
      noTasks: ix.tasksSince === null || r[1] < ix.tasksSince, items: itemsRange(ix, r, today),
    }
  })
}

// ── 連續有成果的天數 ──
const MAX_STREAK_SCAN = 3660
/** 到 end（不晚於今天）為止，往回連續幾天至少有一項成果。end 當天還是 0 時從前一天起算（今天還沒做不算斷）。 */
export function streakEndingAt(ix: DailyIndex, end: string, today: string): number {
  let d = minDate(end, today)
  if (d === today && totalOf(ix.at(d)) === 0) d = shift(d, -1)
  let n = 0
  while (n < MAX_STREAK_SCAN && totalOf(ix.at(d)) > 0) { n += 1; d = shift(d, -1) }
  return n
}

/** 區間內最長的連續天數 */
export function longestStreak(ix: DailyIndex, r: Range, today: string): number {
  const end = minDate(r[1], today)
  if (end < r[0]) return 0
  let best = 0, cur = 0
  for (const d of eachDay([r[0], end])) { cur = totalOf(ix.at(d)) > 0 ? cur + 1 : 0; best = Math.max(best, cur) }
  return best
}

// ── 年度累計的關卡 ──
export interface Road { key: PartKey; ytd: number; prevTier: number; next: number | null; pct: number; crossed: number[] }

/** 期末那年從 1/1 累計到期末（不晚於今天）；crossed＝這一期之內跨過的關卡 */
export function roads(ix: DailyIndex, range: Range, today: string): { year: string; rows: Road[] } {
  const end = minDate(range[1], today)
  const year = end.slice(0, 4)
  const jan1 = `${year}-01-01`
  const ytd = end >= jan1 ? sumRange(ix, [jan1, end], today) : zero()
  const from = range[0] > jan1 ? range[0] : jan1
  const before = from > jan1 ? sumRange(ix, [jan1, shift(from, -1)], today) : zero()
  const rows = PARTS.map(({ key }): Road => {
    const v = ytd[key]
    const prevTier = [...LADDER].reverse().find((t) => t <= v) ?? 0
    const next = LADDER.find((t) => t > v) ?? null
    return {
      key, ytd: v, prevTier, next,
      pct: next === null ? 100 : Math.round(((v - prevTier) / (next - prevTier)) * 100),
      crossed: LADDER.filter((t) => t > before[key] && t <= v),
    }
  })
  return { year, rows }
}

// ── 徽章 ──
export interface Badge { icon: string; text: string; kind: 'streak' | 'record' | 'tier' | 'next' }

export function badges(level: MsLevel, bs: Bucket[], streak: number, longest: number, road: { year: string; rows: Road[] }): Badge[] {
  const out: Badge[] = []
  if (streak >= 2) out.push({ icon: '🔥', text: `連續 ${streak} 天有成果`, kind: 'streak' })
  if (level !== 'day' && longest >= 3 && longest !== streak) out.push({ icon: '📆', text: `本期最長連續 ${longest} 天`, kind: 'streak' })
  const cur = bs[bs.length - 1]
  const others = bs.slice(0, -1).filter((b) => b.total > 0)
  if (cur && cur.total > 0 && others.length >= 2 && cur.total > Math.max(...others.map((b) => b.total))) {
    out.push({ icon: '🏆', text: `近 ${bs.length} ${UNIT_WORD[level]}最多`, kind: 'record' })
  }
  for (const r of road.rows) {
    const top = r.crossed[r.crossed.length - 1]
    if (top !== undefined) out.push({ icon: '🎯', text: `${road.year} 年${PARTS.find((p) => p.key === r.key)!.label}達 ${top}`, kind: 'tier' })
  }
  if (!out.some((b) => b.kind === 'tier')) {
    const near = road.rows.filter((r) => r.next !== null && r.ytd > 0).sort((a, b) => (a.next! - a.ytd) - (b.next! - b.ytd))[0]
    if (near) out.push({ icon: '⛳', text: `${PARTS.find((p) => p.key === near.key)!.label}再 ${near.next! - near.ytd} 到 ${near.next}`, kind: 'next' })
  }
  return out
}

/** 走勢的平均（不含本期、不含整期都沒有任何成果的期，避免資料開始之前的空期把平均拉低） */
export function averageOthers(bs: Bucket[]): number | null {
  const others = bs.slice(0, -1).filter((b) => b.total > 0)
  if (others.length === 0) return null
  return Math.round((others.reduce((s, b) => s + b.total, 0) / others.length) * 10) / 10
}

/** 卡片一次需要的全部數字 */
export interface Milestones {
  level: MsLevel
  current: Bucket
  trend: Bucket[]
  avg: number | null
  streak: number
  longest: number
  road: { year: string; rows: Road[] }
  badges: Badge[]
  tasksSince: string | null
}

export function buildMilestones(ideas: readonly IdeaItem[], tasks: TasksDone | null, level: MsLevel, range: Range, today: string): Milestones | null {
  if (!(DATE.test(range[0]) && DATE.test(range[1])) || range[0] > range[1]) return null
  const ix = dailyIndex(ideas, tasks)
  const trend = buckets(ix, level, range, today)
  const streak = streakEndingAt(ix, range[1], today)
  const longest = longestStreak(ix, range, today)
  const road = roads(ix, range, today)
  return {
    level, current: trend[trend.length - 1], trend, avg: averageOthers(trend), streak, longest, road,
    badges: badges(level, trend, streak, longest, road), tasksSince: ix.tasksSince,
  }
}
