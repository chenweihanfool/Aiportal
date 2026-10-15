// 新首頁（HomeBoard，#home 預覽）用的純函式：無 React、無 DOM、無網路，可單元測試。
// 對應審計報告 docs/portal-audit-2026-10.md §2.4（統一狀態機）、§2.6（五段式）。
// 日期一律以台北時間的 YYYY-MM-DD 字串運算（UTC 午夜），避免時區讓天數少算或多算一天。
import type { BoardPipeline, BoardStatus, HhiHistoryPoint, PusherHealth, UsageData } from './boardApi'
import { biggestDrag, type HhiRow } from './boardView'
import { describeForecast } from './diskView'
import { isBeen, type FoodPlace } from './foodMap'
import type { HermesGraphMetrics } from './hermesGraphApi'
import type { Trip } from './tripsApi'
import { dayDiff, tripSpanDays } from './tripsView'

const DAY_MS = 86_400_000
const isoMs = (iso: string) => Date.parse(`${iso}T00:00:00Z`)

/** 日期加減天數（YYYY-MM-DD） */
export function addDays(iso: string, n: number): string {
  return new Date(isoMs(iso) + n * DAY_MS).toISOString().slice(0, 10)
}

/** 台北時間今天 YYYY-MM-DD */
export function taipeiDate(now: Date): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Taipei', year: 'numeric', month: '2-digit', day: '2-digit' }).format(now)
}

