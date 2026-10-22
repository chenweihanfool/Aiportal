// 架構頁各節點的真實處理數字（feed kb-arch-stats v1；推送端 kb-pipeline scripts/arch-stats-pusher.py，每 10 分鐘）。
// 這裡只負責取回、整理與判斷新舊；數字怎麼算在推送端（kbcore/arch_stats.py），每個數字的意思寫在 hint。
const API_BASE = import.meta.env.BASE_URL ?? '/'

export interface ArchMetric {
  label: string
  value: number | string
  hint?: string
  tone?: 'warn' | 'crit'
}
export interface ArchNodeStats {
  metrics: ArchMetric[]
  error: string | null
}
export interface ArchStats {
  computedAt: string
  /** 節點 id → 數字；推送端沒算的節點不在表裡 */
  nodes: Record<string, ArchNodeStats>
}

/** 超過這麼久沒更新就標「數字已過期」（推送是每 10 分鐘） */
export const STALE_MIN = 30

export function parseArchStats(raw: unknown): ArchStats | null {
  const root = (raw as { available?: boolean; payload?: unknown } | null) ?? null
  if (!root || root.available !== true) return null
  const p = root.payload as { computedAt?: unknown; nodes?: unknown } | null
  if (!p || typeof p.computedAt !== 'string' || typeof p.nodes !== 'object' || p.nodes === null) return null
  const nodes: Record<string, ArchNodeStats> = {}
  for (const [id, v] of Object.entries(p.nodes as Record<string, { metrics?: unknown; error?: unknown }>)) {
    const metrics = Array.isArray(v?.metrics)
      ? (v.metrics as ArchMetric[]).filter((m) => m && typeof m.label === 'string' && (typeof m.value === 'number' || typeof m.value === 'string'))
      : []
    nodes[id] = { metrics, error: typeof v?.error === 'string' ? v.error : null }
  }
  return { computedAt: p.computedAt, nodes }
}

export async function apiFetchArchStats(pw: string): Promise<ArchStats | null> {
  const r = await fetch(`${API_BASE}api/feed/kb-arch-stats`, { headers: { 'x-admin-password': pw } })
  if (!r.ok) throw new Error('Failed to fetch arch stats')
  return parseArchStats(await r.json())
}

export function formatValue(v: number | string): string {
  return typeof v === 'number' ? v.toLocaleString('en-US') : v
}

/** 節點卡片上放的摘要：前兩個數字 */
export function cardMetrics(s: ArchNodeStats | undefined): ArchMetric[] {
  return s && !s.error ? s.metrics.slice(0, 2) : []
}

export function ageMinutes(computedAt: string, now: Date): number | null {
  const t = Date.parse(computedAt)
  return Number.isFinite(t) ? Math.max(0, Math.round((now.getTime() - t) / 60000)) : null
}

export function isStale(computedAt: string, now: Date): boolean {
  const a = ageMinutes(computedAt, now)
  return a === null || a > STALE_MIN
}
