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

/** 完整時間（hover 用）：`YYYY-MM-DD HH:mm（台北）`。 */
export function eventTimeTitle(createdAt: string | null | undefined): string | undefined {
  if (!createdAt) return undefined
  const p = parts(Date.parse(createdAt))
  return p ? `建立於 ${p.date} ${p.hm}（台北）` : undefined
}

/** 這一天的事件裡有幾筆有可用的建立時間（全沒有時，畫面要明標「尚無建立時間資料」）。 */
export function countWithTime(events: Array<{ createdAt: string | null }>): number {
  return events.filter(e => e.createdAt && !Number.isNaN(Date.parse(e.createdAt))).length
}
