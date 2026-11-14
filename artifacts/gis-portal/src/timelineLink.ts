// 時間軸深連結：#graph/timeline/day/YYYY-MM-DD?from=<encodeURIComponent 過的 hash，不含 #>
// 純函式：解析、驗證來源、組連結。

export const TIMELINE_HASH = '#graph/timeline'
const DAY_RE = /^\d{4}-\d{2}-\d{2}$/
const FROM_MAX = 200

export function isValidDay(s: string): boolean {
  if (!DAY_RE.test(s)) return false
  const [y, m, d] = s.split('-').map(Number)
  const dt = new Date(Date.UTC(y, m - 1, d))
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d
}

/** from 只接受相對 hash：不含 ://、不以 / 開頭、不是 scheme: 開頭（javascript: 等）、長度 ≤200；空字串＝首頁。不合法回 null。 */
export function safeFrom(raw: string | null | undefined): string | null {
  if (raw == null) return null
  if (raw.length > FROM_MAX) return null
  if (raw.includes('://')) return null
  if (raw.startsWith('/') || raw.startsWith('\\')) return null
  if (/^\s/.test(raw) || /[\u0000-\u001f]/.test(raw)) return null
  if (/^[a-z][a-z0-9+.-]*:/i.test(raw)) return null
  return raw
}

export interface TimelineRoute { day: string | null; from: string | null }

/** 不是時間軸路由回 null；日期不合法就當 #graph/timeline（day=null）。 */
export function parseTimelineHash(hash: string): TimelineRoute | null {
  const qi = hash.indexOf('?')
  const path = qi < 0 ? hash : hash.slice(0, qi)
  const query = qi < 0 ? '' : hash.slice(qi + 1)
  let day: string | null = null
  if (path === TIMELINE_HASH) day = null
  else {
    const m = /^#graph\/timeline\/day\/([^/]+)$/.exec(path)
    if (!m) return null
    let raw = m[1]
    try { raw = decodeURIComponent(raw) } catch { /* 維持原字串 */ }
    day = isValidDay(raw) ? raw : null
  }
  let from: string | null = null
  try { from = safeFrom(new URLSearchParams(query).get('from')) } catch { from = null }
  return { day, from }
}

/** 組深連結；日期不合法回 #graph/timeline；from 不合法就不帶。 */
export function buildTimelineDayLink(date: string, from: string | null | undefined): string {
  if (!isValidDay(date)) return TIMELINE_HASH
  const f = safeFrom(from)
  return `${TIMELINE_HASH}/day/${date}` + (f === null ? '' : `?from=${encodeURIComponent(f)}`)
}

/** 回去按鈕的字：來源是心得就寫「回到心得」。 */
export function backLabel(from: string): string {
  return from.startsWith('insight/') ? '‹ 回到心得' : '‹ 返回'
}
