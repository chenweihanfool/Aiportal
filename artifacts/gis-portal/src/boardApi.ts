// 桌面首頁儀表板自己用的 API 讀寫（型別只列這裡用到的欄位，不依賴 App.tsx，避免 App ↔ DesktopBoard 循環匯入）。
import type { DiskAlertLevel, DiskForecastInfo, StorageItem } from './diskView'

const API_BASE = import.meta.env.BASE_URL ?? '/'

const authHeaders = (pw: string) => ({ 'x-admin-password': pw })

export interface UsageForecast {
  callsPerDay: number | null
  callsBasedOnDays: number
  usdPerDay: number | null
  source: 'observed' | 'estimated' | 'none'
  usdPerCall: number
  balanceUsd: number | null
  daysUntilEmpty: number | null
  emptyDate: string | null
  daysToRefill: number | null
  shortfallUsd: number | null
  level: 'ok' | 'warn' | 'crit'
}

export interface UsageData {
  available: boolean
  today: string
  days: Array<{ date: string; calls: number }>
  last7Days: Record<string, number>
  balance: { enteredAt: string; balanceUsd: number; capUsd: number; refillAt: string | null; monthUsedUsd: number | null; note: string | null } | null
  entries: Array<{ enteredAt: string; balanceUsd: number }>
  forecast: UsageForecast
  scope: string
}

export async function apiFetchUsage(pw: string): Promise<UsageData> {
  const r = await fetch(`${API_BASE}api/hermes-usage`, { headers: authHeaders(pw) })
  if (!r.ok) throw new Error('Failed to fetch usage')
  return r.json() as Promise<UsageData>
}

export interface BalanceInput { balanceUsd: number; capUsd?: number; refillAt?: string; monthUsedUsd?: number }

/** 成功回 null；失敗回人話錯誤訊息（後端驗證訊息原樣帶出）。 */
export async function apiPostBalance(pw: string, body: BalanceInput): Promise<string | null> {
  try {
    const r = await fetch(`${API_BASE}api/admin/ollama-balance`, {
      method: 'POST',
      headers: { ...authHeaders(pw), 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    if (r.ok) return null
    const j = (await r.json().catch(() => null)) as { message?: string } | null
    return j?.message ?? `儲存失敗（${r.status}）`
  } catch {
    return '連不上伺服器，稍後再試'
  }
}

export interface BoardStatus {
  available: boolean
  cpuPercent: number | null
  memPercent: number | null
  disks: Array<{ drive: string; percentUsed: number; freeGb: number; totalGb: number }>
  containers: Array<{ name: string; status: string; health: string | null }>
  diskForecast?: DiskForecastInfo
  diskAlert?: DiskAlertLevel
  storage?: StorageItem[]
  stale: boolean
  computedAt: string | null
}

export async function apiFetchBoardStatus(pw: string): Promise<BoardStatus> {
  const r = await fetch(`${API_BASE}api/hermes-status`, { headers: authHeaders(pw) })
  if (!r.ok) throw new Error('Failed to fetch status')
  return r.json() as Promise<BoardStatus>
}

export interface BoardPipelineLayer { status: string | null; lastRunTs: number | null; schedule?: string[]; health: 'ok' | 'crit' | 'unknown'; errorSummary: string | null }
export interface BoardPipeline { available: boolean; layers: Record<'L1' | 'L2' | 'L3' | 'L4' | 'L5', BoardPipelineLayer> }

export async function apiFetchBoardPipeline(pw: string): Promise<BoardPipeline> {
  const r = await fetch(`${API_BASE}api/hermes-pipeline`, { headers: authHeaders(pw) })
  if (!r.ok) throw new Error('Failed to fetch pipeline')
  return r.json() as Promise<BoardPipeline>
}

export interface BoardDiskPoint { date: string; diskUsedGb: number | null }

/** 每日快照的「已用 GB」，硬碟曲線用；讀不到就回空陣列，不擋住卡片。 */
export async function apiFetchBoardDiskHistory(pw: string, days = 30): Promise<BoardDiskPoint[]> {
  const r = await fetch(`${API_BASE}api/hermes-status/history?days=${days}`, { headers: authHeaders(pw) })
  if (!r.ok) return []
  const d = (await r.json()) as { history?: Array<{ date: string; diskUsedGb?: number | null }> }
  return (d.history ?? []).map(h => ({ date: h.date, diskUsedGb: h.diskUsedGb ?? null }))
}

export interface HhiHistoryPoint { date: string; displayedScore: number }

/** 幸福指數近 N 天每日顯示值（儀表板卡片的小趨勢線用）；讀不到回空陣列。 */
export async function apiFetchHhiHistory(pw: string, days = 30): Promise<HhiHistoryPoint[]> {
  const r = await fetch(`${API_BASE}api/happiness/history?days=${days}`, { headers: authHeaders(pw) })
  if (!r.ok) return []
  const d = (await r.json()) as { history?: Array<{ date: string; displayedScore: number }> }
  return (d.history ?? []).filter(h => typeof h.displayedScore === 'number').map(h => ({ date: h.date, displayedScore: h.displayedScore }))
}

// 💡 想法庫（kb-pipeline 的 ideas-pusher 推上來，入口網只顯示）
export type IdeaStatus = 'new' | 'evaluating' | 'doing' | 'done' | 'shelved' | 'dropped'
export interface IdeaItem {
  id: string
  title: string
  category: string | null
  dimension: string | null
  source: string | null
  why: string | null
  value: number | null
  effort: number | null
  status: IdeaStatus
  bornAt: string
  lastMentioned: string
  mentions: number
  backfill: boolean
  days: string[]
  history: Array<{ status: string; at: string }>
  score: number | null
  scoreWhy: string[]
  weakBoost: boolean
}
export interface IdeasData {
  available: boolean
  generatedAt: string | null
  receivedAt: string | null
  weakest: string | null
  ideas: IdeaItem[]
  top: string[]
  weeks: Array<{ weekStart: string; born: number; done: number }>
  /** 心智分數（想法版，第四期並行中）：今天現算 */
  mind: IdeasMind | null
  /** 近 30 天每晚存下的想法版（ideas）與現行日記篇數版（diary）原始分數 */
  mindShadow: Array<{ date: string; ideas: number | null; diary: number | null }>
}
export interface IdeasMind {
  score: number
  birth: { score: number; born7: number; baseline: number; weekly: number[] }
  action: { score: number; done28: number; eligible: number; rate: number; target: number }
  formula: string
}

export async function apiFetchIdeas(pw: string): Promise<IdeasData> {
  const r = await fetch(`${API_BASE}api/hermes-ideas`, { headers: authHeaders(pw) })
  if (!r.ok) throw new Error('Failed to fetch ideas')
  return r.json() as Promise<IdeasData>
}
