// AI 編織層的 fetcher（3.17.0）：feed insight-weave v1、確認／否決紀錄。純邏輯在 insightWeave.ts。
import { parseWeave, type Verdict, type VerdictRow, type WeavePayload } from './insightWeave'

const API_BASE = import.meta.env.BASE_URL ?? '/'
const PAGE = 500

/** 404、available:false、沒有 payload 或格式壞掉都回 null（畫面就不出現編織）；其他失敗丟例外 */
export async function apiFetchWeave(pw: string, signal?: AbortSignal): Promise<WeavePayload | null> {
  const r = await fetch(`${API_BASE}api/feed/insight-weave`, { headers: { 'x-admin-password': pw }, signal })
  if (r.status === 404) return null
  if (!r.ok) throw new Error('Failed to load insight-weave')
  const j: unknown = await r.json()
  if (typeof j !== 'object' || j === null) return null
  const o = j as { available?: unknown; payload?: unknown }
  if (o.available === false || o.payload == null) return null
  return parseWeave(o.payload)
}

/** 分頁抓全部紀錄（每頁最多 500、id 遞增）；一頁不滿 500 或游標沒前進就停 */
export async function apiFetchVerdicts(pw: string, signal?: AbortSignal): Promise<VerdictRow[]> {
  const all: VerdictRow[] = []
  let after: string | number | null = null
  for (let n = 0; n < 200; n++) {
    const q: string = after === null ? '' : `?after=${encodeURIComponent(String(after))}`
    const r = await fetch(`${API_BASE}api/insights/weave/verdicts${q}`, { headers: { 'x-admin-password': pw }, signal })
    if (r.status === 404) return all
    if (!r.ok) throw new Error('Failed to load weave verdicts')
    const j = (await r.json()) as { verdicts?: unknown }
    const page = Array.isArray(j.verdicts) ? j.verdicts : []
    let last: string | number | null = null
    for (const x of page) {
      if (typeof x !== 'object' || x === null) continue
      const v = x as { id?: unknown; itemId?: unknown; verdict?: unknown }
      if (typeof v.itemId !== 'string' || (v.verdict !== 'ok' && v.verdict !== 'no' && v.verdict !== 'undo')) continue
      const id = typeof v.id === 'string' || typeof v.id === 'number' ? v.id : undefined
      all.push({ id, itemId: v.itemId, verdict: v.verdict })
      if (id !== undefined) last = id
    }
    if (page.length < PAGE || last === null || last === after) break
    after = last
  }
  return all
}

/** 成功是 201；其他狀態丟例外 */
export async function apiPostVerdict(pw: string, itemId: string, verdict: Verdict): Promise<void> {
  const r = await fetch(`${API_BASE}api/insights/weave/verdicts`, {
    method: 'POST', headers: { 'x-admin-password': pw, 'content-type': 'application/json' }, body: JSON.stringify({ itemId, verdict }),
  })
  if (r.status !== 201) throw new Error(`Failed to save verdict (${r.status})`)
}
