// 日報「當日事件」時間軸的顯示用純函式（不碰 React／DOM／網路）。

const TAIPEI = 'Asia/Taipei'

function parts(ms: number): { date: string; hm: string } | null {
  if (Number.isNaN(ms)) return null
  const fmt = new Intl.DateTimeFormat('en-CA', { timeZone: TAIPEI, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
  const p = Object.fromEntries(fmt.formatToParts(new Date(ms)).map(x => [x.type, x.value]))
  return { date: `${p.year}-${p.month}-${p.day}`, hm: `${p.hour}:${p.minute}` }
}

/** 時間欄的文字：與該日同一天（台北）只顯示 `HH:mm`；建立在別天（例如 9/30 的事件 10/02 才建檔）顯示 `MM-DD HH:mm`；沒有／無法解析顯示 `—`。 */
export function eventTimeLabel(createdAt: string | null | undefined, dayKey: string): string {
  if (!createdAt) return '—'
  const p = parts(Date.parse(createdAt))
  if (!p) return '—'
  return p.date === dayKey ? p.hm : `${p.date.slice(5)} ${p.hm}`
}

const valid = (s: string | null | undefined): s is string => !!s && !Number.isNaN(Date.parse(s))

/** 要顯示的時間：寫進日記那一行的時間（writtenAt）優先；日記那行沒有時戳時退回萃取時刻（createdAt）。 */
export function eventDisplayTime(ev: { createdAt: string | null; writtenAt?: string | null }): { iso: string | null; source: 'diary' | 'extracted' | null } {
  if (valid(ev.writtenAt)) return { iso: ev.writtenAt, source: 'diary' }
  if (valid(ev.createdAt)) return { iso: ev.createdAt, source: 'extracted' }
  return { iso: null, source: null }
}

/** 完整時間（hover 用）：`寫進日記 YYYY-MM-DD HH:mm（台北）`；退回萃取時刻時註明。 */
export function eventTimeTitle(iso: string | null | undefined, source: 'diary' | 'extracted' | null = 'extracted'): string | undefined {
  if (!iso) return undefined
  const p = parts(Date.parse(iso))
  if (!p) return undefined
  return source === 'diary' ? `寫進日記 ${p.date} ${p.hm}（台北）` : `萃取於 ${p.date} ${p.hm}（台北；日記那行沒有時戳或非日記來源）`
}

/** 這一天的事件裡有幾筆有可用的時間（全沒有時，畫面要明標「尚無時間資料」）。 */
export function countWithTime(events: Array<{ createdAt: string | null; writtenAt?: string | null }>): number {
  return events.filter(e => eventDisplayTime(e).iso !== null).length
}
