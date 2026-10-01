// 戰情室「硬碟容量」面板的純函式（格式化、分項占比、與過去比較、預估文字）。
// 預估本身由後端 diskForecast.ts 算好給前端，這裡只負責把結果講成人話。

export interface StorageItem { label: string; bytes: number; note?: string }
export interface DiskForecastInfo {
  basedOnDays: number
  insufficient: boolean
  growthGbPerDay: number | null
  daysUntilFull: number | null
}
export type DiskAlertLevel = 'ok' | 'warn' | 'crit'

export function formatBytes(n: number): string {
  const abs = Math.abs(n)
  if (abs >= 1e9) return `${(n / 1e9).toFixed(abs >= 1e10 ? 1 : 2)} GB`
  if (abs >= 1e6) return `${(n / 1e6).toFixed(abs >= 1e8 ? 0 : 1)} MB`
  if (abs >= 1e3) return `${Math.round(n / 1e3)} KB`
  return `${Math.round(n)} B`
}

export function formatSignedBytes(n: number): string {
  if (Math.abs(n) < 1e5) return '持平'
  return `${n > 0 ? '+' : '−'}${formatBytes(Math.abs(n))}`
}

export interface StorageShare {
  label: string
  bytes: number
  /** 佔「已用空間」的比例 0~1（沒有已用總量時佔分項總和） */
  share: number
  /** 與基準日相比的變化（bytes）；沒有基準資料為 null */
  delta: number | null
  /** 附註，例如「可回收 17.3 GB」 */
  note?: string
}

/** 分項由大到小；若提供已用總量，差額另列「其他（未歸類）」，讓使用者看得到沒被量到的部分。 */
export function storageShares(items: StorageItem[], usedBytes: number | null, past: StorageItem[] | null): StorageShare[] {
  if (items.length === 0) return []
  const sum = items.reduce((a, b) => a + b.bytes, 0)
  const base = usedBytes !== null && usedBytes >= sum ? usedBytes : sum
  const pastMap = past ? new Map(past.map(p => [p.label, p.bytes])) : null
  const rows: StorageShare[] = items.map(it => ({
    label: it.label,
    bytes: it.bytes,
    share: base > 0 ? it.bytes / base : 0,
    delta: pastMap ? (pastMap.has(it.label) ? it.bytes - pastMap.get(it.label)! : null) : null,
    ...(it.note ? { note: it.note } : {}),
  }))
  if (usedBytes !== null && usedBytes > sum) {
    rows.push({ label: '其他（未歸類）', bytes: usedBytes - sum, share: (usedBytes - sum) / base, delta: null })
  }
  return rows.sort((a, b) => b.bytes - a.bytes)
}

export function describeForecast(f: DiskForecastInfo | null): { text: string; tone: 'ok' | 'warn' | 'crit' | 'dim' } {
  if (!f || f.insufficient) {
    return { text: `預估需要至少 3 天的歷史資料（目前 ${f?.basedOnDays ?? 0} 天），過幾天回來看`, tone: 'dim' }
  }
  const g = f.growthGbPerDay ?? 0
  if (f.daysUntilFull === null) {
    return g < -0.005
      ? { text: `近 ${f.basedOnDays} 天用量在下降（每天 ${g.toFixed(2)} GB），沒有寫滿的風險`, tone: 'ok' }
      : { text: `近 ${f.basedOnDays} 天沒有明顯成長（每天 ${g.toFixed(2)} GB 以內），暫無寫滿風險`, tone: 'ok' }
  }
  const rate = g >= 1 ? `${g.toFixed(1)} GB` : `${Math.round(g * 1000)} MB`
  const when = f.daysUntilFull >= 365 ? '一年以上' : f.daysUntilFull >= 60 ? `約 ${Math.round(f.daysUntilFull / 30)} 個月` : `約 ${f.daysUntilFull} 天`
  return {
    text: `近 ${f.basedOnDays} 天平均每天增加 ${rate}，照這個速度${when}後寫滿`,
    tone: f.daysUntilFull < 14 ? 'crit' : f.daysUntilFull < 45 ? 'warn' : 'ok',
  }
}

/** 從歷史挑「約 N 天前」最接近的一筆（含 storage）；沒有 ≥ minGapDays 的就回 null。 */
export function pickBaseline<T extends { date: string }>(history: T[], today: string, daysAgo: number, minGapDays = 3): T | null {
  const t = Date.parse(`${today}T00:00:00Z`)
  let best: T | null = null
  let bestDiff = Infinity
  for (const h of history) {
    const gap = Math.round((t - Date.parse(`${h.date}T00:00:00Z`)) / 86_400_000)
    if (gap < minGapDays) continue
    const diff = Math.abs(gap - daysAgo)
    if (diff < bestDiff) { best = h; bestDiff = diff }
  }
  return best
}
