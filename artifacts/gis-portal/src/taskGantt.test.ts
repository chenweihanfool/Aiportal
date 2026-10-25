import { describe, expect, it } from 'vitest'
import { addDays, buildGanttView, dayDiff, ganttTicks, layoutTask, parseGantt, rangeLabel, taskStatus, taskUrl, upcomingUrl, type GanttData, type GanttTask } from './taskGantt'

const TODAY = '2026-10-24' // 週六
const task = (id: number, o: Partial<GanttTask> = {}): GanttTask => ({
  id, title: `T${id}`, projectId: 1, start: null, end: null, due: null, done: false, doneAt: null, priority: 0, percentDone: 0, ...o,
})
const data = (tasks: GanttTask[]): GanttData => ({
  computedAt: '2026-10-24T10:00:00+08:00', baseUrl: 'https://v.example', doneDays: 30,
  projects: [{ id: 1, title: '工作', color: '#e2584f' }, { id: 2, title: '生活', color: null }], tasks, undatedOpen: 0, truncated: 0,
})

describe('dates', () => {
  it('dayDiff / addDays across month boundaries', () => {
    expect(dayDiff('2026-10-24', '2026-11-02')).toBe(9)
    expect(addDays('2026-10-31', 1)).toBe('2026-11-01')
    expect(addDays('2026-10-24', -7)).toBe('2026-10-17')
  })
})

describe('taskStatus', () => {
  it('done / overdue / soon / normal by due (or end)', () => {
    expect(taskStatus(task(1, { done: true, due: '2026-10-01' }), TODAY).status).toBe('done')
    expect(taskStatus(task(1, { due: '2026-10-20' }), TODAY)).toEqual({ status: 'overdue', overdueDays: 4 })
    expect(taskStatus(task(1, { end: '2026-10-31' }), TODAY).status).toBe('soon')
    expect(taskStatus(task(1, { due: '2026-11-01' }), TODAY).status).toBe('normal')
    expect(taskStatus(task(1, { start: '2026-10-01' }), TODAY).status).toBe('normal')
  })
})

describe('layoutTask', () => {
  const from = '2026-10-17'
  it('bar from start to end, clipped to the window', () => {
    expect(layoutTask(task(1, { start: '2026-10-20', end: '2026-10-25' }), TODAY, from, 35)).toMatchObject({ kind: 'bar', from: 3, to: 8, clippedLeft: false, clippedRight: false })
    expect(layoutTask(task(1, { start: '2026-10-01', due: '2026-12-31' }), TODAY, from, 35)).toMatchObject({ kind: 'bar', from: 0, to: 34, clippedLeft: true, clippedRight: true })
  })
  it('single date is a milestone; reversed range is fixed', () => {
    expect(layoutTask(task(1, { due: '2026-10-24' }), TODAY, from, 35)).toMatchObject({ kind: 'point', from: 7, to: 7 })
    expect(layoutTask(task(1, { start: '2026-10-26', end: '2026-10-22' }), TODAY, from, 35)).toMatchObject({ kind: 'bar', from: 5, to: 9 })
  })
  it('long-overdue open task pins to the left edge; old done task is hidden; future beyond window hidden', () => {
    expect(layoutTask(task(1, { due: '2026-09-01' }), TODAY, from, 35)).toMatchObject({ kind: 'point', from: 0, clippedLeft: true, status: 'overdue', overdueDays: 53 })
    expect(layoutTask(task(1, { due: '2026-09-01', done: true }), TODAY, from, 35)).toBeNull()
    expect(layoutTask(task(1, { start: '2026-12-01', end: '2026-12-05' }), TODAY, from, 35)).toBeNull()
  })
})

describe('buildGanttView', () => {
  const d = data([
    task(1, { start: '2026-10-20', end: '2026-11-10' }),
    task(2, { projectId: 2, due: '2026-10-22' }),
    task(3, { due: '2026-10-28' }),
    task(4, { due: '2026-10-21', done: true, doneAt: '2026-10-21' }),
    task(5, { start: '2027-01-01' }),
  ])
  it('counts, grouping, overdue projects first, done hidden unless asked', () => {
    const v = buildGanttView(d, TODAY, 5, false)
    expect(v.winFrom).toBe('2026-10-17')
    expect(v.days).toBe(35)
    expect(v.counts).toEqual({ open: 4, overdue: 1, soon: 1, done: 1 })
    expect(v.groups.map((g) => g.project.id)).toEqual([2, 1])
    expect(v.groups[1]!.rows.map((r) => r.task.id)).toEqual([1, 3])
    expect(v.later).toBe(1)
    const withDone = buildGanttView(d, TODAY, 5, true)
    expect(withDone.groups[1]!.rows.map((r) => r.task.id)).toEqual([1, 3, 4])
  })
  it('byDue: one flat list across projects, nearest due first, done last', () => {
    const v = buildGanttView(d, TODAY, 5, true, true)
    expect(v.groups).toEqual([])
    expect(v.flat.map((r) => r.task.id)).toEqual([2, 3, 1, 4])   // 10/22 逾期、10/28、11/10（結束日）、已完成
    expect(v.counts.open).toBe(4)
    expect(buildGanttView(d, TODAY, 5, false, false).flat).toEqual([])
  })
})

describe('parseGantt', () => {
  it('needs available payload; drops bad rows and unsafe urls', () => {
    expect(parseGantt({ available: false, payload: null })).toBeNull()
    const p = parseGantt({ available: true, payload: { ...data([task(1, { due: '2026-10-25' })]), baseUrl: 'javascript:x', tasks: [task(1, { due: '2026-10-25T00:00' }), { id: 'x' }] } })!
    expect(p.baseUrl).toBe('')
    expect(p.tasks).toHaveLength(1)
    expect(p.tasks[0]!.due).toBeNull()
    expect(taskUrl(p, 1)).toBeNull()
    expect(taskUrl(data([]), 7)).toBe('https://v.example/tasks/7')
    expect(upcomingUrl(data([]))).toBe('https://v.example/tasks/by/upcoming?showOverdue=true&showNulls=true')
    expect(upcomingUrl(p)).toBeNull()
  })
})

describe('ticks and labels', () => {
  it('one tick per Monday, month name on the first Monday of a month', () => {
    const t = ganttTicks('2026-10-17', 35)
    expect(t.map((x) => x.label)).toEqual(['10/19', '10/26', '11月', '11/9', '11/16'])
    expect(t[0]!.idx).toBe(2)
  })
  it('rangeLabel', () => {
    expect(rangeLabel(task(1, { start: '2026-10-05', due: '2026-11-02' }))).toBe('10/5 → 11/2')
    expect(rangeLabel(task(1, { due: '2026-11-02' }))).toBe('11/2')
  })
})
