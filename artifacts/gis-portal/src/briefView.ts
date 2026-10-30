// 首頁 🌙 明日報告：讀 feed hermes-reports（kb-pipeline report-publish.py），挑要顯示的那一份。
// 使用者 2026-10-30：「前一天晚上就整理明天要注意的報告給我 早上沒空看 要前一晚看才有用」。
const API_BASE = import.meta.env.BASE_URL ?? '/'

export interface Report { key: string; title: string; date: string; bodyMd: string; createdAt: string }
export interface Brief { bodyMd: string; date: string; label: string }

export function parseReports(raw: unknown): Report[] | null {
  const root = raw as { available?: boolean; payload?: { reports?: unknown } | null } | null
  if (!root) return null
  if (root.available !== true) return []
  return Array.isArray(root.payload?.reports) ? (root.payload.reports as Report[]) : null
}

/** 還沒部署（feed 不存在）當成沒有報告；連不上丟錯 */
export async function apiFetchReports(pw: string): Promise<Report[]> {
  const r = await fetch(`${API_BASE}api/feed/hermes-reports`, { headers: { 'x-admin-password': pw } })
  if (r.status === 404) return []
  if (!r.ok) throw new Error('Failed to fetch reports')
  return parseReports(await r.json()) ?? []
}

/** 取日期最新、還沒過期的明日報告：針對明天＝「明天」，針對今天＝「今天的報告」；更舊的不顯示，免得過時內容佔首頁 */
export function pickBrief(reports: readonly Report[] | null, todayIso: string): Brief | null {
  const r = (reports ?? []).filter((x) => x.key === 'tomorrow' && x.date >= todayIso).sort((a, b) => b.date.localeCompare(a.date))[0]
  if (!r) return null
  const md = `${Number(r.date.slice(5, 7))}/${Number(r.date.slice(8, 10))}`
  return { bodyMd: r.bodyMd, date: r.date, label: r.date === todayIso ? `今天的報告（${md}）` : `明天 ${md}` }
}
