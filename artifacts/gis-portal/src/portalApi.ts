// 入口網主頁用的型別與 API 呼叫（站台、儀表板摘要、幸福指數歷史、HERMES 戰情室資料、管理後台）。
import { type DiskAlertLevel, type DiskForecastInfo, type StorageItem } from './diskView'

// ─────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────
// 2026-09-21 起這裡存的是後端 /api/auth/verify 發的有效期 session token，
// 不再是使用者輸入的密碼原文——名字沒改是因為「解鎖狀態」的語意沒變，變
// 的只是底下存的憑證種類（見 apiVerifyPassword 的說明）。
export const UNLOCK_KEY = 'portal_unlocked'

// ─────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────
export interface SiteLink {
  label: string
  url: string
}

export interface SiteData {
  id: string
  name: string
  subtitle: string
  links: SiteLink[]
  worldXZ: [number, number]
  isPrivate: boolean
  subsystemId: string | null
}

export interface DashboardSummary {
  subsystemId: string
  name: string
  isPrivate: boolean
  status: 'ok' | 'error' | 'pending'
  errorMessage: string | null
  fetchedAt: string | null
  data: Record<string, unknown> | null
}

// ─────────────────────────────────────────────
// API helpers
// ─────────────────────────────────────────────
const API_BASE = import.meta.env.BASE_URL ?? '/'

/** 面向對應的子系統連結（要解鎖；伺服器對未解鎖回空清單）。2026-10-22 起不再有手動維護的工具連結。 */
export async function apiFetchSites(adminPassword: string): Promise<SiteData[]> {
  const r = await fetch(`${API_BASE}api/sites`, { headers: { 'x-admin-password': adminPassword } })
  if (!r.ok) throw new Error('Failed to fetch sites')
  const data = await r.json() as { sites: SiteData[] }
  return data.sites
}

export async function apiFetchDashboard(adminPassword: string | null): Promise<{ summaries: DashboardSummary[]; unlocked: boolean }> {
  const r = await fetch(`${API_BASE}api/dashboard`, {
    headers: adminPassword ? { 'x-admin-password': adminPassword } : {},
  })
  if (!r.ok) throw new Error('Failed to fetch dashboard')
  return r.json() as Promise<{ summaries: DashboardSummary[]; unlocked: boolean }>
}

export interface HappinessHistoryPoint {
  date: string
  finalScore: number
  displayedScore: number
  weakestComponent: string | null
}

export async function apiFetchHappinessHistory(adminPassword: string, days = 30): Promise<HappinessHistoryPoint[]> {
  const r = await fetch(`${API_BASE}api/happiness/history?days=${days}`, {
    headers: { 'x-admin-password': adminPassword },
  })
  if (!r.ok) throw new Error('Failed to fetch happiness history')
  const data = await r.json() as { history: HappinessHistoryPoint[] }
  return data.history
}

interface SocialIndexHistoryPoint {
  date: string
  socialScore: number
}

async function apiFetchSocialIndexHistory(adminPassword: string, days = 30): Promise<SocialIndexHistoryPoint[]> {
  const r = await fetch(`${API_BASE}api/social-index/history?days=${days}`, {
    headers: { 'x-admin-password': adminPassword },
  })
  if (!r.ok) throw new Error('Failed to fetch social-index history')
  const data = await r.json() as { history: SocialIndexHistoryPoint[] }
  return data.history
}

export interface HermesDiskInfo { drive: string; percentUsed: number; freeGb: number; totalGb: number }
export interface HermesContainerInfo { name: string; project: string | null; status: string; health: string | null }
export interface HermesScheduledTaskInfo { name: string; lastRunTime: string | null; lastTaskResult: number | null; schedule?: string | null }

export interface HermesStatusData {
  available: boolean
  cpuPercent: number | null
  memPercent: number | null
  disks: HermesDiskInfo[]
  containers: HermesContainerInfo[]
  /** 磁碟佔用分項、成長預估、警示等級（2026-10-01；舊後端沒有就是 undefined） */
  storage?: StorageItem[]
  diskForecast?: DiskForecastInfo
  diskAlert?: DiskAlertLevel
  scheduledTasks: HermesScheduledTaskInfo[]
  computedAt: string | null
  stale: boolean
}

export async function apiFetchHermesStatus(adminPassword: string): Promise<HermesStatusData> {
  // 這兩支 GET 掛在後端的 /api/hermes-status（沒有 /admin 前綴——只有寫入用
  // 的 POST 才在 /admin/ 底下，見 routes/hermesStatus.ts），這裡先前一直錯打
  // 成 /api/admin/hermes-status，兩支 fetch 從沒真的成功過（一律 404 →
  // catch 到 statusError，面板一直顯示「暫時無法取得資料」）。2026-09-06
  // 趁重寫 HERMES 戰情室順手修正。
  const r = await fetch(`${API_BASE}api/hermes-status`, {
    headers: { 'x-admin-password': adminPassword },
  })
  if (!r.ok) throw new Error('Failed to fetch hermes status')
  return r.json() as Promise<HermesStatusData>
}

export interface HermesActivityEntry { id: number; occurredAt: string; source: string; message: string }

