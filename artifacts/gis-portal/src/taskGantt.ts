// 從容面板的任務甘特圖（feed vikunja-gantt v1；推送端 kb-pipeline scripts/vikunja-gantt-pusher.py，每 10 分鐘）。
// 這裡只負責取回、整理與排版（每列畫在哪幾天、什麼狀態）；選哪些任務在推送端（kbcore/task_gantt.py）。
// 日期都是台北日期字串 YYYY-MM-DD，用 UTC 中午換算天數，避開時區與夏令時間。
const API_BASE = import.meta.env.BASE_URL ?? '/'

export interface GanttProject { id: number; title: string; color: string | null }
export interface GanttTask {
  id: number
  title: string
  projectId: number
  start: string | null
  end: string | null
  due: string | null
  done: boolean
  doneAt: string | null
  priority: number
  percentDone: number
}
export interface GanttData {
  computedAt: string
  baseUrl: string
  doneDays: number
  projects: GanttProject[]
  tasks: GanttTask[]
  undatedOpen: number
  truncated: number
}

/** 推送是每 10 分鐘 */
export const GANTT_EVERY_MIN = 10
/** 幾天內到期算「快到期」 */
export const SOON_DAYS = 7
/** 視窗從今天往前幾天開始（看得到剛過去的） */
export const LOOKBACK_DAYS = 7

const DATE = /^\d{4}-\d{2}-\d{2}$/
const dateOrNull = (v: unknown): string | null => (typeof v === 'string' && DATE.test(v) ? v : null)

