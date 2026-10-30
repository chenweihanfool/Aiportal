// 入口網內建 HERMES 對話的網路層（後端見 api-server routes/hermesChat.ts）。
import type { Approval, RestartInfo } from './chatView'

const API_BASE = import.meta.env.BASE_URL ?? '/'
const url = (p: string) => `${API_BASE}api/hermes-chat${p}`
const headers = (pw: string) => ({ 'x-admin-password': pw, 'Content-Type': 'application/json' })

export interface ChatStatus {
  configured: boolean
  gateway: boolean
  sessionId: string | null
  lastMessageAt: string | null
  idleMinutes: number
  restart: RestartInfo | null
}
export interface StoredMessage { id: number; role: 'user' | 'assistant'; content: string; at: number }

async function json<T>(r: Response): Promise<T> {
  const body = await r.json().catch(() => null) as { message?: string } | null
  if (!r.ok) throw new Error(body?.message ?? `請求失敗（${r.status}）`)
  return body as T
}

export const fetchChatStatus = (pw: string) => fetch(url('/status'), { headers: headers(pw) }).then((r) => json<ChatStatus>(r))
export const fetchMessages = (pw: string) => fetch(url('/messages'), { headers: headers(pw) }).then((r) => json<{ messages: StoredMessage[] }>(r)).then((d) => d.messages)
export const sendMessage = (pw: string, message: string) =>
  fetch(url('/messages'), { method: 'POST', headers: headers(pw), body: JSON.stringify({ message }) }).then((r) => json<{ runId: string; sessionId: string; isNew: boolean }>(r))
export const fetchRun = (pw: string, id: string) => fetch(url(`/runs/${id}`), { headers: headers(pw) }).then((r) => json<Record<string, unknown>>(r))
export const answerApproval = (pw: string, id: string, choice: 'once' | 'deny', a: Approval | null) =>
  fetch(url(`/runs/${id}/approval`), { method: 'POST', headers: headers(pw), body: JSON.stringify({ choice, requestId: a?.requestId, executionGeneration: a?.executionGeneration }) }).then((r) => json<{ success: boolean }>(r))
export const stopRun = (pw: string, id: string) => fetch(url(`/runs/${id}/stop`), { method: 'POST', headers: headers(pw) }).then((r) => json<{ success: boolean }>(r))
export const newChat = (pw: string) => fetch(url('/new'), { method: 'POST', headers: headers(pw) }).then((r) => json<{ success: boolean }>(r))
export const requestRestart = (pw: string, mode: 'graceful' | 'force') =>
  fetch(url('/restart'), { method: 'POST', headers: headers(pw), body: JSON.stringify({ mode }) }).then((r) => json<{ restart: RestartInfo }>(r))

/** 讀事件流，每收到一段文字呼叫 onChunk；連線中斷時丟錯，由呼叫端改查狀態 */
export async function readEvents(pw: string, id: string, onChunk: (text: string) => void): Promise<void> {
  const r = await fetch(url(`/runs/${id}/events`), { headers: headers(pw) })
  if (!r.ok || !r.body) throw new Error('事件流讀取失敗')
  const reader = r.body.pipeThrough(new TextDecoderStream()).getReader()
  for (;;) {
    const { done, value } = await reader.read()
    if (done) return
    if (value) onChunk(value)
  }
}
