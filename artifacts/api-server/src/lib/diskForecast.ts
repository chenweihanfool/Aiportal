// 硬碟「預估幾天後寫滿」——純函式，讀取時用歷史現算，不存結果（衍生值讀取時算）。
// 資料點＝每天一筆（該天最後一次快照）的已用 GB；用最小平方法對「天數」做線性迴歸，
// 取斜率當成長速度。刻意不做花俏模型：VPS 上的成長主要是知識庫（vault／附件／DB）慢慢長大，
// 偶發的刪檔會讓斜率變小或轉負，此時就如實回報「近期沒有成長」，不硬預測。

export interface DiskPoint {
  date: string // YYYY-MM-DD
  usedGb: number | null
}

export interface DiskForecast {
  /** 參與計算的天數（有資料的點數）；不足 MIN_POINTS 時 insufficient=true */
  basedOnDays: number
  insufficient: boolean
  /** 平均每天增加的 GB（可能為負）；insufficient 時為 null */
  growthGbPerDay: number | null
  /** 以目前剩餘空間／成長速度估計；沒在成長（斜率 <= 閾值）或資料不足時為 null */
  daysUntilFull: number | null
}

export const MIN_POINTS = 3
export const WINDOW_DAYS = 14
const MIN_GROWTH_GB_PER_DAY = 0.005 // 5 MB／天以下視為沒有成長（量測雜訊）

function dayIndex(date: string): number {
  return Math.round(Date.parse(`${date}T00:00:00Z`) / 86_400_000)
}

export function forecastDisk(points: DiskPoint[], freeGb: number | null): DiskForecast {
  const valid = points
    .filter((p): p is { date: string; usedGb: number } => p.usedGb !== null && Number.isFinite(p.usedGb) && Number.isFinite(dayIndex(p.date)))
    .sort((a, b) => a.date.localeCompare(b.date))
    .slice(-WINDOW_DAYS)
  const span = valid.length > 0 ? dayIndex(valid[valid.length - 1]!.date) - dayIndex(valid[0]!.date) : 0
  if (valid.length < MIN_POINTS || span < MIN_POINTS - 1) {
    return { basedOnDays: valid.length, insufficient: true, growthGbPerDay: null, daysUntilFull: null }
  }
  const xs = valid.map((p) => dayIndex(p.date))
  const ys = valid.map((p) => p.usedGb)
  const n = valid.length
  const mx = xs.reduce((a, b) => a + b, 0) / n
  const my = ys.reduce((a, b) => a + b, 0) / n
  let num = 0
  let den = 0
  for (let i = 0; i < n; i++) {
    num += (xs[i]! - mx) * (ys[i]! - my)
    den += (xs[i]! - mx) ** 2
  }
  const slope = den === 0 ? 0 : num / den
  const growth = Math.round(slope * 1000) / 1000
  const daysUntilFull =
    freeGb !== null && Number.isFinite(freeGb) && growth > MIN_GROWTH_GB_PER_DAY ? Math.max(0, Math.round(freeGb / growth)) : null
  return { basedOnDays: n, insufficient: false, growthGbPerDay: growth, daysUntilFull }
}

/** 磁碟警示等級：使用率或預估天數任一達標就升級。門檻是「VPS 容量有限」的保守值。 */
export type DiskAlertLevel = "ok" | "warn" | "crit"

export function diskAlertLevel(percentUsed: number | null, freeGb: number | null, daysUntilFull: number | null): DiskAlertLevel {
  if ((percentUsed !== null && percentUsed >= 90) || (freeGb !== null && freeGb < 3) || (daysUntilFull !== null && daysUntilFull < 14)) return "crit"
  if ((percentUsed !== null && percentUsed >= 80) || (daysUntilFull !== null && daysUntilFull < 45)) return "warn"
  return "ok"
}

// 佔用分項：[{label, bytes}]。只收合法的、上限 30 筆，label 截 60 字——這是量測資料不是使用者輸入，
// 但仍不信任形狀（舊 pusher 不送、壞資料不要讓整包快照被拒）。
export function parseStorage(v: unknown): Array<{ label: string; bytes: number; note?: string }> | null {
  if (!Array.isArray(v)) return null;
  const out: Array<{ label: string; bytes: number; note?: string }> = [];
  for (const it of v.slice(0, 30)) {
    if (!it || typeof it !== "object") continue;
    const { label, bytes, note } = it as { label?: unknown; bytes?: unknown; note?: unknown };
    if (typeof label !== "string" || !label.trim() || typeof bytes !== "number" || !Number.isFinite(bytes) || bytes < 0) continue;
    const row: { label: string; bytes: number; note?: string } = { label: label.trim().slice(0, 60), bytes: Math.round(bytes) };
    // note：例如「可回收 17.3 GB」——只收非空字串，截 80 字
    if (typeof note === "string" && note.trim()) row.note = note.trim().slice(0, 80);
    out.push(row);
  }
  return out;
}

