// 身體頁的「上週週報」：FitnessForge 在 /api/public/summary 附上的 weeklyReport。
// FitnessForge 還沒部署新版時沒有這個欄位，解析回 null，卡片就不顯示。

export const FITNESS_REPORT_URL = 'https://forge.weihanc.cloud/report'

export interface FitnessObservation {
  tone: 'good' | 'warn' | 'info'
  text: string
}

export interface FitnessWeeklyReport {
  weekStart: string
  weekEnd: string
  totalScore: number
  scoreChangePct: number | null
  stars: number
  rank: number
  totalWeeks: number
  trainingDays: number
  strengthSets: number
  cardioMinutes: number
  dailySteps: number | null
  acwr: number | null
  streak: number
  records: string[]
  observations: FitnessObservation[]
  focus: string[]
}

const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v)
const numOrNull = (v: unknown) => (isNum(v) ? v : null)
const strings = (v: unknown) => (Array.isArray(v) ? v.filter((s): s is string => typeof s === 'string') : [])

export function parseFitnessWeeklyReport(raw: unknown): FitnessWeeklyReport | null {
  if (!raw || typeof raw !== 'object') return null
  const r = raw as Record<string, unknown>
  if (typeof r['weekStart'] !== 'string' || typeof r['weekEnd'] !== 'string' || !isNum(r['totalScore'])) return null
  const observations = Array.isArray(r['observations'])
    ? r['observations'].flatMap((o): FitnessObservation[] => {
        const item = o as { tone?: unknown; text?: unknown } | null
        if (typeof item?.text !== 'string') return []
        const tone = item.tone === 'good' || item.tone === 'warn' ? item.tone : 'info'
        return [{ tone, text: item.text }]
      })
    : []
  return {
    weekStart: r['weekStart'],
    weekEnd: r['weekEnd'],
    totalScore: r['totalScore'],
    scoreChangePct: numOrNull(r['scoreChangePct']),
    stars: numOrNull(r['stars']) ?? 0,
    rank: numOrNull(r['rank']) ?? 0,
    totalWeeks: numOrNull(r['totalWeeks']) ?? 0,
    trainingDays: numOrNull(r['trainingDays']) ?? 0,
    strengthSets: numOrNull(r['strengthSets']) ?? 0,
    cardioMinutes: numOrNull(r['cardioMinutes']) ?? 0,
    dailySteps: numOrNull(r['dailySteps']),
    acwr: numOrNull(r['acwr']),
    streak: numOrNull(r['streak']) ?? 0,
    records: strings(r['records']),
    observations,
    focus: strings(r['focus']),
  }
}

/** 2026-10-19、2026-10-25 → 10/19–10/25 */
export function formatWeekRange(weekStart: string, weekEnd: string): string {
  const md = (key: string) => key.slice(5).split('-').map(Number).join('/')
  return `${md(weekStart)}–${md(weekEnd)}`
}