export function parseGantt(raw: unknown): GanttData | null {
  const root = (raw as { available?: boolean; payload?: unknown } | null) ?? null
  if (!root || root.available !== true) return null
  const p = root.payload as Record<string, unknown> | null
  if (!p || typeof p.computedAt !== 'string' || typeof p.baseUrl !== 'string' || !Array.isArray(p.projects) || !Array.isArray(p.tasks)) return null
  const projects: GanttProject[] = (p.projects as Record<string, unknown>[])
    .filter((x) => x && typeof x.id === 'number' && typeof x.title === 'string')
    .map((x) => ({ id: x.id as number, title: x.title as string, color: typeof x.color === 'string' && /^#[0-9a-f]{6}$/i.test(x.color) ? x.color : null }))
  const tasks: GanttTask[] = (p.tasks as Record<string, unknown>[])
    .filter((x) => x && typeof x.id === 'number' && typeof x.title === 'string' && typeof x.projectId === 'number')
    .map((x) => ({
      id: x.id as number, title: x.title as string, projectId: x.projectId as number,
      start: dateOrNull(x.start), end: dateOrNull(x.end), due: dateOrNull(x.due),
      done: x.done === true, doneAt: dateOrNull(x.doneAt),
      priority: typeof x.priority === 'number' ? x.priority : 0,
      percentDone: typeof x.percentDone === 'number' ? x.percentDone : 0,
    }))
  const num = (v: unknown) => (typeof v === 'number' && v >= 0 ? v : 0)
  return {
    computedAt: p.computedAt, baseUrl: /^https?:\/\//.test(p.baseUrl) ? p.baseUrl.replace(/\/+$/, '') : '',
    doneDays: num(p.doneDays), projects, tasks, undatedOpen: num(p.undatedOpen), truncated: num(p.truncated),
  }
}

export async function apiFetchGantt(pw: string): Promise<GanttData | null> {
  const r = await fetch(`${API_BASE}api/feed/vikunja-gantt`, { headers: { 'x-admin-password': pw } })
  if (!r.ok) throw new Error('Failed to fetch gantt')
  return parseGantt(await r.json())
}

const ms = (iso: string) => Date.parse(`${iso}T12:00:00Z`)
export const dayDiff = (a: string, b: string): number => Math.round((ms(b) - ms(a)) / 86_400_000)
export const addDays = (iso: string, n: number): string => new Date(ms(iso) + n * 86_400_000).toISOString().slice(0, 10)

export type GanttStatus = 'done' | 'overdue' | 'soon' | 'normal'
export interface GanttLayout {
  /** bar＝有開始也有結束（或到期）；point＝只有一個日期（里程碑） */
  kind: 'bar' | 'point'
  /** 視窗內的第幾天（0 起），已夾在視窗內 */
  from: number
  to: number
  clippedLeft: boolean
  clippedRight: boolean
  status: GanttStatus
  /** 逾期幾天（只有 overdue 才有） */
  overdueDays: number | null
  /** 到期日（沒有到期就用結束日） */
  deadline: string | null
}

export function taskStatus(t: GanttTask, today: string): { status: GanttStatus; overdueDays: number | null } {
  if (t.done) return { status: 'done', overdueDays: null }
  const dl = t.due ?? t.end
  if (!dl) return { status: 'normal', overdueDays: null }
  const d = dayDiff(today, dl)
  if (d < 0) return { status: 'overdue', overdueDays: -d }
  return { status: d <= SOON_DAYS ? 'soon' : 'normal', overdueDays: null }
}

/** 這一列畫在視窗 [winFrom, winFrom+days) 的哪裡；整列在視窗外就回 null（未完成又逾期的例外：貼在左緣）。 */
export function layoutTask(t: GanttTask, today: string, winFrom: string, days: number): GanttLayout | null {
  const end = t.end ?? t.due
  let a: string, b: string, kind: 'bar' | 'point'
  if (t.start && end) {
    ;[a, b] = t.start <= end ? [t.start, end] : [end, t.start]
    kind = 'bar'
  } else {
    a = b = (t.start ?? end)!
    kind = 'point'
  }
  if (!a) return null
  const { status, overdueDays } = taskStatus(t, today)
  let from = dayDiff(winFrom, a), to = dayDiff(winFrom, b)
  if (from >= days) return null
  if (to < 0) {
    if (status !== 'overdue') return null
    return { kind: 'point', from: 0, to: 0, clippedLeft: true, clippedRight: false, status, overdueDays, deadline: t.due ?? t.end }
  }
  const clippedLeft = from < 0, clippedRight = to >= days
  from = Math.max(0, from)
  to = Math.min(days - 1, to)
  return { kind, from, to, clippedLeft, clippedRight, status, overdueDays, deadline: t.due ?? t.end }
}

export interface GanttRow { task: GanttTask; layout: GanttLayout }
export interface GanttGroup { project: GanttProject; rows: GanttRow[]; overdue: number }
export interface GanttView {
  winFrom: string
  days: number
  groups: GanttGroup[]
  /** 開始日在視窗之後、這次沒畫的 */
  later: number
  counts: { open: number; overdue: number; soon: number; done: number }
}

export function buildGanttView(data: GanttData, today: string, weeks: number, showDone: boolean): GanttView {
  const winFrom = addDays(today, -LOOKBACK_DAYS)
  const days = weeks * 7
  const counts = { open: 0, overdue: 0, soon: 0, done: 0 }
  for (const t of data.tasks) {
    const s = taskStatus(t, today).status
    if (s === 'done') counts.done++
    else {
      counts.open++
      if (s === 'overdue') counts.overdue++
      if (s === 'soon') counts.soon++
    }
  }
  const byProject = new Map<number, GanttRow[]>()
  let later = 0
  for (const t of data.tasks) {
    if (t.done && !showDone) continue
    const layout = layoutTask(t, today, winFrom, days)
    if (!layout) {
      const first = [t.start, t.end, t.due].filter((d): d is string => !!d).sort()[0]
      if (first && dayDiff(winFrom, first) >= days) later++
      continue
    }
    const list = byProject.get(t.projectId) ?? []
    list.push({ task: t, layout })
    byProject.set(t.projectId, list)
  }
  const groups: GanttGroup[] = []
  for (const project of data.projects) {
    const rows = byProject.get(project.id)
    if (!rows?.length) continue
    // 未完成在前；同狀態依畫的位置（先開始的在上）
    rows.sort((x, y) => Number(x.task.done) - Number(y.task.done) || x.layout.from - y.layout.from || x.layout.to - y.layout.to || x.task.id - y.task.id)
    groups.push({ project, rows, overdue: rows.filter((r) => r.layout.status === 'overdue').length })
  }
  // 有逾期的專案排前面，其餘照專案名稱（推送端已排好）
  groups.sort((x, y) => Number(y.overdue > 0) - Number(x.overdue > 0))
  return { winFrom, days, groups, later, counts }
}

export interface GanttTick { idx: number; label: string; month: boolean }
/** 時間軸刻度：每週一一格，跨月的那一格標月份 */
export function ganttTicks(winFrom: string, days: number): GanttTick[] {
  const out: GanttTick[] = []
  for (let i = 0; i < days; i++) {
    const iso = addDays(winFrom, i)
    const d = new Date(ms(iso))
    if (d.getUTCDay() !== 1) continue
    const m = d.getUTCMonth() + 1, day = d.getUTCDate()
    out.push({ idx: i, label: day <= 7 ? `${m}月` : `${m}/${day}`, month: day <= 7 })
  }
  return out
}

export const isWeekend = (iso: string): boolean => { const w = new Date(ms(iso)).getUTCDay(); return w === 0 || w === 6 }

export function rangeLabel(t: GanttTask): string {
  const md = (iso: string) => `${Number(iso.slice(5, 7))}/${Number(iso.slice(8, 10))}`
  const end = t.end ?? t.due
  if (t.start && end && t.start !== end) return `${md(t.start)} → ${md(end)}`
  const one = t.start ?? end
  return one ? md(one) : ''
}

export const taskUrl = (data: GanttData, id: number): string | null => (data.baseUrl ? `${data.baseUrl}/tasks/${id}` : null)
