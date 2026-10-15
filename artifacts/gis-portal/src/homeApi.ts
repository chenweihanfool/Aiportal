// 新首頁（HomeBoard）專用的讀取：只用既有的 API 端點，不新增後端。
// 與 boardApi.apiFetchHhiHistory 打同一個 /api/happiness/history，差別是「失敗會丟例外」——
// 原函式讀不到時回空陣列（卡片的小趨勢線不想報錯），新首頁要分得出「失敗」與「真的沒有資料」（§2.4 的 error／empty）。
import type { HhiHistoryPoint } from './boardApi'

const API_BASE = import.meta.env.BASE_URL ?? '/'

/** 幸福指數近 N 天（上限 365）每日顯示值；HTTP 錯誤丟例外，回應格式不對當作空陣列 */
export async function fetchHhiHistoryStrict(pw: string, days = 365): Promise<HhiHistoryPoint[]> {
  const r = await fetch(`${API_BASE}api/happiness/history?days=${days}`, { headers: { 'x-admin-password': pw } })
  if (!r.ok) throw new Error(`Failed to fetch happiness history (${r.status})`)
  const d = (await r.json()) as { history?: Array<{ date?: unknown; displayedScore?: unknown }> }
  return (d.history ?? [])
    .filter((h): h is { date: string; displayedScore: number } => typeof h.date === 'string' && typeof h.displayedScore === 'number' && Number.isFinite(h.displayedScore))
    .map((h) => ({ date: h.date, displayedScore: h.displayedScore }))
}