export async function apiFetchHermesActivity(adminPassword: string, limit = 20): Promise<HermesActivityEntry[]> {
  const r = await fetch(`${API_BASE}api/hermes-activity?limit=${limit}`, {
    headers: { 'x-admin-password': adminPassword },
  })
  if (!r.ok) throw new Error('Failed to fetch hermes activity')
  const data = await r.json() as { activity: HermesActivityEntry[] }
  return data.activity
}

// L1~L5 日記→知識萃取管線監控（2026-09-20 起）。資料源自 HERMES 自己在
// NAS 上跑的 l{N}-agent-wrapper.py 寫出的 heartbeat.json，collect.ps1 逐
// 層 passthrough 給 api-server，health 是 api-server 讀取時依 lastRunTs +
// 預期班距換算出來的，不是這支腳本自己算——跟其他 Hermes 面板同一個「原
// 始資料 passthrough、衍生值讀取時算」原則。
export type HermesPipelineHealth = 'ok' | 'crit' | 'unknown'
export interface HermesPipelineLayerData {
  status: string | null
  lastRun: string | null
  lastRunTs: number | null
  processed: number | null
  committed: number | null
  failed: number | null
  backlog: number | null
  errorSummary: string | null
  durationSeconds: number | null
  /** 該層實際班表（jobs.json），舊 pusher 沒送就是 undefined */
  schedule?: string[]
  health: HermesPipelineHealth
}
export interface HermesPipelineData {
  available: boolean
  computedAt: string | null
  layers: Record<'L1' | 'L2' | 'L3' | 'L4' | 'L5', HermesPipelineLayerData>
}

export async function apiFetchHermesPipeline(adminPassword: string): Promise<HermesPipelineData> {
  const r = await fetch(`${API_BASE}api/hermes-pipeline`, {
    headers: { 'x-admin-password': adminPassword },
  })
  if (!r.ok) throw new Error('Failed to fetch hermes pipeline')
  return r.json() as Promise<HermesPipelineData>
}

// 每日一筆的操作型監控趨勢（2026-09-21 起）——collect.ps1 每次 push 就
// upsert「今天」那列，不是另外的排程快照，細節見後端 hermesStatusHistory.ts
// / hermesPipelineHistory.ts 的說明。兩支都是懶載入（面板展開/點開才 fetch），
// 跟既有的 30 天幸福指數歷史同一個節流考量。
export interface HermesStatusHistoryPoint {
  date: string
  cpuPercent: number | null
  memPercent: number | null
  worstDiskPercent: number | null
  diskUsedGb?: number | null
  diskFreeGb?: number | null
  diskTotalGb?: number | null
  storage?: StorageItem[] | null
  containersHealthy: number | null
  containersTotal: number | null
  tasksFailed: number | null
  tasksTotal: number | null
}

export async function apiFetchHermesStatusHistory(adminPassword: string, days = 30): Promise<HermesStatusHistoryPoint[]> {
  const r = await fetch(`${API_BASE}api/hermes-status/history?days=${days}`, {
    headers: { 'x-admin-password': adminPassword },
  })
  if (!r.ok) throw new Error('Failed to fetch hermes status history')
  const data = await r.json() as { history: HermesStatusHistoryPoint[] }
  return data.history
}

export interface HermesPipelineHistoryPoint {
  date: string
  L1: HermesPipelineHealth | null
  L2: HermesPipelineHealth | null
  L3: HermesPipelineHealth | null
  L4: HermesPipelineHealth | null
  L5: HermesPipelineHealth | null
}

export async function apiFetchHermesPipelineHistory(adminPassword: string, days = 14): Promise<HermesPipelineHistoryPoint[]> {
  const r = await fetch(`${API_BASE}api/hermes-pipeline/history?days=${days}`, {
    headers: { 'x-admin-password': adminPassword },
  })
  if (!r.ok) throw new Error('Failed to fetch hermes pipeline history')
  const data = await r.json() as { history: HermesPipelineHistoryPoint[] }
  return data.history
}

// HermesGraph* types + apiFetchHermesGraph moved to ./hermesGraphApi.ts so
// RelationshipUniverse.tsx (the full-page #graph route) can share them
// without a circular import back into this file.

// 回傳一個有效期限的 session token，不是密碼本身——後端 /api/auth/verify
// 驗證密碼正確後發 token，前端只存這個 token（見 PasswordModal／
// AdminAuthModal 兩處呼叫端），不再把密碼原文留在 localStorage 裡。同一個
// token 之後就當「密碼」用，放進所有 API 呼叫的 x-admin-password header——
// 後端的 isAuthorized() 同時接受密碼原文（給 collect.ps1 這類伺服器對伺服
// 器呼叫）跟這裡發的 token（給瀏覽器），兩條路徑互不干擾。
export async function apiVerifyPassword(password: string): Promise<string | null> {
  const r = await fetch(`${API_BASE}api/auth/verify`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ password }),
  })
  if (!r.ok) return null
  const data = await r.json() as { ok: boolean; token?: string }
  return data.ok && data.token ? data.token : null
}

// 回傳 Blob 而不是先 parse 成 JSON 再重新 stringify——內容本來就是伺服器
// 端已經序列化好的 JSON 文字，直接轉存成檔案不需要多一趟解析/重組。
export async function apiExportData(adminPassword: string): Promise<Blob> {
  const r = await fetch(`${API_BASE}api/export`, {
    headers: { 'x-admin-password': adminPassword },
  })
  if (!r.ok) throw new Error('Failed to export data')
  return r.blob()
}
