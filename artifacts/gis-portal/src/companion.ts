// 首頁「陪伴」區塊與今日最划算的一件事：純函式（網路只有 apiFetchCompanion）。
// 使用者 2026-10-30：「其他建議 … 2-5照你建議做」（很久沒聯絡、今日最划算的一件事、什麼事讓你變好、歷年今天）。
// 資料來自 feed companion（kb-pipeline companion-pusher.py），不新增模型呼叫，也不要使用者手動輸入。
import { biggestDrag, type HhiRow } from './boardView'
import type { HhiHistoryPoint } from './boardApi'

const API_BASE = import.meta.env.BASE_URL ?? '/'

export interface CompanionData {
  computedAt: string
  date: string
  onThisDay: Array<{ date: string; kind: 'event' | 'report'; title: string }>
  quietPeople: Array<{ name: string; lastDate: string; daysQuiet: number; events: number; lastEvent?: string | null }>
  socialDays: Array<{ date: string; people: number }>
}

export function parseCompanion(raw: unknown): CompanionData | null {
  const root = raw as { available?: boolean; payload?: unknown } | null
  if (!root || root.available !== true) return null
  const p = root.payload as Partial<CompanionData> | null
  if (!p || typeof p.computedAt !== 'string' || !Array.isArray(p.onThisDay) || !Array.isArray(p.quietPeople) || !Array.isArray(p.socialDays)) return null
  return p as CompanionData
}

/** 還沒部署（feed 不存在／沒資料）回 null；連不上丟錯 */
export async function apiFetchCompanion(pw: string): Promise<CompanionData | null> {
  const r = await fetch(`${API_BASE}api/feed/companion`, { headers: { 'x-admin-password': pw } })
  if (r.status === 404) return null
  if (!r.ok) throw new Error('Failed to fetch companion')
  return parseCompanion(await r.json())
}

const MOVES: Record<string, string> = {
  fitness: '今天動一下，排一次訓練',
  calm: '清掉一件逾期或快到期的任務',
  mind: '把一個想法往前推一步，或記下一個新想法',
  social: '約家人或朋友見個面、打通電話',
  travel: '排一趟小旅行，或去吃一家想吃的店',
}

/** 今日最划算的一件事：挑補起來對總分幫助最大的面向；社交優先點名最久沒聯絡的人。財務主要看市場、權重又最大，留著會天天推它，不列入 */
export function bestMove(rows: HhiRow[], c: CompanionData | null): string | null {
  const r = biggestDrag(rows.filter((x) => x.key in MOVES))
  if (!r || r.value === null) return null
  const gain = ((10 * r.weightPct) / 100).toFixed(1)
  const who = r.key === 'social' ? c?.quietPeople[0] : undefined
  const act = who ? `聯絡一下${who.name}（${who.daysQuiet} 天沒聯絡了）` : MOVES[r.key]
  return act ? `今天最划算：${act}。「${r.label}」每多 10 分，總分約加 ${gain} 分。` : null
}

export const MIN_INSIGHT_DAYS = 10

export interface ActivityInsight { ready: boolean; text: string }

const nextDay = (d: string) => new Date(Date.parse(`${d}T12:00:00Z`) + 86_400_000).toISOString().slice(0, 10)

/**
 * 什麼事讓你變好：有和家人朋友互動的日子 vs 沒有的日子，當天到隔天幸福指數平均變化多少。
 * 只比連續兩天都有分數的日子；2026-10-30 換尺之前的分數不比；兩邊各滿 MIN_INSIGHT_DAYS 天才下結論。
 */
export function activityInsight(history: readonly HhiHistoryPoint[], c: CompanionData | null): ActivityInsight {
  if (!c) return { ready: false, text: '資料累積中。' }
  const met = new Set(c.socialDays.map((d) => d.date))
  const score = new Map(history.filter((h) => h.date >= SCALE_SINCE).map((h) => [h.date.slice(0, 10), h.displayedScore]))
  const yes: number[] = []
  const no: number[] = []
  for (const [d, v] of score) {
    const next = score.get(nextDay(d))
    if (next !== undefined) (met.has(d) ? yes : no).push(next - v)
  }
  if (yes.length < MIN_INSIGHT_DAYS || no.length < MIN_INSIGHT_DAYS) {
    return { ready: false, text: `資料累積中：有見人 ${yes.length}／${MIN_INSIGHT_DAYS} 天、沒見人 ${no.length}／${MIN_INSIGHT_DAYS} 天。` }
  }
  const avg = (xs: number[]) => xs.reduce((s, x) => s + x, 0) / xs.length
  const diff = Math.round((avg(yes) - avg(no)) * 10) / 10
  if (Math.abs(diff) < 0.5) return { ready: true, text: `和家人朋友互動的日子，隔天幸福指數和平常差不多（共 ${yes.length + no.length} 天）。` }
  return { ready: true, text: `和家人朋友互動的日子，隔天幸福指數比沒互動時${diff > 0 ? '多' : '少'} ${Math.abs(diff)} 分（共 ${yes.length + no.length} 天）。` }
}

/** 幸福指數換成絕對分的第一天（之前的分數是另一把尺） */
export const SCALE_SINCE = '2026-10-30'
