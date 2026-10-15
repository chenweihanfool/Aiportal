// 🍜 美食地圖的 /api/hermes-places 讀取（只讀；寫入一律由 HERMES 的管線推上來）。
// 比照 hermesGraphApi.ts：私領域資料用 x-admin-password（解鎖後的 token）。
import { parseFoodPayload, type FoodData } from './foodMap'

const API_BASE = import.meta.env.BASE_URL ?? '/'

/** 把 GET /api/hermes-places 的回應轉成 FoodData；格式不對或 available 非 true 一律當作沒有資料 */
export function foodDataFromResponse(raw: unknown): FoodData {
  if (!raw || typeof raw !== 'object') return { available: false, places: [], receivedAt: null }
  const r = raw as Record<string, unknown>
  if (r['available'] !== true) return { available: false, places: [], receivedAt: null }
  const data = parseFoodPayload({ places: r['places'], receivedAt: r['receivedAt'] })
  return { ...data, available: data.places.length > 0 }
}

export async function apiFetchFood(pw: string): Promise<FoodData> {
  const r = await fetch(`${API_BASE}api/hermes-places`, { headers: { 'x-admin-password': pw } })
  if (!r.ok) throw new Error(`Failed to fetch food (${r.status})`)
  return foodDataFromResponse(await r.json())
}

/** 資料時間顯示成台北時間「10/15 19:05」；null 或壞掉的時間回 null */
export function formatReceivedAt(iso: string | null): string | null {
  if (!iso) return null
  const t = Date.parse(iso)
  if (!Number.isFinite(t)) return null
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Taipei', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).formatToParts(new Date(t))
  const get = (type: string) => parts.find(p => p.type === type)?.value ?? ''
  return `${get('month')}/${get('day')} ${get('hour')}:${get('minute')}`
}
