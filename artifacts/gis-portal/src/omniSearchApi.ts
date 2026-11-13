// /api/search 的 fetcher（後端：api-server routes/search.ts；契約見 docs/search-api.md）。純邏輯在 omniSearch.ts。
import { parsePreview, parseSearchResponse, type SearchKind, type SearchPreview, type SearchResponse } from './omniSearch'

const API_BASE = import.meta.env.BASE_URL ?? '/'

/** 404（後端還沒部署）回 null；其他失敗丟例外；被取消時丟 AbortError。 */
export async function apiSearch(pw: string, q: string, kind: SearchKind | null, signal?: AbortSignal): Promise<SearchResponse | null> {
  const params = new URLSearchParams({ q })
  if (kind) params.set('kind', kind)
  const r = await fetch(`${API_BASE}api/search?${params.toString()}`, { headers: { 'x-admin-password': pw }, signal })
  if (r.status === 404) return null
  if (!r.ok) throw new Error('Failed to search')
  return parseSearchResponse(await r.json())
}

/** 找不到（404）或回應不合格回 null；其他失敗丟例外。 */
export async function apiSearchPreview(pw: string, kind: SearchKind, id: string, signal?: AbortSignal): Promise<SearchPreview | null> {
  const params = new URLSearchParams({ kind, id })
  const r = await fetch(`${API_BASE}api/search/preview?${params.toString()}`, { headers: { 'x-admin-password': pw }, signal })
  if (r.status === 404) return null
  if (!r.ok) throw new Error('Failed to load preview')
  return parsePreview(await r.json())
}

export interface SearchLogBody { q: string; kind: SearchKind | null; total: number; clickedKind: SearchKind | null; clickedId: string | null }

/** 紀錄失敗不影響畫面：永遠不丟例外。 */
export async function apiSearchLog(pw: string, body: SearchLogBody): Promise<void> {
  try {
    await fetch(`${API_BASE}api/search/log`, {
      method: 'POST', headers: { 'content-type': 'application/json', 'x-admin-password': pw }, body: JSON.stringify(body),
    })
  } catch { /* 失敗就算了 */ }
}
