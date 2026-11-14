// 第 4 期 4-4：釘選、今天行程 feed、附近地點、會前比對來源的 fetcher（純邏輯在 pushTriggers.ts）。
import { apiFetchFood } from './foodApi'
import type { FoodPlace } from './foodMap'
import { buildIndex } from './graphInsights'
import { dossierIndex } from './dossier'
import { apiFetchHermesGraph } from './hermesGraphApi'
import { apiFetchTopicsData } from './statsApi'
import { parseCalendarFeed, parsePins, type CalendarFeed, type MeetingMatcher, makeMeetingMatcher, type Pin, type PinTarget } from './pushTriggers'

const API_BASE = import.meta.env.BASE_URL ?? '/'
const auth = (pw: string) => ({ 'x-admin-password': pw })

/** 建立釘選；201／200 都算成功（重複送回既有那筆）。失敗丟例外 */
export async function apiCreatePin(pw: string, target: PinTarget, dueDate: string): Promise<{ id: number }> {
  const r = await fetch(`${API_BASE}api/push/pins`, {
    method: 'POST', headers: { 'content-type': 'application/json', ...auth(pw) }, body: JSON.stringify({ ...target, dueDate }),
  })
  if (!r.ok) throw new Error(`Failed to create pin (${r.status})`)
  const j = (await r.json()) as { id?: unknown }
  return { id: typeof j.id === 'number' ? j.id : 0 }
}

/** 今天（含過期未完成）該提醒的釘選；後端還沒部署（404）回空 */
export async function apiFetchPinsDue(pw: string): Promise<Pin[]> {
  const r = await fetch(`${API_BASE}api/push/pins?due=today`, { headers: auth(pw) })
  if (r.status === 404) return []
  if (!r.ok) throw new Error('Failed to fetch pins')
  return parsePins(await r.json())
}

/** 標成完成；404（已完成或不存在）也視為已完成 */
export async function apiDonePin(pw: string, id: number): Promise<void> {
  const r = await fetch(`${API_BASE}api/push/pins/${id}/done`, { method: 'POST', headers: auth(pw) })
  if (!r.ok && r.status !== 404) throw new Error('Failed to mark pin done')
}

/** 今天的行程；available:false、404、格式不對都回 null（＝今天沒有行程）；其他失敗丟例外 */
export async function apiFetchCalendarToday(pw: string): Promise<CalendarFeed | null> {
  const r = await fetch(`${API_BASE}api/feed/calendar-today`, { headers: auth(pw) })
  if (r.status === 404) return null
  if (!r.ok) throw new Error('Failed to fetch calendar-today')
  return parseCalendarFeed(await r.json())
}

/** 地點資料（只在使用者按「附近」時才讀） */
export async function apiFetchPlaces(pw: string): Promise<FoodPlace[]> {
  return (await apiFetchFood(pw)).places
}

/** 會前卡的比對來源：知識題目名稱＋卷宗索引前 20 名；兩邊任一失敗就只用另一邊。
 *  回傳 `{ match }` 物件而不是函式本身：放進 React state 的函式會被當成 updater 執行（2026-11-14 白屏事故）。 */
export async function apiFetchMeetingMatcher(pw: string): Promise<{ match: MeetingMatcher }> {
  const [topics, graph] = await Promise.all([
    apiFetchTopicsData(pw).then((m) => m.value?.topics ?? [], () => []),
    apiFetchHermesGraph(pw).then((d) => (d.available && d.graph ? dossierIndex(buildIndex(d.graph), 20) : []), () => []),
  ])
  return { match: makeMeetingMatcher(topics.map((t) => ({ id: t.id, name: t.name })), graph.map((g) => ({ kind: g.kind, name: g.name }))) }
}
