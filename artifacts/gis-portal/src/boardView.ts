// 桌面首頁儀表板用的純函式（無 React、可單元測試）。
// 幸福指數「分數怎麼來」：把原本寫死的公式說明換成當下實際數值，欄位與權重預設值跟
// HappinessHeroCard 完全相同（權重預設 27/18/15/15/13/12），算法就是後端 happinessIndex.ts 已經算好的欄位，
// 這裡只是把它們攤開：各維度「分數 × 權重 ＝ 貢獻分」，加起來是基礎分，再經短板修正與平滑得到顯示值。

export interface HhiRow {
  key: string
  label: string
  value: number | null
  weightPct: number
  /** 分數 × 權重（點數）；沒有分數為 null */
  points: number | null
}

export interface HhiBreakdown {
  displayed: number
  base: number | null
  weakestScore: number | null
  weakestLabel: string | null
  afterPenalty: number | null
  rows: HhiRow[]
  /** 各列貢獻分加總（只算有分數的），用來對照 base，讓人看出加權平均怎麼來 */
  pointsSum: number
  /** 是否有維度缺分數（缺的那列貢獻分不算，加總會小於基礎分） */
  hasMissing: boolean
  isFinal: boolean
  stale: boolean
}

const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null)

export function buildHhiBreakdown(data: Record<string, unknown> | undefined): HhiBreakdown | null {
  if (!data) return null
  const displayed = num(data['displayedScore'])
  if (displayed === null) return null
  const w = (data['weights'] ?? {}) as Record<string, unknown>
  const pct = (key: string, dflt: number) => Math.round((num(w[key]) ?? dflt) * 100)
  const spec: Array<[string, string, string, string, number]> = [
    ['lifeFreedom', '人生自由', 'lifeFreedomScore', 'lifeFreedomWeight', 0.27],
    ['fitness', '健身習慣', 'fitnessHabitScore', 'fitnessWeight', 0.18],
    ['calm', '生活從容', 'calmScore', 'calmWeight', 0.15],
    ['mind', '心智指標', 'mindScore', 'mindWeight', 0.15],
    ['social', '社交指標', 'socialScore', 'socialWeight', 0.13],
    ['travel', '旅遊生活', 'travelScore', 'travelWeight', 0.12],
  ]
  const rows: HhiRow[] = spec.map(([key, label, scoreKey, weightKey, dflt]) => {
    const value = num(data[scoreKey])
    const weightPct = pct(weightKey, dflt)
    return { key, label, value, weightPct, points: value === null ? null : Math.round(((value * weightPct) / 100) * 10) / 10 }
  })
  return {
    displayed,
    base: num(data['baseScore']),
    weakestScore: num(data['weakestScore']),
    weakestLabel: typeof data['weakestComponent'] === 'string' ? (data['weakestComponent'] as string) : null,
    afterPenalty: num(data['finalScore']),
    rows,
    pointsSum: Math.round(rows.reduce((s, r) => s + (r.points ?? 0), 0) * 10) / 10,
    hasMissing: rows.some((r) => r.value === null),
    isFinal: data['isSnapshotFinal'] === true,
    stale: data['usingStaleData'] === true,
  }
}

/** 拉低總分最多的維度＝「還能補多少分」最大的那列（權重 × 距離 100 的差）。 */
export function biggestDrag(rows: HhiRow[]): HhiRow | null {
  let best: HhiRow | null = null
  let bestGap = 0
  for (const r of rows) {
    if (r.value === null) continue
    const gap = ((100 - r.value) * r.weightPct) / 100
    if (gap > bestGap) {
      best = r
      bestGap = gap
    }
  }
  return best
}

// ── Ollama 用量卡片 ──────────────────────────────────
export interface UsageDayPoint { date: string; calls: number }
export interface UsageEntryPoint { enteredAt: string; balanceUsd: number }

export function formatUsd(n: number | null | undefined, digits = 2): string {
  return n === null || n === undefined || !Number.isFinite(n) ? '—' : `$${n.toFixed(digits)}`
}

