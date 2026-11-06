// 首頁主動推播主題知識（feed topic-nudges v1，契約見 kb-pipeline）：純函式（網路只有 apiFetchTopicNudges）。
// 今天卡（今天用得上）、明日報告區塊（報告那天用得上）、陪伴區塊（🔁 一年前的這時候）都從這裡取資料。
const API_BASE = import.meta.env.BASE_URL ?? '/'

export interface NudgeTrigger { kind: 'task' | 'diary'; title: string; due: string | null }

export interface NudgeMatch {
  forDate: string
  topicId: string
  name: string
  path: string[]
  published: boolean
  point: string
  triggers: NudgeTrigger[]
  score: number
}

export interface NudgeRecall {
  topicId: string
  name: string
  path: string[]
  published: boolean
  point: string
  reason: string
  lastMonth: string | null
  years: number[]
}

export interface TopicNudges {
  computedAt: string
  date: string
  matches: NudgeMatch[]
  recall: NudgeRecall[]
}

export function parseTopicNudges(raw: unknown): TopicNudges | null {
  const root = raw as { available?: boolean; payload?: unknown } | null
  if (!root || root.available !== true) return null
  const p = root.payload as Partial<TopicNudges> | null
  if (!p || typeof p.computedAt !== 'string' || !Array.isArray(p.matches) || !Array.isArray(p.recall)) return null
  return p as TopicNudges
}

/** 還沒部署（feed 不存在）回 null；其他非 ok 丟錯 */
export async function apiFetchTopicNudges(pw: string): Promise<TopicNudges | null> {
  const r = await fetch(`${API_BASE}api/feed/topic-nudges`, { headers: { 'x-admin-password': pw } })
  if (r.status === 404) return null
  if (!r.ok) throw new Error('Failed to fetch topic-nudges')
  return parseTopicNudges(await r.json())
}

/** 某一天的情境推播（保持原順序）；沒有資料回 [] */
export function nudgesFor(data: TopicNudges | null, date: string): NudgeMatch[] {
  if (!data) return []
  return data.matches.filter((m) => m.forDate === date)
}

export const knowledgeHref = (topicId: string): string => `#knowledge/${encodeURIComponent(topicId)}`

/** 推播的觸發來源（任務標題、日記標題以「、」連接） */
export const triggerTitles = (m: Pick<NudgeMatch, 'triggers'>): string => m.triggers.map((t) => t.title).join('、')

export const nudgeLabel = (forDate: string, todayIso: string): string => (forDate === todayIso ? '今天用得上' : '明天用得上')
