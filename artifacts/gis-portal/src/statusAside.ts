// 首頁右欄 STATUS（2.88.0）的純邏輯：面向 7 天差與迷你線、知識庫這週、搜尋／推送統計的解析與格式、付費服務一句話。
// 無 React、無 DOM、無網路；網路在 statsApi.ts，畫面在 StatusAside.tsx。
import { buildServiceRows, type PaidServicesData } from './paidServicesView'
import type { UsageData } from './boardApi'
import { changesByDay, isFresh, type Topic } from './knowledgeView'

// ── 面向：今天分數與 7 天平均的差、7 天迷你線 ──
export const WEEK_DAYS = 7

type HistoryLike = ReadonlyArray<{ date: string; components?: Record<string, number | null> | null }> | null | undefined

/** 某面向「最近 7 個有值的日子」（舊→新，只取 todayIso 以前，值夾在 0–100）。沒有 components 的日子略過 */
export function dimRecentValues(history: HistoryLike, key: string, todayIso: string, n = WEEK_DAYS): number[] {
  if (!Array.isArray(history)) return []
  const byDate = new Map<string, number>()
  for (const h of history) {
    if (!h || typeof h.date !== 'string' || h.date > todayIso) continue
    const c = h.components
    if (!c || typeof c !== 'object' || Array.isArray(c)) continue
    const v = c[key]
    if (typeof v === 'number' && Number.isFinite(v)) byDate.set(h.date, Math.min(100, Math.max(0, v)))
  }
  return [...byDate.entries()].sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0)).slice(-n).map((e) => e[1])
}

/** 今天分數與「最近 7 個有值日子的平均」的差（取整）；有值的日子少於 2 天、或今天沒分數＝null */
export function dimDelta(today: number | null, recent: readonly number[]): number | null {
  if (today === null || !Number.isFinite(today) || recent.length < 2) return null
  const avg = recent.reduce((s, v) => s + v, 0) / recent.length
  return Math.round(today) - Math.round(avg)
}

/** ▲n／▼n／—（null 或 0 都是 —） */
export function deltaText(d: number | null): string {
  if (d === null || d === 0) return '—'
  return d > 0 ? `▲${d}` : `▼${-d}`
}

/** 迷你線的 polyline points（viewBox 0 0 w h）；少於 2 點回 null（不畫）。縱軸至少 10 分寬，免得幾乎持平的線被放大 */
export function sparkPoints(values: readonly number[], w = 60, h = 16, pad = 2, minSpan = 10): string | null {
  if (values.length < 2) return null
  let lo = Math.min(...values)
  let hi = Math.max(...values)
  if (hi - lo < minSpan) {
    const mid = (hi + lo) / 2
    lo = mid - minSpan / 2
    hi = mid + minSpan / 2
  }
  const span = hi - lo
  return values.map((v, i) => `${((i / (values.length - 1)) * w).toFixed(1)},${(pad + (1 - (v - lo) / span) * (h - 2 * pad)).toFixed(1)}`).join(' ')
}

export interface DimCell { key: string; value: number | null; delta: number | null; spark: string | null }

/** 一個面向小格要顯示的全部（純計算） */
export function dimCell(history: HistoryLike, key: string, value: number | null, todayIso: string): DimCell {
  const recent = dimRecentValues(history, key, todayIso)
  return { key, value, delta: dimDelta(value, recent), spark: sparkPoints(recent) }
}

// ── 成長與系統盒 ──
/** 知識庫這週：7 天內新增的頁（changesByDay 的 new-page）與新長出的句子（claims 的 firstSeen 在 7 天內，沿用 isFresh） */
export function knowledgeWeek(topics: readonly Topic[], now: Date, days = WEEK_DAYS): { pages: number; claims: number } {
  const pages = changesByDay(topics, now, days).reduce((s, d) => s + d.counts.newPage, 0)
  let claims = 0
  for (const t of topics) for (const c of t.claims ?? []) if (isFresh(c, now, days)) claims++
  return { pages, claims }
}

export const knowledgeWeekText = (k: { pages: number; claims: number }): string => `+${k.pages} 頁・+${k.claims} 句`

/** 你的更正：各題 claimStats.user 加總 */
export function userCorrections(topics: readonly Topic[]): number {
  let n = 0
  for (const t of topics) n += t.claimStats?.user ?? 0
  return n
}

/** 0～1 的比例 → 「33.3%」「50%」；不是有限數字 → 「—」 */
export function pctText(rate: number | null | undefined): string {
  if (typeof rate !== 'number' || !Number.isFinite(rate)) return '—'
  return `${(Math.round(rate * 1000) / 10).toString()}%`
}

