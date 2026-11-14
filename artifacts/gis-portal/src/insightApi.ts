// /api/insights 的 fetcher（後端：api-server，契約見任務單 insight-tree-web）。純邏輯在 insightTree.ts。
import { parseInsightDetail, parseInsights, type InsightData, type InsightDetail } from './insightTree'

const API_BASE = import.meta.env.BASE_URL ?? '/'

const EMPTY: InsightData = { total: 0, thisMonth: 0, clusters: [], insights: [] }

/** 404（後端還沒部署）當成還沒有心得；格式壞掉或其他失敗丟例外（畫面顯示可重試） */
export async function apiFetchInsights(pw: string): Promise<InsightData> {
  const r = await fetch(`${API_BASE}api/insights`, { headers: { 'x-admin-password': pw } })
  if (r.status === 404) return EMPTY
  if (!r.ok) throw new Error('Failed to load insights')
  const d = parseInsights(await r.json())
  if (!d) throw new Error('Bad insights payload')
  return d
}

/** 找不到（404）或回應不合格回 null；其他失敗丟例外；被取消時丟 AbortError */
export async function apiFetchInsightDetail(pw: string, id: string, signal?: AbortSignal): Promise<InsightDetail | null> {
  const r = await fetch(`${API_BASE}api/insights/${encodeURIComponent(id)}`, { headers: { 'x-admin-password': pw }, signal })
  if (r.status === 404) return null
  if (!r.ok) throw new Error('Failed to load insight')
  return parseInsightDetail(await r.json())
}
