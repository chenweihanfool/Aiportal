// 首頁 🌙 明日報告：讀 feed hermes-reports（kb-pipeline report-publish.py），挑要顯示的那一份。
// 使用者 2026-10-30：「前一天晚上就整理明天要注意的報告給我 早上沒空看 要前一晚看才有用」。
// 使用者 2026-10-30：「明日報告這樣不易閱讀 跟日報一樣設計成視覺化元件 或更具創意的呈現方式」：
// 報告文字拆成優先卡、進度、建議；未來 21 天的擠壓條直接由 feed vikunja-gantt 算，不靠 AI 文字。認不出格式就退回原文。
import { addDays, dayDiff, type GanttData } from './taskGantt'

const API_BASE = import.meta.env.BASE_URL ?? '/'

export interface Report { key: string; title: string; date: string; bodyMd: string; createdAt: string }
export interface Brief { bodyMd: string; date: string; label: string }

export function parseReports(raw: unknown): Report[] | null {
  const root = raw as { available?: boolean; payload?: { reports?: unknown } | null } | null
  if (!root) return null
  if (root.available !== true) return []
  return Array.isArray(root.payload?.reports) ? (root.payload.reports as Report[]) : null
}

/** 還沒部署（feed 不存在）當成沒有報告；連不上丟錯 */
export async function apiFetchReports(pw: string): Promise<Report[]> {
  const r = await fetch(`${API_BASE}api/feed/hermes-reports`, { headers: { 'x-admin-password': pw } })
  if (r.status === 404) return []
  if (!r.ok) throw new Error('Failed to fetch reports')
  return parseReports(await r.json()) ?? []
}

/** 取日期最新、還沒過期的明日報告：針對明天＝「明天」，針對今天＝「今天的報告」；更舊的不顯示，免得過時內容佔首頁 */
export function pickBrief(reports: readonly Report[] | null, todayIso: string): Brief | null {
  const r = (reports ?? []).filter((x) => x.key === 'tomorrow' && x.date >= todayIso).sort((a, b) => b.date.localeCompare(a.date))[0]
  if (!r) return null
  const md = `${Number(r.date.slice(5, 7))}/${Number(r.date.slice(8, 10))}`
  return { bodyMd: r.bodyMd, date: r.date, label: r.date === todayIso ? `今天的報告（${md}）` : `明天 ${md}` }
}

export interface BriefTask { title: string; project: string | null; due: string | null; why: string | null; next: string | null }
export interface BriefProgress { name: string; pct: number }
export interface ParsedBrief {
  tasks: BriefTask[]
  /** 專案分析全文，收在「完整分析」 */
  analysis: string[]
  progress: BriefProgress[]
  /** 分析裡的調整建議（一句） */
  tip: string | null
  system: { ok: boolean; text: string } | null
}

const clean = (l: string) => l.replace(/\*\*/g, '').trim()
const fieldOf = (line: string, re: RegExp): string | null => re.exec(line.replace(/^[-*•\s]+/, ''))?.[1]?.trim() ?? null

/** 「到期 11/01」→ 對照報告日期補上年份（跨年時算明年） */
export function dueDate(text: string, briefDate: string): string | null {
  const m = /到期\s*(\d{1,2})\/(\d{1,2})/.exec(text)
  if (!m) return null
  const md = `${m[1]!.padStart(2, '0')}-${m[2]!.padStart(2, '0')}`
  const y = Number(briefDate.slice(0, 4))
  const d = `${y}-${md}`
  return d < addDays(briefDate, -60) ? `${y + 1}-${md}` : d
}

function parseTaskHead(head: string, briefDate: string): BriefTask {
  const parts = head.split(/[｜|]/).map((s) => s.trim()).filter(Boolean)
  const rest = parts.slice(1)
  const project = rest.find((p) => !/到期|priority/i.test(p)) ?? null
  return { title: parts[0] ?? head, project, due: dueDate(head, briefDate), why: null, next: null }
}

/** 系統狀態段是 AI 寫的句子，用詞每天不同（2026-11-01 寫「所有排程正常」就被當成異常）。有正常的說法、又沒提到失敗才算正常。 */
export function systemTextOk(text: string): boolean {
  return /無異常|一切正常|全部正常|所有排程正常/.test(text) && !/失敗|逾時|錯誤|警告/.test(text)
}

