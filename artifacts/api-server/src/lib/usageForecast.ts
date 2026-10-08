// Ollama 用量預估——純函式，讀取時用歷史現算，不存結果（跟 diskForecast 同一原則）。
//
// 兩個資料來源，誠實分開：
// 1. HERMES 每日請求數（state.db 聚合）：只含 HERMES 這台 VPS 發出的請求，不含帳號其他用量來源。
// 2. 使用者手動輸入的餘額快照：ollama.com 沒有可從本機取得的額度端點，這是唯一的「真實餘額」。
//    相鄰兩筆的餘額差 ÷ 天數 ＝ 實際每天花多少（含所有來源），所以有兩筆以上時優先用它；
//    只有一筆時，退回「近 7 日平均請求數 × 單價」的粗估，並在回傳裡標明 source，前端要標「粗估」。

export interface UsageDay {
  date: string // YYYY-MM-DD（台北日）
  calls: number // 該天 HERMES 發出的請求總數
}

export interface BalanceEntry {
  enteredAt: string // ISO
  balanceUsd: number
}

/**
 * 粗估單價（美元／請求）。來源：2026-10-08 使用者貼的 ollama.com Usage 截圖，
 * Monthly credits used $50.69 ÷ 本月全部請求 21,377（deepseek 19,794＋glm 1,567＋gemma 14＋kimi 1＋minimax 1）。
 * 請求大小差很多（長上下文貴），所以這只是第一筆餘額快照進來之前的暫代值。
 */
export const DEFAULT_USD_PER_CALL = 50.69 / 21_377

export const MIN_CALL_DAYS = 3
export const WINDOW_DAYS = 7
const MIN_OBSERVE_HOURS = 12 // 兩筆快照至少相隔這麼久才拿來算速度，避免短時間雜訊
const OBSERVE_LOOKBACK_DAYS = 21

export type UsageLevel = "ok" | "warn" | "crit"

export interface OllamaForecast {
  /** 近 7 個「已結束的日」的平均每天請求數（不含今天，今天還沒過完）；資料不足為 null */
  callsPerDay: number | null
  callsBasedOnDays: number
  usdPerDay: number | null
  /** observed＝兩筆以上餘額快照的實測；estimated＝請求數×單價的粗估；none＝兩者都沒有 */
  source: "observed" | "estimated" | "none"
  usdPerCall: number
  balanceUsd: number | null
  daysUntilEmpty: number | null
  emptyDate: string | null
  daysToRefill: number | null
  /** 照目前速度，補點日之前會缺多少錢（沒缺或無法算為 null） */
  shortfallUsd: number | null
  level: UsageLevel
}

function dayIndex(date: string): number {
  return Math.round(Date.parse(`${date}T00:00:00Z`) / 86_400_000)
}

function addDays(date: string, n: number): string {
  return new Date((dayIndex(date) + n) * 86_400_000).toISOString().slice(0, 10)
}

/** 從餘額快照算「實測每天花多少」。補點／加值（餘額變大）會重新起算，不把加值當成負的花費。 */
export function observedUsdPerDay(entries: BalanceEntry[], now: Date): number | null {
  const sorted = entries
    .filter((e) => Number.isFinite(e.balanceUsd) && Number.isFinite(Date.parse(e.enteredAt)))
    .sort((a, b) => Date.parse(a.enteredAt) - Date.parse(b.enteredAt))
  if (sorted.length < 2) return null
  const cutoff = now.getTime() - OBSERVE_LOOKBACK_DAYS * 86_400_000
  let start = sorted.length - 1
  for (let i = sorted.length - 1; i > 0; i--) {
    if (sorted[i]!.balanceUsd > sorted[i - 1]!.balanceUsd) break // 這筆之前有補點／加值，之前的不算
    if (Date.parse(sorted[i - 1]!.enteredAt) < cutoff) break
    start = i - 1
  }
  const first = sorted[start]!
  const last = sorted[sorted.length - 1]!
  const hours = (Date.parse(last.enteredAt) - Date.parse(first.enteredAt)) / 3_600_000
  if (hours < MIN_OBSERVE_HOURS) return null
  const rate = ((first.balanceUsd - last.balanceUsd) / hours) * 24
  return rate > 0 ? Math.round(rate * 1000) / 1000 : null
}

