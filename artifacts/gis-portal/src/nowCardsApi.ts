// 「現在用得上」卡片回饋 API 的 fetcher（後端 routes/pushFeedback.ts；契約見 docs/push-feedback-api.md）。
import type { CardKind, FeedbackState } from './nowCards'

const API_BASE = import.meta.env.BASE_URL ?? '/'

export type FeedbackAction = 'shown' | 'opened' | 'useful' | 'useless' | 'later'

export interface FeedbackBody { cardKey: string; cardKind: CardKind; action: FeedbackAction; forDate: string }

/** 送出失敗丟例外，由呼叫端決定要不要吞掉 */
export async function apiPostFeedback(pw: string, body: FeedbackBody): Promise<void> {
  const r = await fetch(`${API_BASE}api/push/feedback`, {
    method: 'POST', headers: { 'content-type': 'application/json', 'x-admin-password': pw }, body: JSON.stringify(body),
  })
  if (!r.ok) throw new Error('Failed to post feedback')
}

/** 後端還沒部署（404）回空狀態；其他失敗丟例外 */
export async function apiFetchFeedback(pw: string): Promise<FeedbackState> {
  const r = await fetch(`${API_BASE}api/push/feedback`, { headers: { 'x-admin-password': pw } })
  if (r.status === 404) return { suppressed: [], later: [] }
  if (!r.ok) throw new Error('Failed to fetch feedback')
  const j = (await r.json()) as Partial<FeedbackState> | null
  return {
    suppressed: Array.isArray(j?.suppressed) ? j.suppressed.filter((x): x is string => typeof x === 'string') : [],
    later: Array.isArray(j?.later) ? j.later.filter((x) => x && typeof x.cardKey === 'string' && typeof x.until === 'string') : [],
  }
}