// ── 搜尋／推送統計（GET /api/search/stats、/api/push/stats、/api/search/recent）的寬容解析 ──
export interface SearchStats { days: number; searches: number; zero: number; zeroRate: number; clicked: number; clickRate: number; topZero: Array<{ q: string; count: number }> }
export interface PushKindStat { kind: string; shown: number; opened: number; useless: number }
export interface PushStats {
  days: number; shown: number; opened: number; openRate: number; useful: number; useless: number; uselessRate: number
  byKind: PushKindStat[]; daysWithCards: number
}

const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v)
const num = (v: unknown): number => (isNum(v) ? v : 0)

export function parseSearchStats(raw: unknown): SearchStats | null {
  const r = raw as Record<string, unknown> | null
  if (!r || typeof r !== 'object' || !isNum(r.searches) || !isNum(r.zeroRate)) return null
  const topZero = Array.isArray(r.topZero)
    ? r.topZero.filter((x): x is { q: string; count: number } => !!x && typeof (x as { q?: unknown }).q === 'string' && isNum((x as { count?: unknown }).count))
    : []
  return { days: num(r.days), searches: r.searches, zero: num(r.zero), zeroRate: r.zeroRate, clicked: num(r.clicked), clickRate: num(r.clickRate), topZero }
}

export function parsePushStats(raw: unknown): PushStats | null {
  const r = raw as Record<string, unknown> | null
  if (!r || typeof r !== 'object' || !isNum(r.shown) || !isNum(r.openRate)) return null
  const byKind = Array.isArray(r.byKind)
    ? r.byKind.filter((x): x is PushKindStat => !!x && typeof (x as { kind?: unknown }).kind === 'string').map((x) => ({ kind: x.kind, shown: num(x.shown), opened: num(x.opened), useless: num(x.useless) }))
    : []
  return {
    days: num(r.days), shown: r.shown, opened: num(r.opened), openRate: r.openRate, useful: num(r.useful), useless: num(r.useless),
    uselessRate: num(r.uselessRate), byKind, daysWithCards: num(r.daysWithCards),
  }
}

/** 最近搜尋的詞：只收非空字串、去重、最多 limit 個 */
export function parseRecent(raw: unknown, limit = 5): string[] {
  const list = (raw as { recent?: unknown } | null)?.recent
  if (!Array.isArray(list)) return []
  const out: string[] = []
  for (const x of list) {
    if (typeof x !== 'string') continue
    const q = x.trim()
    if (q && !out.includes(q)) out.push(q)
    if (out.length >= limit) break
  }
  return out
}

export const KIND_LABEL: Record<string, string> = {
  topic: '主題知識', resume: '案件回頭做', recall: '想起來', quiet: '很久沒聯絡', brief: '明日報告', onthisday: '歷年今天',
}

// ── 付費服務一句話 ──
export interface ServiceSummary { text: string; abnormal: boolean }

/**
 * 現有資料推不出「扣款倒數」（沒有任何服務的扣款日欄位），所以用各服務現有的狀態列算：
 * 兩個端點都沒資料＝「看用量」；有任何服務 warn／crit（餘額低、讀取失敗）或端點本身失敗＝黃色，點名要注意的服務；否則「N 項自動讀取，正常」。
 */
export function serviceSummary(i: { usage: UsageData | null; paid: PaidServicesData | null; usageError?: boolean; paidError?: boolean }): ServiceSummary {
  if (!i.usage && !i.paid && !i.usageError && !i.paidError) return { text: '看用量', abnormal: false }
  const rows = buildServiceRows({ usage: i.usage, paid: i.paid })
  const bad = rows.filter((r) => r.tone === 'warn' || r.tone === 'crit').map((r) => r.name.split(' ')[0]!)
  if (i.usageError && !i.usage) bad.push('Ollama 用量')
  if (i.paidError && !i.paid) bad.push('額度端點')
  if (bad.length > 0) return { text: `${bad.join('、')} 要注意`, abnormal: true }
  const live = rows.filter((r) => r.live).length
  return { text: live > 0 ? `${live} 項自動讀取，正常` : '看用量', abnormal: false }
}

/** 今天的一行：趨勢一句話＋下一步建議合成一行；兩者都沒有回 null */
export function todayLine(sentence: string, move: string | null): string | null {
  const parts = [sentence.trim(), move ? `👉 ${move.trim()}` : ''].filter((x) => x !== '')
  return parts.length > 0 ? parts.join('　') : null
}
