// 新首頁（HomeBoard）專用的讀取：只用既有的 API 端點，不新增後端。
// 與 boardApi.apiFetchHhiHistory 打同一個 /api/happiness/history，差別是「失敗會丟例外」——
// 原函式讀不到時回空陣列（卡片的小趨勢線不想報錯），新首頁要分得出「失敗」與「真的沒有資料」（§2.4 的 error／empty）。
import type { HhiHistoryPoint } from './boardApi'

const API_BASE = import.meta.env.BASE_URL ?? '/'

/**
 * 歷史的一天；後端（2026-10-15 另一個 session 做、尚未部署）會多給選填的 components：
 * key 同 dimensions.ts（lifeFreedom／fitness／calm／mind／social／travel），值＝當天面向卡上的分數（0–100，null＝當天沒資料）。
 * 型別先放在這裡（不動 boardApi.ts），之後後端接口上線再收斂。
 */
export interface HhiHistoryDay extends HhiHistoryPoint {
  components?: Record<string, number | null>
}

/** components 形狀不對（不是物件、是陣列）就當作沒有；單一面向的值不是有限數字就當 null */
export function parseComponents(v: unknown): Record<string, number | null> | undefined {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return undefined
  const out: Record<string, number | null> = {}
  for (const [k, x] of Object.entries(v as Record<string, unknown>)) out[k] = typeof x === 'number' && Number.isFinite(x) ? x : null
  return out
}

/** 幸福指數近 N 天（上限 365）每日顯示值；HTTP 錯誤丟例外，回應格式不對當作空陣列。有 components 欄位就一併帶回 */
export async function fetchHhiHistoryStrict(pw: string, days = 365): Promise<HhiHistoryDay[]> {
  const r = await fetch(`${API_BASE}api/happiness/history?days=${days}`, { headers: { 'x-admin-password': pw } })
  if (!r.ok) throw new Error(`Failed to fetch happiness history (${r.status})`)
  const d = (await r.json()) as { history?: Array<{ date?: unknown; displayedScore?: unknown; components?: unknown }> }
  const rows = Array.isArray(d.history) ? d.history : []
  return rows
    .filter((h): h is { date: string; displayedScore: number; components?: unknown } => !!h && typeof h.date === 'string' && typeof h.displayedScore === 'number' && Number.isFinite(h.displayedScore))
    .map((h) => {
      const components = parseComponents(h.components)
      return components ? { date: h.date, displayedScore: h.displayedScore, components } : { date: h.date, displayedScore: h.displayedScore }
    })
}