export function parseBrief(md: string, briefDate: string): ParsedBrief | null {
  const sec: Record<'task' | 'analysis' | 'system', string[]> = { task: [], analysis: [], system: [] }
  let cur: keyof typeof sec | null = null
  for (const raw of md.replace(/\r\n?/g, '\n').split('\n')) {
    const l = clean(raw)
    if (l.includes('📋')) { cur = 'task'; continue }
    if (l.includes('📊')) { cur = 'analysis'; continue }
    if (l.includes('⚠️') || l.startsWith('⚠')) { cur = 'system'; continue }
    if (cur && l) sec[cur].push(l)
  }
  const tasks: BriefTask[] = []
  for (const l of sec.task) {
    const head = /^\d+[.、．]\s*(.+)$/.exec(l)
    if (head) { tasks.push(parseTaskHead(head[1]!, briefDate)); continue }
    const t = tasks[tasks.length - 1]
    if (!t) continue
    t.why ??= fieldOf(l, /^為什麼(?:優先)?\s*[：:]\s*(.+)$/)
    t.next ??= fieldOf(l, /^下一步(?:建議)?\s*[：:]\s*(.+)$/)
  }
  if (tasks.length === 0) return null
  const analysis = sec.analysis
  const text = analysis.join('\n')
  const seen = new Set<string>()
  const progress: BriefProgress[] = []
  for (const m of text.matchAll(/([^、，,；;：:（）\s]{2,24})（(?:[^（）]*?[、，])?(\d{1,3})%）/g)) {
    const name = m[1]!.replace(/^(?:是|的|裡|都在|量體最重的是)+/, '')
    if (!seen.has(name)) { seen.add(name); progress.push({ name, pct: Math.min(100, Number(m[2])) }) }
  }
  const tip = text.split(/(?<=。)/).map((s) => s.trim()).find((s) => s.startsWith('建議') || s.includes('。建議')) ?? null
  const sys = sec.system.join(' ')
  return {
    tasks, analysis, progress: progress.sort((a, b) => a.pct - b.pct), tip,
    system: sys ? { ok: systemTextOk(sys), text: sys } : null,
  }
}

export interface CrowdDay { date: string; weekday: string; weekend: boolean; titles: string[] }
export interface Crowd { days: CrowdDay[]; overdue: number; total: number; busiest: CrowdDay | null }

const WEEKDAYS = ['日', '一', '二', '三', '四', '五', '六']
export const weekdayOf = (d: string) => new Date(`${d}T12:00:00Z`).getUTCDay()
export const CROWD_DAYS = 21

/** 未來 21 天每天到期幾件（從報告日期起算），未完成的才算 */
export function crowdOf(g: GanttData | null, from: string, n = CROWD_DAYS): Crowd | null {
  if (!g) return null
  const open = g.tasks.filter((t) => !t.done && t.due)
  const days = Array.from({ length: n }, (_, i): CrowdDay => {
    const date = addDays(from, i)
    const w = weekdayOf(date)
    return { date, weekday: WEEKDAYS[w]!, weekend: w === 0 || w === 6, titles: open.filter((t) => t.due === date).map((t) => t.title) }
  })
  const total = days.reduce((s, d) => s + d.titles.length, 0)
  const busiest = days.reduce<CrowdDay | null>((b, d) => (d.titles.length > (b?.titles.length ?? 0) ? d : b), null)
  return { days, overdue: open.filter((t) => t.due! < from).length, total, busiest }
}

/** 到期標籤：相對報告日期 */
export function dueLabel(due: string | null, briefDate: string): { text: string; hot: boolean } | null {
  if (!due) return null
  const n = dayDiff(briefDate, due)
  const md = `${Number(due.slice(5, 7))}/${Number(due.slice(8, 10))}`
  if (n < 0) return { text: `逾期 ${-n} 天`, hot: true }
  if (n === 0) return { text: '當天到期', hot: true }
  return { text: `${n} 天後・${md}`, hot: n <= 2 }
}
