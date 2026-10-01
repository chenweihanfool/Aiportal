// /api/hermes-attachment 的 fetcher（後端：api-server routes/hermesAttachment.ts）。
// 檔案要帶 x-admin-password，<img src> 帶不了 header，所以用 fetch 取成 Blob 再轉 object URL。
const API_BASE = import.meta.env.BASE_URL ?? '/'

export type AttachmentResult =
  | { ok: true; blob: Blob }
  | { ok: false; reason: 'not-found' | 'not-mounted' | 'too-large' | 'unsupported' | 'forbidden' | 'error'; message: string }

export async function apiFetchAttachment(adminPassword: string, path: string, signal?: AbortSignal): Promise<AttachmentResult> {
  let r: Response
  try {
    r = await fetch(`${API_BASE}api/hermes-attachment?path=${encodeURIComponent(path)}`, { headers: { 'x-admin-password': adminPassword }, signal })
  } catch {
    return { ok: false, reason: 'error', message: '網路錯誤，稍後再試。' }
  }
  if (r.ok) return { ok: true, blob: await r.blob() }
  switch (r.status) {
    case 403: return { ok: false, reason: 'forbidden', message: '需要解鎖私領域才能查看附件。' }
    case 404: return { ok: false, reason: 'not-found', message: '找不到這個附件（可能還沒同步到伺服器，或檔案已被移動）。' }
    case 413: return { ok: false, reason: 'too-large', message: '檔案過大，不提供預覽。' }
    case 415: return { ok: false, reason: 'unsupported', message: '這種檔案類型不提供預覽。' }
    case 503: return { ok: false, reason: 'not-mounted', message: '伺服器尚未掛載附件資料夾。' }
    default: return { ok: false, reason: 'error', message: '暫時無法取得附件，稍後再試。' }
  }
}
