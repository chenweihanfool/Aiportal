// 💡 想法庫卡片與抽屜用的純函式（排序、篩選、類別徽章顏色、狀態文字）。
// 使用者 2026-10-09：系統／工作改善類也一起排名，只用徽章標出類別。
import type { IdeaItem, IdeaStatus } from './boardApi'

export const STATUS_LABEL: Record<IdeaStatus, string> = {
  new: '新想法', evaluating: '評估中', doing: '進行中', done: '已實行', shelved: '擱置', dropped: '放棄', absorbed: '併入',
}
export const STATUS_ICON: Record<IdeaStatus, string> = {
  new: '💭', evaluating: '🔍', doing: '🚀', done: '✅', shelved: '🗄️', dropped: '❌', absorbed: '🔀',
}
const OPEN: IdeaStatus[] = ['new', 'evaluating', 'doing']
export const isOpen = (s: IdeaStatus) => OPEN.includes(s)

// 類別徽章顏色：常見類別固定色，其他類別用名稱雜湊挑一個，同一類別每次都同色。
const FIXED: Record<string, string> = {
  系統: '#5f9bf0', 工作改善: '#9b8cf0', 財務: '#e8b23d', 學習: '#4fc1c9', 創作: '#e07bb5',
  生活: '#7cc47f', 健身: '#ef7d57', 旅遊: '#3fb6a8', 社交: '#f29e4c',
}
const EXTRA = ['#8fb0e8', '#c9a0f0', '#d4c45a', '#6fd0a0', '#f08f8f', '#a6b4c8']
export function categoryColor(category: string | null): string {
  if (!category) return '#5b6270'
  const hit = Object.keys(FIXED).find((k) => category.includes(k))
  if (hit) return FIXED[hit]!
  let h = 0
  for (const ch of category) h = (h * 31 + ch.codePointAt(0)!) >>> 0
  return EXTRA[h % EXTRA.length]!
}

/** 首頁前三名：依 API 給的 top 順序取出 */
export function topIdeas(ideas: IdeaItem[], top: string[]): IdeaItem[] {
  const by = new Map(ideas.map((i) => [i.id, i]))
  return top.map((id) => by.get(id)).filter((i): i is IdeaItem => !!i)
}

/** 抽屜清單：開放中的照分數高→低，已結束的排後面（新→舊） */
export function sortForList(ideas: IdeaItem[]): IdeaItem[] {
  return [...ideas].sort((a, b) => {
    const ao = isOpen(a.status), bo = isOpen(b.status)
    if (ao !== bo) return ao ? -1 : 1
    if (ao) return (b.score ?? 0) - (a.score ?? 0) || a.id.localeCompare(b.id)
    return b.lastMentioned.localeCompare(a.lastMentioned)
  })
}

