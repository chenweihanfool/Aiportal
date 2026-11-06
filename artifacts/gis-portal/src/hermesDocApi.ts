// /api/hermes-doc 的型別與 fetcher（後端：api-server routes/hermesDoc.ts）。
// 內容層：事件正文、概念／方法的出現脈絡。跟其他私領域 API 同一套閘：帶 x-admin-password。
const API_BASE = import.meta.env.BASE_URL ?? '/'

export type HermesDocKind = 'event' | 'concept' | 'method' | 'source' | 'topic'

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

// ── 來源可追溯（2.77.0）：kind=source（一個主題來源一筆）、kind=topic（一個主題一筆，meta.quotes＝腳註原文摘錄） ──
export type SourceTextFrom = 'original' | 'diary' | 'note' | 'event' | 'none'

export interface HermesSourceMeta {
  type: string | null
  case: string | null
  date: string | null
  originName: string | null
  /** 人類/ 之下的相對路徑，給 /api/hermes-raw 用 */
  rawPath: string | null
  textFrom: SourceTextFrom
  evidence: string | null
  topics: Array<{ id: string; name: string }>
}
export interface HermesSourceDoc extends HermesDocBase { kind: 'source'; sourcePath: string | null; meta: HermesSourceMeta }

export interface HermesTopicQuote { k: number; ref: number; text: string | null; fromOriginal: boolean; weak: boolean }
export interface HermesTopicDoc extends HermesDocBase { kind: 'topic'; sourcePath: string | null; meta: { quotes: HermesTopicQuote[] } }

export interface HermesSearchResult { key: string; title: string; meta: Partial<HermesSourceMeta>; snippet: string; hitAt: number }

/** 404（尚未同步）回 null；其他失敗丟例外。 */
export async function apiFetchHermesDoc(adminPassword: string, kind: 'event' | 'concept' | 'method', key: string): Promise<HermesDoc | null>
export async function apiFetchHermesDoc(adminPassword: string, kind: 'source', key: string): Promise<HermesSourceDoc | null>
export async function apiFetchHermesDoc(adminPassword: string, kind: 'topic', key: string): Promise<HermesTopicDoc | null>
export async function apiFetchHermesDoc(adminPassword: string, kind: HermesDocKind, key: string): Promise<HermesDoc | HermesSourceDoc | HermesTopicDoc | null> {
  const r = await fetch(`${API_BASE}api/hermes-doc/${kind}/${encodeURIComponent(key)}`, {
    headers: { 'x-admin-password': adminPassword },
  })
  if (r.status === 404) return null
  if (!r.ok) throw new Error('Failed to fetch hermes doc')
  return r.json() as Promise<HermesDoc | HermesSourceDoc | HermesTopicDoc>
}

/** 原文全文搜尋；q 去空白後為空時不打 API、直接回空陣列。失敗丟例外。 */
export async function apiSearchHermesDocs(adminPassword: string, q: string, signal?: AbortSignal): Promise<HermesSearchResult[]> {
  const query = q.trim()
  if (!query) return []
  const r = await fetch(`${API_BASE}api/hermes-doc-search?q=${encodeURIComponent(query)}`, {
    headers: { 'x-admin-password': adminPassword },
    signal,
  })
  if (!r.ok) throw new Error('Failed to search hermes docs')
  const raw = (await r.json()) as { results?: HermesSearchResult[] } | null
  return Array.isArray(raw?.results) ? raw.results : []
}

export type RawFileResult =
  | { ok: true; blob: Blob }
  | {
      ok: false
      reason: 'not-found' | 'not-mounted' | 'nas-offline' | 'too-large' | 'unsupported' | 'forbidden' | 'error'
      message: string
    }

/** 原檔（/api/hermes-raw）：帶 header 取成 Blob，做法同 attachmentApi。 */
export async function apiFetchHermesRaw(adminPassword: string, path: string, signal?: AbortSignal): Promise<RawFileResult> {
  let r: Response
  try {
    r = await fetch(`${API_BASE}api/hermes-raw?path=${encodeURIComponent(path)}`, { headers: { 'x-admin-password': adminPassword }, signal })
  } catch {
    return { ok: false, reason: 'error', message: '網路錯誤，稍後再試。' }
  }
  if (r.ok) return { ok: true, blob: await r.blob() }
  switch (r.status) {
    case 403: return { ok: false, reason: 'forbidden', message: '需要解鎖私領域才能開原檔。' }
    case 404: return { ok: false, reason: 'not-found', message: 'VPS 與家中 NAS 都找不到這個原檔（可能已移動或改名）。' }
    case 413: return { ok: false, reason: 'too-large', message: '原檔過大，不提供開啟。' }
    case 415: return { ok: false, reason: 'unsupported', message: '這種檔案類型不提供開啟。' }
    case 503: return { ok: false, reason: 'not-mounted', message: '原檔資料夾尚未掛載。' }
    case 504: return { ok: false, reason: 'nas-offline', message: '家中 NAS 暫時連不到（VPN 可能斷線），可先複製路徑回家再開。' }
    default: return { ok: false, reason: 'error', message: '暫時無法取得原檔，稍後再試。' }
  }
}
