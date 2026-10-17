import { describe, expect, it } from 'vitest'
import { buildServiceRows, deepseekLine, tavilyLine, ollamaLine, type PaidServicesData } from './paidServicesView'
import type { UsageData } from './boardApi'

const usage = (over: Partial<UsageData> = {}): UsageData => ({
  available: true, today: '2026-10-17', days: [], last7Days: {}, entries: [], scope: '',
  balance: { enteredAt: '2026-10-17T00:00:00Z', balanceUsd: 29.31, capUsd: 60, refillAt: '2026-10-29', monthUsedUsd: null, note: null },
  forecast: { callsPerDay: 1000, callsBasedOnDays: 7, usdPerDay: 3, source: 'estimated', usdPerCall: 0.003, balanceUsd: 29.31, daysUntilEmpty: 9.8, emptyDate: '2026-10-27', daysToRefill: 12, shortfallUsd: 6.7, level: 'warn' },
  ...over,
})

describe('deepseekLine', () => {
  it('shows the balance with a currency symbol', () => {
    const r = deepseekLine({ status: 'ok', data: { available: true, balances: [{ currency: 'CNY', total: 110, granted: 10, toppedUp: 100 }] } })
    expect(r).toEqual({ line: '餘額 ¥110.00', tone: 'ok', live: true })
  })
  it('is critical when the balance is zero or the account is unavailable', () => {
    expect(deepseekLine({ status: 'ok', data: { available: false, balances: [{ currency: 'USD', total: 0, granted: 0, toppedUp: 0 }] } }).tone).toBe('crit')
  })
  it('says why there is no number', () => {
    expect(deepseekLine({ status: 'no-key' }).line).toContain('DEEPSEEK_API_KEY')
    expect(deepseekLine({ status: 'error', message: 'HTTP 401' })).toMatchObject({ line: '讀取失敗（HTTP 401）', tone: 'warn', live: false })
    expect(deepseekLine(null).line).toBe('載入中…')
  })
})

describe('tavilyLine', () => {
  it('warns at 80% and goes critical at 95%', () => {
    const r = (used: number) => tavilyLine({ status: 'ok', data: { plan: 'Researcher', used, limit: 1000, accountUsed: used, accountLimit: 1000 } })
    expect(r(500)).toMatchObject({ line: 'Researcher・已用 500 / 1,000 credits', tone: 'ok' })
    expect(r(800).tone).toBe('warn')
    expect(r(950).tone).toBe('crit')
  })
  it('has no ratio when the limit is unknown', () => {
    expect(tavilyLine({ status: 'ok', data: { plan: null, used: 12, limit: null, accountUsed: null, accountLimit: null } })).toMatchObject({ line: '已用 12 credits', tone: 'ok' })
  })
})

describe('ollamaLine', () => {
  it('asks for a balance when none was entered', () => {
    expect(ollamaLine(usage({ balance: null }))).toMatchObject({ tone: 'none', live: false })
  })
  it('shows the manual balance, the forecast date and the forecast level', () => {
    const r = ollamaLine(usage())
    expect(r.line).toBe('餘額 $29.31 / $60（手動輸入）・預估 10/27（約 9.8 天）用完')
    expect(r.tone).toBe('warn')
  })
})

describe('buildServiceRows', () => {
  it('lists the five services in order with links; only link-only ones say so', () => {
    const paid: PaidServicesData = { deepseek: { status: 'no-key' }, tavily: { status: 'no-key' }, fetchedAt: '' }
    const rows = buildServiceRows({ usage: usage(), paid })
    expect(rows.map((r) => r.id)).toEqual(['ollama', 'claude', 'jev', 'tavily', 'deepseek'])
    expect(rows.every((r) => r.href.startsWith('https://'))).toBe(true)
    expect(rows.find((r) => r.id === 'claude')?.line).toContain('沒有用量 API')
  })
})