const taipeiHour = (now: Date): number =>
  Number(new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Taipei', hour: '2-digit', hourCycle: 'h23' }).format(now))

const isLeap = (y: number) => (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0

// ── 問候 ──────────────────────────────────────
export type DayPart = 'morning' | 'noon' | 'afternoon' | 'evening' | 'night'
/** 依台北時段換問候語（§2.7）：5–10 早、11–13 午、14–17 午後、18–21 晚、其餘深夜 */
export function greeting(now: Date): { text: string; part: DayPart } {
  const h = taipeiHour(now)
  if (h >= 5 && h <= 10) return { text: '早安', part: 'morning' }
  if (h >= 11 && h <= 13) return { text: '午安', part: 'noon' }
  if (h >= 14 && h <= 17) return { text: '午後好', part: 'afternoon' }
  if (h >= 18 && h <= 21) return { text: '晚上好', part: 'evening' }
  return { text: '夜深了', part: 'night' }
}

// ── 今年已過 N% ───────────────────────────────
export interface YearProgress { year: number; dayOfYear: number; daysInYear: number; pct: number }
/** 今天是今年第幾天（含今天）÷ 全年天數；閏年 366 天 */
export function yearProgress(now: Date): YearProgress {
  const iso = taipeiDate(now)
  const year = Number(iso.slice(0, 4))
  const dayOfYear = Math.round((isoMs(iso) - isoMs(`${year}-01-01`)) / DAY_MS) + 1
  const daysInYear = isLeap(year) ? 366 : 365
  return { year, dayOfYear, daysInYear, pct: Math.round((dayOfYear / daysInYear) * 100) }
}

// ── ① 幸福指數：與昨天的差、連續天數 ───────────
export interface HhiTrend {
  /** 今天的顯示值（以儀表板現值為準，沒有再用歷史裡今天那筆） */
  score: number | null
  yesterday: number | null
  /** 與昨天的差；昨天沒有資料就是 null（不拿更早的日子充當昨天） */
  delta: number | null
  /** 到今天為止連續逐日上升／下降的天數；中斷（缺一天、持平、方向相反）就從中斷處重算 */
  streak: { direction: 'up' | 'down'; days: number } | null
  /** 有資料的天數（含今天） */
  historyDays: number
}

export function hhiTrend(history: HhiHistoryPoint[], todayIso: string, current: number | null): HhiTrend {
  const byDate = new Map<string, number>()
  for (const h of history) {
    if (h.date <= todayIso && Number.isFinite(h.displayedScore)) byDate.set(h.date.slice(0, 10), h.displayedScore)
  }
  if (current !== null && Number.isFinite(current)) byDate.set(todayIso, current)
  const score = byDate.get(todayIso) ?? null
  const yesterday = byDate.get(addDays(todayIso, -1)) ?? null
  let streak: HhiTrend['streak'] = null
  if (score !== null) {
    let dir: 'up' | 'down' | null = null
    let days = 0
    let d = todayIso
    for (;;) {
      const cur = byDate.get(d)
      const prev = byDate.get(addDays(d, -1))
      if (cur === undefined || prev === undefined || cur === prev) break
      const step = cur > prev ? 'up' : 'down'
      if (dir !== null && dir !== step) break
      dir = step
      days++
      d = addDays(d, -1)
    }
    if (dir !== null) streak = { direction: dir, days }
  }
  return { score, yesterday, delta: score !== null && yesterday !== null ? score - yesterday : null, streak, historyDays: byDate.size }
}

/**
 * ① 那一句話：不呼叫任何模型，用規則組句——先講趨勢（連續天數優先，其次與昨天的差），再講最大短板。
 * 沒有資料時直接說沒有，不編。
 */
export function todaySentence(i: { trend: HhiTrend | null; rows: HhiRow[] }): string {
  const t = i.trend
  if (!t || t.score === null) return '今天的幸福指數還沒有資料，等資料進來再說。'
  let lead: string
  if (t.streak && t.streak.days >= 2) lead = `連 ${t.streak.days} 天${t.streak.direction === 'up' ? '上升' : '下降'}`
  else if (t.delta === null) lead = '昨天沒有紀錄，沒辦法跟昨天比'
  else if (t.delta > 0) lead = `比昨天高 ${t.delta} 分`
  else if (t.delta < 0) lead = `比昨天低 ${-t.delta} 分`
  else lead = '和昨天持平'
  const scored = i.rows.filter((r) => r.value !== null)
  const missing = i.rows.length - scored.length
  const drag = biggestDrag(i.rows)
  let tail: string
  if (drag && drag.value !== null) {
    const gap = (((100 - drag.value) * drag.weightPct) / 100).toFixed(1)
    tail = `現在最大的短板是「${drag.label}」（${drag.value} 分，拉低總分 ${gap} 分）`
    if (missing > 0) tail += `，另有 ${missing} 個面向今天沒有資料`
  } else if (scored.length === 0) tail = '六個面向今天都沒有分數，先不下結論'
  else tail = '目前沒有明顯的短板'
  return `${lead}，${tail}。`
}

/** 面向小卡的一句話：不編故事，只把分數翻成生活語言（門檻與 hhiTone 的 80／65／50／35 相同） */
export function dimensionLine(row: HhiRow, isDrag: boolean): string {
  if (row.value === null) return '今天沒有資料'
  if (isDrag) return `目前最大短板，拉低總分 ${(((100 - row.value) * row.weightPct) / 100).toFixed(1)} 分`
  if (row.value >= 80) return '表現很好'
  if (row.value >= 65) return '穩定'
  if (row.value >= 50) return '尚可，需留意'
  if (row.value >= 35) return '需要調整'
  return '偏低，優先照顧'
}

// ── ③ 年熱圖 ──────────────────────────────────
export interface HeatCell { date: string; value: number | null; col: number; row: number }
export interface Heatmap {
  cells: HeatCell[]
  /** 欄數（週數，GitHub 式：週日起算、每欄 7 列） */
  cols: number
  /** 月份標籤的欄位 */
  months: Array<{ col: number; label: string }>
  /** 有紀錄的天數 */
  withData: number
  start: string
  end: string
}

/**
 * 最近 days 天（含今天）每天一格；沒有紀錄的日子 value＝null（畫空格，不是 0）。
 * 以日曆日期逐天推算，所以閏年的 2/29、跨年都照實排；格數永遠等於 days。
 */
export function buildHeatmap(history: HhiHistoryPoint[], todayIso: string, days = 365): Heatmap {
  const start = addDays(todayIso, -(days - 1))
  const byDate = new Map<string, number>()
  for (const h of history) if (Number.isFinite(h.displayedScore)) byDate.set(h.date.slice(0, 10), h.displayedScore)
  const startDow = new Date(isoMs(start)).getUTCDay()
  const cells: HeatCell[] = []
  const months: Heatmap['months'] = []
  let withData = 0
  for (let i = 0; i < days; i++) {
    const date = addDays(start, i)
    const value = byDate.get(date) ?? null
    if (value !== null) withData++
    const offset = startDow + i
    const col = Math.floor(offset / 7)
    cells.push({ date, value, col, row: offset % 7 })
    if (date.endsWith('-01')) months.push({ col, label: `${Number(date.slice(5, 7))}月` })
  }
  // 第一欄也標月份，除非下一個月初離得太近（會疊在一起）
  if (!months.length || months[0]!.col >= 3) months.unshift({ col: 0, label: `${Number(start.slice(5, 7))}月` })
  return { cells, cols: Math.floor((startDow + days - 1) / 7) + 1, months, withData, start, end: todayIso }
}

// ── ③ 知識庫累積 ──────────────────────────────
export interface KnowledgeStats {
  people: number | null
  events: number | null
  /** 已晉升的概念／方法數；舊版 API 沒有這兩欄就是 null（顯示「—」） */
  concepts: number | null
  methods: number | null
  newEventsThisWeek: number | null
  newPeopleThisWeek: number | null
}
const numOrNull = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null)
export function knowledgeStats(m: HermesGraphMetrics | undefined | null): KnowledgeStats {
  return {
    people: numOrNull(m?.peopleCount),
    events: numOrNull(m?.eventsCount),
    concepts: numOrNull(m?.conceptsCount),
    methods: numOrNull(m?.methodsCount),
    newEventsThisWeek: numOrNull(m?.newEventsThisWeek),
    newPeopleThisWeek: numOrNull(m?.newPeopleThisWeek),
  }
}

// ── ③ 里程碑（只列現有資料能確定性判斷的）──────
export interface Milestone {
  id: string
  icon: string
  title: string
  detail: string
  /** 下一個目標與還差多少；已是最高級就是 null */
  next: string | null
}
export interface MilestoneInput {
  events: number | null
  people: number | null
  ideasDone: number | null
  placesBeen: number | null
  /** 幸福指數：今天的值與歷史（用來判斷「創新高」） */
  hhi?: { score: number | null; history: HhiHistoryPoint[]; todayIso: string } | null
}
const LADDERS = {
  events: [100, 250, 500, 1000, 2000, 5000],
  people: [50, 100, 200, 500],
  ideasDone: [1, 5, 10, 25, 50],
  placesBeen: [10, 25, 50, 100],
} as const
const fmtInt = (n: number) => n.toLocaleString('en-US')

function rung(value: number | null, ladder: readonly number[]): { reached: number; next: number | null } | null {
  if (value === null) return null
  let reached: number | null = null
  for (const r of ladder) if (value >= r) reached = r
  if (reached === null) return null
  return { reached, next: ladder.find((r) => r > value) ?? null }
}

/** 每條階梯只列「已達成的最高一級」；資料算不出來（null）的整條不列 */
export function milestones(i: MilestoneInput): Milestone[] {
  const out: Milestone[] = []
  const add = (id: string, icon: string, title: (n: number) => string, value: number | null, ladder: readonly number[], unit: string) => {
    const r = rung(value, ladder)
    if (!r || value === null) return
    out.push({ id, icon, title: title(r.reached), detail: `目前 ${fmtInt(value)} ${unit}`, next: r.next === null ? null : `下一個 ${fmtInt(r.next)}（還差 ${fmtInt(r.next - value)}）` })
  }
  add('events', '📅', (n) => `事件突破 ${fmtInt(n)}`, i.events, LADDERS.events, '個事件')
  add('people', '👥', (n) => `人物突破 ${fmtInt(n)}`, i.people, LADDERS.people, '位人物')
  add('ideasDone', '💡', (n) => `已實行 ${n} 個想法`, i.ideasDone, LADDERS.ideasDone, '個已實行')
  add('placesBeen', '📍', (n) => `去過 ${n} 個地點`, i.placesBeen, LADDERS.placesBeen, '個地點')
  const h = i.hhi
  if (h && h.score !== null) {
    const prev = h.history.filter((p) => p.date < h.todayIso && Number.isFinite(p.displayedScore))
    // 至少累積 30 天才談「新高」，且必須嚴格高於之前每一天
    if (prev.length >= 30 && prev.every((p) => h.score! > p.displayedScore)) {
      const first = prev.reduce((m, p) => (p.date < m ? p.date : m), prev[0]!.date)
      const span = dayDiff(first, h.todayIso) + 1
      out.push({ id: 'hhiRecord', icon: '🏆', title: `幸福指數創 ${span} 天新高`, detail: `今天 ${h.score} 分`, next: null })
    }
  }
  return out
}

// ── ④ 好玩的 ──────────────────────────────────
/** 想吃／想去狀態裡最久的一個（依第一次出現在日記的日期）；沒有就是 null */
export function oldestWantPlace(places: FoodPlace[], now: Date): { place: FoodPlace; days: number } | null {
  const want = places.filter((p) => p.status === 'want').sort((a, b) => a.addedAt.localeCompare(b.addedAt) || a.id.localeCompare(b.id))[0]
  if (!want) return null
  return { place: want, days: Math.max(0, dayDiff(want.addedAt, taipeiDate(now))) }
}
export const placesBeenCount = (places: FoodPlace[]): number => places.filter((p) => isBeen(p.status)).length

export interface LatestTrip { trip: Trip; days: number; when: 'ongoing' | 'recent' | 'upcoming' }
/** 最新一趟：進行中優先；否則最近出發的已結束趟次；只有計畫中的就取最近要出發的 */
export function latestTrip(trips: Trip[]): LatestTrip | null {
  const byStartDesc = (a: Trip, b: Trip) => b.start.localeCompare(a.start) || a.id.localeCompare(b.id)
  const ongoing = trips.filter((t) => t.status === 'ongoing').sort(byStartDesc)[0]
  if (ongoing) return { trip: ongoing, days: tripSpanDays(ongoing), when: 'ongoing' }
  const done = trips.filter((t) => t.status === 'done').sort(byStartDesc)[0]
  if (done) return { trip: done, days: tripSpanDays(done), when: 'recent' }
  const planned = trips.filter((t) => t.status === 'planned').sort((a, b) => a.start.localeCompare(b.start) || a.id.localeCompare(b.id))[0]
  return planned ? { trip: planned, days: tripSpanDays(planned), when: 'upcoming' } : null
}

// ── 狀態機（§2.4）─────────────────────────────
export type BlockState = 'locked' | 'loading' | 'pending' | 'empty' | 'fresh' | 'stale' | 'dead' | 'error'
export interface BlockInput {
  unlocked: boolean
  loading: boolean
  error: boolean
  /** 目前手上有沒有（上一次成功的）資料 */
  hasData: boolean
  /** 資料有了但真的是空的（0 筆） */
  empty?: boolean
  /** 系統剛上線、資料不夠畫趨勢 */
  pending?: boolean
  /** 資料自己的時間（ms）；沒有就不判斷新舊 */
  updatedAtMs?: number | null
  /** 預期更新間隔（分）；null＝有變動才送，不判斷新舊 */
  expectedEveryMin?: number | null
  nowMs: number
}
export interface BlockStatus {
  state: BlockState
  /** 資料年齡（分）；沒有時間或沒有預期間隔就是 null */
  ageMin: number | null
  /** error 時是否還有上一次的值可顯示（標 stale） */
  keepLastValue: boolean
}
export const STALE_FACTOR = 1.5
export const DEAD_FACTOR = 3

export function blockState(i: BlockInput): BlockStatus {
  const none = (state: BlockState, ageMin: number | null = null, keep = false): BlockStatus => ({ state, ageMin, keepLastValue: keep })
  if (!i.unlocked) return none('locked')
  if (i.error) return none('error', null, i.hasData)
  if (!i.hasData) return i.loading ? none('loading') : none('empty')
  if (i.empty) return none('empty')
  if (i.pending) return none('pending')
  const exp = i.expectedEveryMin ?? null
  if (i.updatedAtMs == null || exp === null || !Number.isFinite(i.updatedAtMs)) return none('fresh')
  const ageMin = Math.max(0, (i.nowMs - i.updatedAtMs) / 60_000)
  if (ageMin > exp * DEAD_FACTOR) return none('dead', ageMin)
  if (ageMin > exp * STALE_FACTOR) return none('stale', ageMin)
  return none('fresh', ageMin)
}

/**
 * 各資料的預期更新間隔（分）。null＝「有變動才送」，不判斷新舊（避免誤報已死）。
 * 這是 §2.4 要共用的那張表的首頁版；推送端 pusherHealth.expectedEveryMin 與全站統一表是 P1-2，這裡先寫保守值。
 */
export const EXPECTED_EVERY_MIN = {
  hhi: 60,
  hhiHistory: 1440,
  graph: 120,
  ideas: null,
  food: null,
  trips: null,
} as const

/** 「資料 n 小時前」：<60 分用分鐘，<48 小時用小時，其餘用天 */
export function formatAge(min: number): string {
  if (min < 1) return '剛剛'
  if (min < 60) return `${Math.round(min)} 分鐘前`
  if (min < 48 * 60) return `${Math.round(min / 60)} 小時前`
  return `${Math.round(min / 1440)} 天前`
}

/** 幸福指數歷史的「資料時間」：最後一筆那天的結束（隔天 00:00 台北）；沒有資料回 null */
export function historyUpdatedAtMs(history: HhiHistoryPoint[]): number | null {
  let last: string | null = null
  for (const h of history) if (last === null || h.date > last) last = h.date
  return last === null ? null : Date.parse(`${last.slice(0, 10)}T00:00:00+08:00`) + DAY_MS
}

// ── ⑤ 系統一顆燈 ──────────────────────────────
export type LightLevel = 'ok' | 'warn' | 'crit'
export interface LightReason { level: 'warn' | 'crit'; source: 'pipeline' | 'host' | 'push' | 'ollama' | 'data'; text: string }
export interface SystemLight {
  /** unknown＝一項資料都沒拿到（不說「正常」） */
  level: LightLevel | 'unknown'
  /** 依嚴重度（crit 先）再依來源順序排好 */
  reasons: LightReason[]
  headline: string
  /** 有檢查到的來源、拿不到資料的來源（中文名） */
  checked: string[]
  missing: string[]
}
export interface SystemLightInput {
  nowMs: number
  pipeline: { data: BoardPipeline | null; error: boolean }
  status: { data: BoardStatus | null; error: boolean }
  usage: { data: UsageData | null; error: boolean }
  /** DesktopBoard.pusherSummary 的結果；null＝舊 pusher 沒送 */
  pusher: { bad: number; total: number; level: LightLevel } | null
  /** 落後的推送來源名稱（已轉成中文） */
  badFeeds: string[]
  /** 首頁各資料區塊死掉（超過 3 倍預期間隔）的清單 */
  deadBlocks: Array<{ label: string; days: number }>
}

const SOURCE_ORDER: Record<LightReason['source'], number> = { pipeline: 0, host: 1, push: 2, ollama: 3, data: 4 }

/** 相對時間（與 DesktopBoard 的 minutesAgo 同一組門檻） */
export function ageText(ts: number | null, nowMs: number): string {
  if (ts === null) return '—'
  const m = Math.max(0, Math.round((nowMs - ts) / 60_000))
  if (m < 1) return '剛剛'
  if (m < 60) return `${m} 分鐘前`
  if (m < 60 * 36) return `${Math.round(m / 60)} 小時前`
  return `${Math.round(m / 1440)} 天前`
}

export function systemLight(i: SystemLightInput): SystemLight {
  const reasons: LightReason[] = []
  const checked: string[] = []
  const missing: string[] = []
  const add = (level: 'warn' | 'crit', source: LightReason['source'], text: string) => reasons.push({ level, source, text })
  const gate = <T>(label: string, s: { data: T | null; error: boolean }, source: LightReason['source'], ok: (d: T) => boolean): T | null => {
    if (s.error) { add('warn', source, `${label}讀取失敗`); missing.push(label); return null }
    if (s.data === null || !ok(s.data)) { missing.push(label); return null }
    checked.push(label)
    return s.data
  }

  // 管線
  const pipe = gate('管線', i.pipeline, 'pipeline', (d) => d.available)
  if (pipe) {
    for (const k of ['L1', 'L2', 'L3', 'L4', 'L5'] as const) {
      const l = pipe.layers[k]
      if (l?.health === 'crit') add('crit', 'pipeline', `管線 ${k} 失敗（${ageText(l.lastRunTs, i.nowMs)}）：${l.errorSummary ?? '沒有錯誤訊息'}`)
    }
  }
  // 主機
  const host = gate('主機', i.status, 'host', (d) => d.available)
  if (host) {
    if (host.stale) add('warn', 'host', `主機資料已過期（${host.computedAt ? ageText(Date.parse(host.computedAt), i.nowMs) : '時間不明'}）`)
    const worst = host.disks.reduce<BoardStatus['disks'][number] | null>((w, d) => (!w || d.percentUsed > w.percentUsed ? d : w), null)
    if (host.diskAlert && host.diskAlert !== 'ok') add(host.diskAlert, 'host', `硬碟${worst ? ` ${worst.drive}` : ''}：${describeForecast(host.diskForecast ?? null).text}`)
    else if (worst && worst.percentUsed >= 75) add(worst.percentUsed >= 90 ? 'crit' : 'warn', 'host', `硬碟 ${worst.drive} 已用 ${Math.round(worst.percentUsed)}%（剩 ${worst.freeGb.toFixed(1)} GB）`)
    const badC = host.containers.filter((c) => /exit|dead|unhealthy/i.test(`${c.status} ${c.health ?? ''}`))
    if (badC.length) add('warn', 'host', `${badC.length} 個容器不正常：${badC.slice(0, 3).map((c) => c.name).join('、')}${badC.length > 3 ? ' 等' : ''}`)
    if (host.memPercent !== null && host.memPercent >= 90) add('warn', 'host', `記憶體用了 ${Math.round(host.memPercent)}%`)
    if (host.cpuPercent !== null && host.cpuPercent >= 90) add('warn', 'host', `CPU 用了 ${Math.round(host.cpuPercent)}%`)
  }
  // 推送（與主機同一支 API；主機讀不到時推送也就無從判斷，不重複報）
  if (i.pusher) {
    checked.push('推送')
    if (i.pusher.level !== 'ok') add(i.pusher.level, 'push', `推送 ${i.pusher.bad} 項落後：${i.badFeeds.slice(0, 3).join('、') || '—'}${i.badFeeds.length > 3 ? ' 等' : ''}`)
  } else if (host) missing.push('推送')
  // Ollama
  const oll = gate('Ollama', i.usage, 'ollama', (d) => d.available)
  const ollLevel = oll?.forecast.level
  if (oll && (ollLevel === 'warn' || ollLevel === 'crit')) {
    const f = oll.forecast
    const when = f.emptyDate ? `預估 ${Number(f.emptyDate.slice(5, 7))}/${Number(f.emptyDate.slice(8, 10))} 用完` : f.daysUntilEmpty !== null ? `約 ${Math.round(f.daysUntilEmpty)} 天後用完` : '快用完'
    add(ollLevel, 'ollama', f.shortfallUsd !== null ? `Ollama 會在補點前用完（${when}，約缺 $${Math.round(f.shortfallUsd)}）` : `Ollama 餘額偏低（${when}）`)
  }
  // 首頁資料區塊太久沒更新
  for (const d of i.deadBlocks) add('warn', 'data', `${d.label}已 ${d.days} 天沒有更新`)

  reasons.sort((a, b) => (a.level === b.level ? 0 : a.level === 'crit' ? -1 : 1) || SOURCE_ORDER[a.source] - SOURCE_ORDER[b.source])
  const level: SystemLight['level'] = reasons.some((r) => r.level === 'crit') ? 'crit' : reasons.length ? 'warn' : checked.length ? 'ok' : 'unknown'
  let headline: string
  if (level === 'unknown') headline = '還沒有拿到系統狀態'
  else if (level === 'ok') headline = missing.length ? `${checked.join('、')}正常；${missing.join('、')}尚無資料` : `全部正常（${checked.join('、')}）`
  else headline = reasons[0]!.text + (reasons.length > 1 ? `　＋${reasons.length - 1} 項` : '')
  return { level, reasons, headline, checked, missing }
}

/** 推送落後的來源清單（level 不是 ok 的），給 systemLight 的 badFeeds；labelOf 把 feed 代號轉中文 */
export function badFeedNames(rows: PusherHealth[] | null | undefined, labelOf: (feed: string) => string): string[] {
  return (rows ?? []).filter((r) => r.level !== 'ok').map((r) => labelOf(r.feed))
}
