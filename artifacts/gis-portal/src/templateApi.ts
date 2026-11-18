// /api/templates 的 fetcher（後端：api-server routes/templates.ts）。
// 下載與 /api/hermes-raw 同一套閘：帶 x-admin-password 取成 Blob，再由瀏覽器存檔。
const API_BASE = import.meta.env.BASE_URL ?? '/'

export interface TemplateVersionItem {
  id: string
  name: string
  family: string
  category: string
  docType: string
  subject: string | null
  version: string | null
  score: number
  olderVersions: number
}

export type TemplateFileResult =
  | { ok: true; blob: Blob; filename: string | null }
  | { ok: false; status: number; message: string }

/** 下載失敗的中文訊息（依狀態碼）。 */
export function templateFileError(status: number): string {
  switch (status) {
    case 403: return '需要解鎖私領域才能下載範本。'
    case 404: return '找不到這個範本檔'
    case 429: return '家中 NAS 忙碌中，請幾秒後再試。'
    case 503: return '範本資料夾尚未掛載'
    case 504: return '家中 NAS 暫時連不到'
    default: return '暫時無法取得範本，稍後再試。'
  }
}

/** Content-Disposition 的檔名：優先 RFC 5987 的 filename*，其次一般 filename。 */
export function parseContentDispositionFilename(header: string | null): string | null {
  if (!header) return null
  const star = /filename\*\s*=\s*UTF-8''([^;]+)/i.exec(header)
  if (star?.[1]) {
    try { return decodeURIComponent(star[1].trim()) } catch { return null }
  }
  const plain = /filename\s*=\s*"?([^";]+)"?/i.exec(header)
  return plain?.[1]?.trim() ?? null
}

const isRec = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)
const str = (v: unknown): string | null => (typeof v === 'string' ? v : null)
const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null)

function parseVersionItem(raw: unknown): TemplateVersionItem | null {
  if (!isRec(raw)) return null
  const id = str(raw.id)
  const name = str(raw.name)
  const family = str(raw.family)
  const category = str(raw.category)
  const docType = str(raw.docType)
  const score = num(raw.score)
  const olderVersions = num(raw.olderVersions)
  if (!id || !/^tpl_[0-9a-f]{10}$/.test(id) || !name || !family || !category || !docType) return null
  if (score === null || olderVersions === null || olderVersions < 0) return null
  const subject = str(raw.subject)
  const version = str(raw.version)
  return { id, name, family, category, docType, subject, version, score, olderVersions }
}

/** 下載範本檔案；404 與其他失敗都回 ok:false（不丟例外）。 */
export async function apiFetchTemplateFile(
  adminPassword: string, id: string, signal?: AbortSignal,
): Promise<TemplateFileResult> {
  let r: Response
  try {
    r = await fetch(`${API_BASE}api/templates/${encodeURIComponent(id)}/file`, {
      headers: { 'x-admin-password': adminPassword }, signal,
    })
  } catch {
    return { ok: false, status: 0, message: '網路錯誤，稍後再試。' }
  }
  if (r.ok) return { ok: true, blob: await r.blob(), filename: parseContentDispositionFilename(r.headers.get('content-disposition')) }
  return { ok: false, status: r.status, message: templateFileError(r.status) }
}

/** 同 family 的所有版本（新到舊）；找不到（404）回 null，其他失敗丟例外。 */
export async function apiFetchTemplateVersions(
  adminPassword: string, id: string, signal?: AbortSignal,
): Promise<TemplateVersionItem[] | null> {
  const r = await fetch(`${API_BASE}api/templates/${encodeURIComponent(id)}/versions`, {
    headers: { 'x-admin-password': adminPassword }, signal,
  })
  if (r.status === 404) return null
  if (!r.ok) throw new Error('Failed to fetch template versions')
  const raw = (await r.json()) as { items?: unknown } | null
  if (!isRec(raw) || !Array.isArray(raw.items)) return []
  return raw.items.map(parseVersionItem).filter((x): x is TemplateVersionItem => x !== null)
}

/** 觸發瀏覽器存檔（Object URL 用完即釋放）。 */
export function saveBlob(blob: Blob, filename: string): void {
  if (typeof document === 'undefined') return
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.rel = 'noopener'
  a.click()
  setTimeout(() => URL.revokeObjectURL(url), 0)
}
