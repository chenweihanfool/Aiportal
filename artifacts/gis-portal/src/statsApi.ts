// STATUS 右欄（2.88.0）用的三個讀取：搜尋統計、推送統計、最近搜尋，加上知識頁 feed（算「知識庫這週」與「你的更正」）。
// fetcher 都是模組層級常數／函式，給 useAsync 用（避免每次 render 重抓）。解析在 statusAside.ts。
import { parseTopics, type TopicsData } from './knowledgeView'
import { parsePushStats, parseRecent, parseSearchStats, type PushStats, type SearchStats } from './statusAside'

const API_BASE = import.meta.env.BASE_URL ?? '/'
/** 包一層：後端還沒部署（404）或內容不合法時 value 是 null——這跟「還在載入」（useAsync 的 data 是 null）要分得開 */
export interface Maybe<T> { value: T | null }

const auth = (pw: string) => ({ headers: { 'x-admin-password': pw } })

/** 後端還沒部署（404）value 為 null；其他失敗丟例外 */
export async function apiFetchSearchStats(pw: string, days: number): Promise<Maybe<SearchStats>> {
  const r = await fetch(`${API_BASE}api/search/stats?days=${days}`, auth(pw))
  if (r.status === 404) return { value: null }
  if (!r.ok) throw new Error('Failed to fetch search stats')
  return { value: parseSearchStats(await r.json()) }
}

export async function apiFetchPushStats(pw: string, days: number): Promise<Maybe<PushStats>> {
  const r = await fetch(`${API_BASE}api/push/stats?days=${days}`, auth(pw))
  if (r.status === 404) return { value: null }
  if (!r.ok) throw new Error('Failed to fetch push stats')
  return { value: parsePushStats(await r.json()) }
}

/** 最近搜尋（新到舊、去重）；後端還沒部署（404）回空；其他失敗丟例外 */
export async function apiFetchRecentSearches(pw: string, limit = 5): Promise<string[]> {
  const r = await fetch(`${API_BASE}api/search/recent?limit=${limit}`, auth(pw))
  if (r.status === 404) return []
  if (!r.ok) throw new Error('Failed to fetch recent searches')
  return parseRecent(await r.json(), limit)
}

/** 知識頁 feed；available＝false（還沒推）回 null */
export async function apiFetchTopicsData(pw: string): Promise<Maybe<TopicsData>> {
  const r = await fetch(`${API_BASE}api/feed/topics`, auth(pw))
  if (!r.ok) throw new Error('Failed to fetch topics')
  return { value: parseTopics(await r.json()) }
}

// 模組層級常數：useAsync 以 fetcher 的參照當依賴，不能在 render 裡現做
export const fetchSearchStats7 = (pw: string) => apiFetchSearchStats(pw, 7)
export const fetchSearchStats14 = (pw: string) => apiFetchSearchStats(pw, 14)
export const fetchPushStats14 = (pw: string) => apiFetchPushStats(pw, 14)
export const fetchRecentSearches = (pw: string) => apiFetchRecentSearches(pw, 5)
