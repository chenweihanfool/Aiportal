// 入口網內建 HERMES 對話的純邏輯：解析事件流、把事件累積成畫面狀態。網路在 chatApi.ts，畫面在 ChatPanel.tsx。
// HERMES 的 /v1/runs/{id}/events 每筆是 `data: {json}`，事件名在 JSON 的 event 欄；`:` 開頭是註解（keepalive、stream closed）。

export interface ChatEvent { event: string; [k: string]: unknown }

/** requestId／executionGeneration：HERMES 有給就原樣帶回 */
export interface Approval { command: string; description: string | null; requestId?: string; executionGeneration?: number }

export interface RunView {
  text: string
  /** 工具進度，最新的在最後 */
  tools: string[]
  approval: Approval | null
  done: boolean
  error: string | null
  /** run 完成時的 total_tokens */
  tokens: number | null
}

export const emptyRun = (): RunView => ({ text: '', tools: [], approval: null, done: false, error: null, tokens: null })

/** 把新收到的片段併進緩衝，切出完整的事件；回傳事件與剩餘緩衝 */
export function parseSse(buffer: string, chunk: string): { events: ChatEvent[]; rest: string } {
  const parts = (buffer + chunk).replace(/\r\n/g, '\n').split('\n\n')
  const rest = parts.pop() ?? ''
  const events: ChatEvent[] = []
  for (const block of parts) {
    const data = block.split('\n').filter((l) => l.startsWith('data:')).map((l) => l.slice(5).trimStart()).join('\n')
    if (!data) continue
    try {
      const j = JSON.parse(data) as ChatEvent
      if (j && typeof j.event === 'string') events.push(j)
    } catch { /* 壞的一筆略過，不中斷串流 */ }
  }
  return { events, rest }
}

const str = (v: unknown): string | null => (typeof v === 'string' && v ? v : null)

const usageTotal = (ev: { usage?: unknown }): number | null => {
  const t = (ev.usage as { total_tokens?: unknown } | undefined)?.total_tokens
  return typeof t === 'number' ? t : null
}

function approvalOf(a: Record<string, unknown> | undefined): Approval {
  const out: Approval = { command: str(a?.['command']) ?? '（沒有指令內容）', description: str(a?.['description']) }
  const id = str(a?.['request_id']) ?? str(a?.['prompt_id'])
  if (id) out.requestId = id
  if (typeof a?.['execution_generation'] === 'number') out.executionGeneration = a['execution_generation']
  return out
}

/** 一筆事件 → 新狀態 */
export function applyEvent(s: RunView, ev: ChatEvent): RunView {
  switch (ev.event) {
    case 'message.delta': return { ...s, text: s.text + (str(ev['delta']) ?? '') }
    case 'tool.started': return { ...s, tools: [...s.tools, `🔧 ${str(ev['tool']) ?? '工具'}${str(ev['preview']) ? `：${str(ev['preview'])!.slice(0, 120)}` : ''}`] }
    case 'approval.request': return { ...s, approval: approvalOf(ev) }
    case 'approval.responded': return { ...s, approval: null }
    case 'run.completed': return { ...s, text: str(ev['output']) ?? s.text, approval: null, done: true, tokens: usageTotal(ev as { usage?: unknown }) }
    case 'run.failed': return { ...s, approval: null, done: true, error: str(ev['error']) ?? 'HERMES 處理失敗' }
    case 'run.cancelled': return { ...s, approval: null, done: true, error: '已中止' }
    case 'run.interrupted': return { ...s, approval: null, done: true, error: 'Gateway 重啟，這次處理被中斷' }
    default: return s
  }
}

/** 斷線後查狀態：GET /v1/runs/{id} 的內容 → 新狀態（事件流只能讀一次，斷線不能重連） */
export function applyStatus(s: RunView, st: Record<string, unknown>): RunView {
  const status = str(st['status'])
  if (status === 'completed') return { ...s, text: str(st['output']) ?? s.text, approval: null, done: true, tokens: usageTotal(st as { usage?: unknown }) }
  if (status === 'failed') return { ...s, approval: null, done: true, error: str(st['error']) ?? 'HERMES 處理失敗' }
  if (status === 'cancelled') return { ...s, approval: null, done: true, error: '已中止' }
  if (status === 'interrupted') return { ...s, approval: null, done: true, error: 'Gateway 重啟，這次處理被中斷' }
  if (status === 'waiting_for_approval') return { ...s, approval: approvalOf(st['approval'] as Record<string, unknown> | undefined) }
  return s
}

export function tokenText(n: number): string {
  return n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n)
}

export interface RestartInfo { mode: string; status: string; note: string | null; requestedAt: string }

/** 重啟狀態的一句話；太舊的結果不再顯示 */
export function restartText(r: RestartInfo | null, nowMs: number): string | null {
  if (!r) return null
  if (r.status === 'pending') return '重啟請求已送出，等主機認領（約 15 秒）'
  if (r.status === 'running') return r.mode === 'force' ? '強制重啟中' : '重啟中，等進行中的工作收尾'
  if (nowMs - Date.parse(r.requestedAt) > 3_600_000) return null
  return r.note ?? (r.status === 'done' ? '已重啟' : '重啟失敗')
}

export const restartBusy = (r: RestartInfo | null) => r?.status === 'pending' || r?.status === 'running'
