// 首頁主動推播主題知識（feed topic-nudges v1，契約見 kb-pipeline）：純函式（網路只有 apiFetchTopicNudges）。
// 首頁「現在用得上」區塊（NowSection／nowCards.ts）從這裡取資料。
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
  /** 以下為 2026-11-13 起的選填欄位（舊格式沒有） */
  why?: string
  /** HH:MM；沒有時間是 null */
  at?: string | null
  matchedBy?: 'case' | 'terms'
  caseName?: string | null
}

export interface NudgeResume {
  forDate: string
  at: string | null
  caseName: string
  quietDays: number
  why: string
  events: Array<{ date: string; title: string }>
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
  /** 2026-11-13 起的選填欄位：案件停了一陣子、今天要回頭做 */
  resumes?: NudgeResume[]
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

export const knowledgeHref = (topicId: string): string => `#knowledge/${encodeURIComponent(topicId)}`
