// /api/hermes-timeline 的型別與 fetcher（後端：api-server routes/hermesTimeline.ts）。
// 跟 hermesGraphApi.ts 同一套私領域閘：帶 x-admin-password（解鎖後的 token）。
const API_BASE = import.meta.env.BASE_URL ?? '/'

export type TimelineLevel = 'day' | 'week' | 'month' | 'quarter' | 'year'

export interface TimelineEventChip { id: string; title: string; createdAt: string | null; writtenAt?: string | null }   // createdAt＝事件檔建立時間（ISO）；舊資料為 null

export interface TimelineItem {
  level: TimelineLevel
  periodKey: string
  startDate: string
  endDate: string
  title: string
  summary: string
  hasReport: boolean          // false = 占位列（該期沒有報告）
  rangeInferred: boolean      // 涵蓋區間是推算的
  periodNote: string | null   // 例：季報自述「涵蓋順延為 5–7 月」
  generation: number | null
  eventCount: number
  events: TimelineEventChip[] // 僅 day 級；清單最多 8 個、單筆詳情給全部；依建立時間新→舊
  reportScore: ReportScore | null   // 僅 day 級；＝每日報告分數（日報 📊 段，五項各 0–4，總分×5＝0–100；舊日報沒有＝null）
}

export interface ReportScore {
  total: number
  parts: Array<{ key: string; label: string; value: number; note: string }>
}

export interface TimelineChild {
  level: TimelineLevel
  periodKey: string
  startDate: string
  title: string
  summary: string
}

export interface TimelineDetail extends TimelineItem {
  bodyMd: string
  children: TimelineChild[]
}

export interface TimelineListResponse {
  level: TimelineLevel
  items: TimelineItem[]
  nextCursor: string | null
}

async function getJson<T>(path: string, password: string): Promise<T> {
  const r = await fetch(`${API_BASE}api/${path}`, { headers: { 'x-admin-password': password } })
  if (!r.ok) throw new Error(`timeline request failed: ${r.status}`)
  return r.json() as Promise<T>
}

export function apiFetchTimelineList(
  password: string, level: TimelineLevel, cursor: string | null, limit = 30,
): Promise<TimelineListResponse> {
  const q = new URLSearchParams({ level, limit: String(limit) })
  if (cursor) q.set('cursor', cursor)
  return getJson<TimelineListResponse>(`hermes-timeline?${q.toString()}`, password)
}

export function apiFetchTimelineDetail(
  password: string, level: TimelineLevel, periodKey: string,
): Promise<TimelineDetail> {
  return getJson<TimelineDetail>(
    `hermes-timeline/${encodeURIComponent(level)}/${encodeURIComponent(periodKey)}`, password,
  )
}