export function forecastOllama(input: {
  days: UsageDay[]
  entries: BalanceEntry[]
  refillAt: string | null // 下次補點日 YYYY-MM-DD
  today: string // 台北今天 YYYY-MM-DD
  now?: Date
  usdPerCall?: number
}): OllamaForecast {
  const usdPerCall = input.usdPerCall ?? DEFAULT_USD_PER_CALL
  const now = input.now ?? new Date()

  const done = input.days
    .filter((d) => d.date < input.today && Number.isFinite(d.calls) && Number.isFinite(dayIndex(d.date)))
    .sort((a, b) => a.date.localeCompare(b.date))
    .slice(-WINDOW_DAYS)
  const callsPerDay = done.length >= MIN_CALL_DAYS ? Math.round(done.reduce((s, d) => s + d.calls, 0) / done.length) : null

  const sortedEntries = [...input.entries]
    .filter((e) => Number.isFinite(e.balanceUsd) && Number.isFinite(Date.parse(e.enteredAt)))
    .sort((a, b) => Date.parse(a.enteredAt) - Date.parse(b.enteredAt))
  const latest = sortedEntries.length ? sortedEntries[sortedEntries.length - 1]! : null
  const balanceUsd = latest ? latest.balanceUsd : null

  const observed = observedUsdPerDay(input.entries, now)
  let usdPerDay: number | null = null
  let source: OllamaForecast["source"] = "none"
  if (observed !== null) {
    usdPerDay = observed
    source = "observed"
  } else if (callsPerDay !== null) {
    usdPerDay = Math.round(callsPerDay * usdPerCall * 1000) / 1000
    source = "estimated"
  }

  const daysToRefill = input.refillAt && Number.isFinite(dayIndex(input.refillAt)) ? Math.max(0, dayIndex(input.refillAt) - dayIndex(input.today)) : null
  let daysUntilEmpty: number | null = null
  let emptyDate: string | null = null
  let shortfallUsd: number | null = null
  if (balanceUsd !== null && usdPerDay !== null && usdPerDay > 0) {
    daysUntilEmpty = Math.max(0, Math.round((balanceUsd / usdPerDay) * 10) / 10)
    emptyDate = addDays(input.today, Math.floor(daysUntilEmpty))
    if (daysToRefill !== null && daysUntilEmpty < daysToRefill) {
      shortfallUsd = Math.round((usdPerDay * daysToRefill - balanceUsd) * 100) / 100
    }
  }

  let level: UsageLevel = "ok"
  if (daysUntilEmpty !== null) {
    if (daysUntilEmpty < 3) level = "crit"
    else if (shortfallUsd !== null) level = "warn"
  }

  return { callsPerDay, callsBasedOnDays: done.length, usdPerDay, source, usdPerCall, balanceUsd, daysUntilEmpty, emptyDate, daysToRefill, shortfallUsd, level }
}

// ── 推送內容的消毒（HERMES 推的是量測資料，但仍不信任形狀：壞資料不要讓整包被拒）──
export interface SanitizedUsageDay {
  date: string
  models: Record<string, { calls: number; inputTokens: number; outputTokens: number; cacheReadTokens: number }>
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/
const nonNeg = (v: unknown): number => (typeof v === "number" && Number.isFinite(v) && v >= 0 ? Math.round(v) : 0)

export function sanitizeUsageDays(v: unknown, maxDays = 62): SanitizedUsageDay[] {
  if (!Array.isArray(v)) return []
  const out: SanitizedUsageDay[] = []
  for (const it of v.slice(0, maxDays)) {
    if (!it || typeof it !== "object") continue
    const { date, models } = it as { date?: unknown; models?: unknown }
    if (typeof date !== "string" || !DATE_RE.test(date) || !Number.isFinite(dayIndex(date))) continue
    if (!models || typeof models !== "object" || Array.isArray(models)) continue
    const clean: SanitizedUsageDay["models"] = {}
    for (const [name, m] of Object.entries(models as Record<string, unknown>).slice(0, 30)) {
      if (!name.trim() || name.length > 80 || !m || typeof m !== "object") continue
      const r = m as Record<string, unknown>
      clean[name.trim()] = { calls: nonNeg(r["calls"]), inputTokens: nonNeg(r["inputTokens"]), outputTokens: nonNeg(r["outputTokens"]), cacheReadTokens: nonNeg(r["cacheReadTokens"]) }
    }
    out.push({ date, models: clean })
  }
  return out
}

export interface SanitizedBalance {
  balanceUsd: number
  capUsd: number
  refillAt: string | null
  monthUsedUsd: number | null
  note: string | null
}

/** 手動輸入的餘額。回傳字串＝錯誤訊息（給使用者看的人話），物件＝通過。 */
export function sanitizeBalance(v: unknown): SanitizedBalance | string {
  if (!v || typeof v !== "object") return "請填餘額"
  const r = v as Record<string, unknown>
  const bal = r["balanceUsd"]
  if (typeof bal !== "number" || !Number.isFinite(bal) || bal < 0 || bal > 100_000) return "餘額要是 0 以上的數字（美元）"
  const cap = r["capUsd"] === undefined || r["capUsd"] === null ? 60 : r["capUsd"]
  if (typeof cap !== "number" || !Number.isFinite(cap) || cap <= 0 || cap > 100_000) return "補點上限要是大於 0 的數字"
  let refillAt: string | null = null
  if (r["refillAt"] !== undefined && r["refillAt"] !== null && r["refillAt"] !== "") {
    if (typeof r["refillAt"] !== "string" || !DATE_RE.test(r["refillAt"]) || !Number.isFinite(dayIndex(r["refillAt"]))) return "補點日格式要是 YYYY-MM-DD"
    refillAt = r["refillAt"]
  }
  let monthUsed: number | null = null
  if (r["monthUsedUsd"] !== undefined && r["monthUsedUsd"] !== null && r["monthUsedUsd"] !== "") {
    if (typeof r["monthUsedUsd"] !== "number" || !Number.isFinite(r["monthUsedUsd"]) || r["monthUsedUsd"] < 0) return "本月已用要是 0 以上的數字"
    monthUsed = r["monthUsedUsd"]
  }
  const note = typeof r["note"] === "string" && r["note"].trim() ? r["note"].trim().slice(0, 120) : null
  return { balanceUsd: bal, capUsd: cap, refillAt, monthUsedUsd: monthUsed, note }
}