export function formatCalls(n: number | null | undefined): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return '—'
  return n >= 10_000 ? `${(n / 1000).toFixed(1)}k` : String(Math.round(n))
}

/** 「用完日」顯示：M/D（約 N 天）；沒有就破折號 */
export function formatEmptyDay(emptyDate: string | null, days: number | null): string {
  if (!emptyDate || days === null) return '—'
  const [, m, d] = emptyDate.split('-')
  return `${Number(m)}/${Number(d)}（約 ${days.toFixed(days < 10 ? 1 : 0)} 天）`
}

export interface BalanceChartGeometry {
  /** 預測線：今天的餘額 → 用完（或補點日）時的餘額 */
  forecast: { x1: number; y1: number; x2: number; y2: number } | null
  /** 已輸入的餘額快照（時間序） */
  dots: Array<{ x: number; y: number }>
  todayX: number
  refillX: number | null
  zero: { x: number; y: number } | null
  yTicks: Array<{ v: number; y: number }>
}

/**
 * 餘額走勢圖的座標（一個比例尺算全部，標籤與線用同一把尺）。
 * x 軸＝天數：左邊是 pastDays 天前、todayIndex＝今天、右邊到補點日（沒有補點日就往後 21 天）。
 */
export function balanceChartGeometry(opts: {
  entries: UsageEntryPoint[]
  balanceUsd: number | null
  usdPerDay: number | null
  daysUntilEmpty: number | null
  daysToRefill: number | null
  capUsd: number
  now: Date
  width: number
  height: number
  pad: { l: number; r: number; t: number; b: number }
  pastDays?: number
}): BalanceChartGeometry {
  const pastDays = opts.pastDays ?? 14
  const ahead = Math.max(7, Math.round(opts.daysToRefill ?? 21))
  const span = pastDays + ahead
  const { width: W, height: H, pad } = opts
  const x = (dayOffset: number) => pad.l + ((W - pad.l - pad.r) * (dayOffset + pastDays)) / span
  const top = Math.max(10, Math.ceil(Math.max(opts.capUsd, opts.balanceUsd ?? 0, ...opts.entries.map((e) => e.balanceUsd)) / 10) * 10)
  const y = (usd: number) => pad.t + (H - pad.t - pad.b) * (1 - Math.min(Math.max(usd, 0), top) / top)
  const ticks: BalanceChartGeometry['yTicks'] = []
  for (let i = 0; i <= 4; i++) {
    const v = (top / 4) * i
    ticks.push({ v, y: y(v) })
  }
  const dots = opts.entries
    .map((e) => ({ off: (Date.parse(e.enteredAt) - opts.now.getTime()) / 86_400_000, usd: e.balanceUsd }))
    .filter((d) => d.off >= -pastDays - 0.5 && d.off <= 0.5)
    .map((d) => ({ x: x(d.off), y: y(d.usd) }))
  let forecast: BalanceChartGeometry['forecast'] = null
  let zero: BalanceChartGeometry['zero'] = null
  if (opts.balanceUsd !== null && opts.usdPerDay !== null && opts.usdPerDay > 0) {
    const stop = Math.min(ahead, opts.daysUntilEmpty ?? ahead)
    forecast = { x1: x(0), y1: y(opts.balanceUsd), x2: x(stop), y2: y(Math.max(0, opts.balanceUsd - opts.usdPerDay * stop)) }
    if (opts.daysUntilEmpty !== null && opts.daysUntilEmpty <= ahead) zero = { x: x(opts.daysUntilEmpty), y: y(0) }
  }
  return { forecast, dots, todayX: x(0), refillX: opts.daysToRefill !== null ? x(opts.daysToRefill) : null, zero, yTicks: ticks }
}

/** 近 N 天每日請求數長條的高度比例（0~1）；全 0 時回全 0，不除以 0。 */
export function dailyBars(days: UsageDayPoint[], n = 14): Array<{ date: string; calls: number; ratio: number }> {
  const last = days.slice(-n)
  const max = Math.max(0, ...last.map((d) => d.calls))
  return last.map((d) => ({ date: d.date, calls: d.calls, ratio: max > 0 ? d.calls / max : 0 }))
}