export function categoryCounts(ideas: IdeaItem[]): Array<[string, number]> {
  const m = new Map<string, number>()
  for (const i of ideas) m.set(i.category ?? '未分類', (m.get(i.category ?? '未分類') ?? 0) + 1)
  return [...m.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
}

export type StatusFilter = 'open' | 'done' | 'closed' | 'all'
export function filterIdeas(ideas: IdeaItem[], category: string | null, status: StatusFilter): IdeaItem[] {
  return ideas.filter((i) => {
    if (category && (i.category ?? '未分類') !== category) return false
    if (status === 'open') return isOpen(i.status)
    if (status === 'done') return i.status === 'done'
    if (status === 'closed') return i.status === 'shelved' || i.status === 'dropped' || i.status === 'absorbed'
    return true
  })
}

export function statusCounts(ideas: IdeaItem[]): { open: number; doing: number; done: number; total: number } {
  return {
    open: ideas.filter((i) => isOpen(i.status)).length,
    doing: ideas.filter((i) => i.status === 'doing').length,
    done: ideas.filter((i) => i.status === 'done').length,
    total: ideas.length,
  }
}

/** 🔀 併入關係的文字徽章：被併入者「🔀 併入 → IDEA-0022」、承接者「吸收：IDEA-0039、IDEA-0040 等 N 個」 */
export function absorbBadges(idea: Pick<IdeaItem, 'mergedInto' | 'absorbed'>): { mergedInto: string | null; absorbed: string | null } {
  const list = idea.absorbed ?? []
  const absorbed = list.length === 0 ? null
    : `吸收：${list.slice(0, 2).join('、')}${list.length > 2 ? ` 等 ${list.length} 個` : ''}`
  return { mergedInto: idea.mergedInto ? `🔀 併入 → ${idea.mergedInto}` : null, absorbed }
}

/** 1–5 的點數（價值／難度），null 顯示「—」 */
export const pips = (n: number | null) => (n === null ? '—' : '●'.repeat(n) + '○'.repeat(5 - n))

// 「複製給 HERMES」：入口網不寫入，狀態一律由 HERMES 寫進日記（docs/ideas.md 的 💡✅／🚀… 標記）。
// 使用者 2026-10-09：用 Telegram 告訴 HERMES 進度，按鈕只負責把要貼的那句話複製好。
// 併入（🔀）要指定承接者，不在一鍵複製的範圍（入口網一鍵併入列為後續）。
export type CopyStatus = Exclude<IdeaStatus, 'new' | 'absorbed'>
export const STATUS_MARK: Record<CopyStatus, string> = {
  evaluating: '🔍', doing: '🚀', done: '✅', shelved: '🗄️', dropped: '❌',
}
export const STATUS_ACTION: Record<CopyStatus, string> = {
  evaluating: '評估中', doing: '開始做', done: '已實行', shelved: '擱置', dropped: '放棄',
}
/** 這筆想法可以改成哪些狀態（不含目前的、也不回到「新想法」） */
export function nextStatuses(current: IdeaStatus): CopyStatus[] {
  return (['done', 'doing', 'evaluating', 'shelved', 'dropped'] as const).filter((s) => s !== current)
}
/** 貼到 Telegram 給 HERMES 的一句話；第一行就是 HERMES 寫進日記時用的標記 */
export function statusMessage(idea: Pick<IdeaItem, 'id' | 'title'>, status: CopyStatus, note = ''): string {
  const line = `💡${STATUS_MARK[status]} ${idea.id}「${idea.title}」${STATUS_ACTION[status]}`
  return note.trim() ? `${line}\n${note.trim()}` : `${line}\n（請照想法庫格式寫進今天的日記）`
}

// ── 來龍去脈（2026-10-22 使用者：「我想看每個想法的來龍去脈」）──────────────
// 只用 HermesIdea 已有的欄位（bornAt／days／history／mergedInto／absorbed），不需要改 HERMES 端。
// 日記原文出處不在資料裡，列為第二期（用 /hermes-doc 以日期點進去）。

/** 狀態色：開放中用琥珀系、完成綠、結束灰；併入用藍紫，與類別徽章分開 */
export const STATUS_COLOR: Record<IdeaStatus, string> = {
  new: '#8fb0e8', evaluating: '#e8b23d', doing: '#f5a623', done: '#5fbf7a', shelved: '#7a8190', dropped: '#c46a6a', absorbed: '#9b8cf0',
}

const DAY_MS = 86_400_000
const toMs = (s: string): number => {
  // 'YYYY-MM-DD' 視為台北時間中午，避免跨日；其餘照 ISO 解析
  const t = /^\d{4}-\d{2}-\d{2}$/.test(s) ? Date.parse(`${s}T12:00:00+08:00`) : Date.parse(s)
  return Number.isFinite(t) ? t : NaN
}
const shortDate = (ms: number): string => {
  const d = new Date(ms + 8 * 3_600_000) // 台北日期
  return `${d.getUTCMonth() + 1}/${d.getUTCDate()}`
}

export interface LifelineStep { status: IdeaStatus; ms: number; label: string }
export interface Lifeline {
  startMs: number
  endMs: number
  /** 還沒結束的想法，終點是「現在」 */
  ongoing: boolean
  /** 每次被想起（日記日期），已排序去重，落在 [start, end] 之內 */
  recalls: Array<{ ms: number; date: string }>
  /** 狀態變化（含誕生），依時間排序 */
  steps: LifelineStep[]
  endStatus: IdeaStatus
  daysAlive: number
  /** 一句話摘要：「10/1 誕生 → 想起 3 次 → 10/12 進行中 → 10/20 已實行（歷時 19 天）」 */
  summary: string
}

const CLOSED: IdeaStatus[] = ['done', 'shelved', 'dropped', 'absorbed']
const isStatus = (s: string): s is IdeaStatus => s in STATUS_LABEL

export function buildLifeline(idea: Pick<IdeaItem, 'status' | 'bornAt' | 'lastMentioned' | 'days' | 'history' | 'mentions'>, nowMs: number): Lifeline | null {
  const born = toMs(idea.bornAt)
  if (!Number.isFinite(born)) return null
  const steps: LifelineStep[] = []
  for (const h of idea.history) {
    const ms = toMs(h.at)
    if (!Number.isFinite(ms) || !isStatus(h.status)) continue
    steps.push({ status: h.status, ms: Math.max(ms, born), label: `${shortDate(ms)} ${STATUS_LABEL[h.status]}` })
  }
  steps.sort((a, b) => a.ms - b.ms)
  // history 沒記到誕生時補一個，讓階梯線有起點
  if (steps.length === 0 || steps[0]!.ms > born) steps.unshift({ status: 'new', ms: born, label: `${shortDate(born)} ${STATUS_LABEL.new}` })
  const ended = CLOSED.includes(idea.status)
  const last = steps[steps.length - 1]!
  // 已結束：終點是進入結束狀態的時間（找不到就用最後一次被想起）
  const closedAt = ended ? (steps.filter((s) => s.status === idea.status).pop()?.ms ?? toMs(idea.lastMentioned)) : NaN
  const endMs = ended && Number.isFinite(closedAt) ? Math.max(closedAt, born) : Math.max(nowMs, last.ms, born)
  const seen = new Set<string>()
  const recalls = idea.days
    .filter((d) => (seen.has(d) ? false : (seen.add(d), true)))
    .map((d) => ({ ms: toMs(d), date: d }))
    .filter((r) => Number.isFinite(r.ms))
    .sort((a, b) => a.ms - b.ms)
  const daysAlive = Math.max(0, Math.round((endMs - born) / DAY_MS))
  const mid = steps.filter((s, i) => i > 0 && s.status !== 'new').map((s) => s.label)
  const times = Math.max(idea.mentions, recalls.length)
  const parts = [`${shortDate(born)} 誕生`, times > 1 ? `想起 ${times} 次` : '只提過一次', ...mid]
  const summary = `${parts.join(' → ')}${ended ? `（歷時 ${daysAlive} 天）` : `（已 ${daysAlive} 天，進行中）`}`
  return { startMs: born, endMs, ongoing: !ended, recalls, steps, endStatus: idea.status, daysAlive, summary }
}

/** 時間軸座標：把毫秒對到 [x0, x1]；起訖同一天時置中，避免除以 0 */
export function scaleTime(ms: number, startMs: number, endMs: number, x0: number, x1: number): number {
  if (endMs <= startMs) return (x0 + x1) / 2
  return x0 + ((Math.min(Math.max(ms, startMs), endMs) - startMs) / (endMs - startMs)) * (x1 - x0)
}

export interface LineageNode { id: string; title: string; status: IdeaStatus; children: LineageNode[] }

/** 血緣樹：從 id 往上找到最上層的承接者，再往下展開被它吸收的想法；沒有併入關係回傳 null。 */
export function buildLineage(ideas: Array<Pick<IdeaItem, 'id' | 'title' | 'status' | 'mergedInto' | 'absorbed'>>, id: string): { root: LineageNode; size: number } | null {
  const by = new Map(ideas.map((i) => [i.id, i]))
  const me = by.get(id)
  if (!me || (!me.mergedInto && !(me.absorbed?.length))) return null
  // 往上：防止資料出現環
  let top = me
  const up = new Set<string>([me.id])
  while (top.mergedInto && by.has(top.mergedInto) && !up.has(top.mergedInto)) { top = by.get(top.mergedInto)!; up.add(top.id) }
  // 往下：children＝absorbed ∪ 指向自己的 mergedInto（兩邊資料任一邊缺都能接起來）
  const kids = new Map<string, string[]>()
  for (const i of ideas) {
    const set = new Set<string>(i.absorbed ?? [])
    for (const j of ideas) if (j.mergedInto === i.id) set.add(j.id)
    kids.set(i.id, [...set].filter((k) => by.has(k)).sort())
  }
  const seen = new Set<string>()
  const walk = (i: (typeof ideas)[number]): LineageNode => {
    seen.add(i.id)
    const children = (kids.get(i.id) ?? []).filter((k) => !seen.has(k)).map((k) => walk(by.get(k)!))
    return { id: i.id, title: i.title, status: i.status, children }
  }
  const root = walk(top)
  return { root, size: seen.size }
}

export interface ScatterPoint { id: string; title: string; x: number; y: number; r: number; status: IdeaStatus; open: boolean }
export const SCATTER_QUADRANTS = { quickWin: '快贏（價值高・難度低）', bigBet: '大案（價值高・難度高）', chore: '雜務（價值低・難度低）', avoid: '避開（價值低・難度高）' } as const

/** 價值×難度散佈：x＝難度、y＝價值（1–5），點大小隨被想起次數（半徑 4–10）；價值或難度未估的不畫，回報略過幾筆 */
export function buildScatter(ideas: IdeaItem[]): { points: ScatterPoint[]; skipped: number } {
  const points: ScatterPoint[] = []
  let skipped = 0
  for (const i of ideas) {
    if (i.value === null || i.effort === null) { skipped++; continue }
    points.push({ id: i.id, title: i.title, x: i.effort, y: i.value, r: Math.min(10, 4 + Math.max(0, i.mentions - 1)), status: i.status, open: isOpen(i.status) })
  }
  return { points, skipped }
}
export function quadrantOf(value: number, effort: number): keyof typeof SCATTER_QUADRANTS {
  if (value >= 3.5) return effort <= 2.5 ? 'quickWin' : 'bigBet'
  return effort <= 2.5 ? 'chore' : 'avoid'
}

/** 全部想法的生命週期統計：誕生到結束的中位天數、想起多次的比例 */
export function lifeStats(ideas: IdeaItem[], nowMs: number): { total: number; closed: number; medianDaysToClose: number | null; recurring: number } {
  const days: number[] = []
  let recurring = 0
  for (const i of ideas) {
    if (i.mentions >= 3) recurring++
    if (!CLOSED.includes(i.status)) continue
    const lf = buildLifeline(i, nowMs)
    if (lf) days.push(lf.daysAlive)
  }
  days.sort((a, b) => a - b)
  const m = days.length === 0 ? null : days.length % 2 ? days[(days.length - 1) / 2]! : Math.round((days[days.length / 2 - 1]! + days[days.length / 2]!) / 2)
  return { total: ideas.length, closed: days.length, medianDaysToClose: m, recurring }
}
