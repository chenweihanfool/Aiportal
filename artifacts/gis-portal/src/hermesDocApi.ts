// /api/hermes-doc 的型別與 fetcher（後端：api-server routes/hermesDoc.ts）。
// 內容層：事件正文、概念／方法的出現脈絡。跟其他私領域 API 同一套閘：帶 x-admin-password。
const API_BASE = import.meta.env.BASE_URL ?? '/'

export type HermesDocKind = 'event' | 'concept' | 'method'

export interface HermesDocSource { type: 'diary' | 'attachment' | 'other'; path: string }

export interface HermesDocContext {
  eventId: string
  date: string
  title: string
  relation: string | null
  as: string | null          // 事件裡原本的措辭（被管線合併到正名之前）
  evidence: string | null    // 日記逐字引文（P2 起才有）
  excerpt: string            // 該事件正文開頭的摘錄
}

interface HermesDocBase {
  kind: HermesDocKind
  key: string
  title: string
  bodyMd: string
  truncated: boolean
  updatedAt: string
}
export interface HermesEventDoc extends HermesDocBase { kind: 'event'; date: string | null; sources: HermesDocSource[] }
export interface HermesAbstractionDoc extends HermesDocBase {
  kind: 'concept' | 'method'
  promoted: boolean
  aliases: string[]
  contexts: HermesDocContext[]
}
export type HermesDoc = HermesEventDoc | HermesAbstractionDoc

/** 404（尚未同步）回 null；其他失敗丟例外。 */
export async function apiFetchHermesDoc(adminPassword: string, kind: HermesDocKind, key: string): Promise<HermesDoc | null> {
  const r = await fetch(`${API_BASE}api/hermes-doc/${kind}/${encodeURIComponent(key)}`, {
    headers: { 'x-admin-password': adminPassword },
  })
  if (r.status === 404) return null
  if (!r.ok) throw new Error('Failed to fetch hermes doc')
  return r.json() as Promise<HermesDoc>
}
