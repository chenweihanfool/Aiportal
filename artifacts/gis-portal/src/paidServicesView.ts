// 付費服務卡的資料整理（純函式）：把 /api/paid-services 與 Ollama 用量整成每個服務一列。
// 只有 DeepSeek、Tavily 有能直接讀的額度；Ollama 是手動輸入的餘額；Claude Pro、JEV 沒有額度端點，只放連結。
import type { UsageData } from './boardApi'
import { formatEmptyDay, formatUsd } from './boardView'

export type UsageResult<T> = { status: 'ok'; data: T } | { status: 'no-key' } | { status: 'error'; message: string }

export interface PaidServicesData {
  deepseek: UsageResult<{ available: boolean; balances: Array<{ currency: string; total: number; granted: number; toppedUp: number }> }>
  tavily: UsageResult<{ plan: string | null; used: number; limit: number | null; accountUsed: number | null; accountLimit: number | null }>
  fetchedAt: string
}

export type ServiceTone = 'ok' | 'warn' | 'crit' | 'none'

export interface ServiceRow {
  id: 'ollama' | 'claude' | 'jev' | 'tavily' | 'deepseek'
  name: string
  /** 一行用量（拿不到時是原因或「用量請看連結」） */
  line: string
  tone: ServiceTone
  /** 用量是自動讀到的（true）還是手動輸入／只有連結（false） */
  live: boolean
  href: string
}

const CURRENCY_SYMBOL: Record<string, string> = { CNY: '¥', USD: '$' }

export function deepseekLine(r: PaidServicesData['deepseek'] | null | undefined): Pick<ServiceRow, 'line' | 'tone' | 'live'> {
  if (!r) return { line: '載入中…', tone: 'none', live: false }
  if (r.status === 'no-key') return { line: '未設定 DEEPSEEK_API_KEY，只能看連結', tone: 'none', live: false }
  if (r.status === 'error') return { line: `讀取失敗（${r.message}）`, tone: 'warn', live: false }
  const { balances, available } = r.data
  if (balances.length === 0) return { line: '沒有餘額資料', tone: 'warn', live: true }
  const text = balances.map((b) => `${CURRENCY_SYMBOL[b.currency] ?? `${b.currency} `}${b.total.toFixed(2)}`).join(' / ')
  const empty = balances.every((b) => b.total <= 0)
  return { line: `餘額 ${text}${available ? '' : '（帳號不可用）'}`, tone: !available || empty ? 'crit' : 'ok', live: true }
}

export function tavilyLine(r: PaidServicesData['tavily'] | null | undefined): Pick<ServiceRow, 'line' | 'tone' | 'live'> {
  if (!r) return { line: '載入中…', tone: 'none', live: false }
  if (r.status === 'no-key') return { line: '未設定 TAVILY_API_KEY，只能看連結', tone: 'none', live: false }
  if (r.status === 'error') return { line: `讀取失敗（${r.message}）`, tone: 'warn', live: false }
  const { used, limit, plan } = r.data
  const head = `${plan ? `${plan}・` : ''}已用 ${used.toLocaleString()}${limit !== null ? ` / ${limit.toLocaleString()}` : ''} credits`
  const ratio = limit ? used / limit : 0
  return { line: head, tone: ratio >= 0.95 ? 'crit' : ratio >= 0.8 ? 'warn' : 'ok', live: true }
}

export function ollamaLine(u: UsageData | null | undefined): Pick<ServiceRow, 'line' | 'tone' | 'live'> {
  if (!u) return { line: '載入中…', tone: 'none', live: false }
  const bal = u.balance
  if (!bal) return { line: '還沒輸入餘額，按「更新餘額」輸入', tone: 'none', live: false }
  const f = u.forecast
  const cap = bal.capUsd
  const when = f.daysUntilEmpty !== null ? `・預估 ${formatEmptyDay(f.emptyDate, f.daysUntilEmpty)}用完` : ''
  return { line: `餘額 ${formatUsd(bal.balanceUsd)} / $${cap}（手動輸入）${when}`, tone: f.level, live: false }
}

export function buildServiceRows(input: { usage: UsageData | null; paid: PaidServicesData | null }): ServiceRow[] {
  return [
    { id: 'ollama', name: 'Ollama Cloud', href: 'https://ollama.com/settings', ...ollamaLine(input.usage) },
    { id: 'claude', name: 'Claude Pro', href: 'https://claude.ai/settings/usage', line: '沒有用量 API，請看連結', tone: 'none', live: false },
    { id: 'jev', name: 'JEV', href: 'https://typesafe.ai', line: '沒有用量 API，請看連結', tone: 'none', live: false },
    { id: 'tavily', name: 'Tavily', href: 'https://app.tavily.com', ...tavilyLine(input.paid?.tavily) },
    { id: 'deepseek', name: 'DeepSeek', href: 'https://platform.deepseek.com/usage', ...deepseekLine(input.paid?.deepseek) },
  ]
}
