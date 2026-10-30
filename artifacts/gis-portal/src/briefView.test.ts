import { describe, expect, it } from 'vitest'
import { crowdOf, dueDate, dueLabel, parseBrief, parseReports, pickBrief, type Report } from './briefView'
import type { GanttData } from './taskGantt'

const r = (date: string, key = 'tomorrow'): Report => ({ key, title: '明日報告', date, bodyMd: `內容 ${date}`, createdAt: 't' })

describe('pickBrief', () => {
  it('前一晚看到明天的報告', () => {
    expect(pickBrief([r('2026-10-30'), r('2026-10-31')], '2026-10-30')).toMatchObject({ date: '2026-10-31', label: '明天 10/31' })
  })
  it('隔天白天仍顯示，標今天', () => {
    expect(pickBrief([r('2026-10-31')], '2026-10-31')?.label).toBe('今天的報告（10/31）')
  })
  it('過期的不顯示，其他 key 不混入', () => {
    expect(pickBrief([r('2026-10-30')], '2026-10-31')).toBeNull()
    expect(pickBrief([r('2026-10-31', 'other')], '2026-10-31')).toBeNull()
    expect(pickBrief(null, '2026-10-31')).toBeNull()
  })
})

describe('parseReports', () => {
  it('還沒推過回空陣列；格式不對回 null', () => {
    expect(parseReports({ available: false })).toEqual([])
    expect(parseReports({ available: true, payload: {} })).toBeNull()
    expect(parseReports({ available: true, payload: { reports: [r('2026-10-31')] } })).toHaveLength(1)
  })
})

// 實機 2026-10-30 的報告結構（內容已換成示範文字）
const SAMPLE = `🌙 明日報告 2026-10-31（週六）

📋 明日優先處理（最多 3 項）
1. 訂房 — 三天兩夜｜2026-11-26 旅遊專案｜到期 11/01（週日）
為什麼優先：這是第一個實體前置。
下一步：先定地點與預算。
2. **繳交B表**｜116年重測｜到期 11/02（週一）、priority 3
為什麼優先：量體最重。
下一步：盤點電子檔。

📊 專案鬆緊程度分析
10 個專案裡，115年農地重劃二圖（93%）、Inbox（91%）都在收尾階段；量體最重的是 116年重測（21 件完成 9 件、43%）。
未來 21 天共 25 筆，最擠的是 11/02。建議把進度通報提前在週末寫成草稿，讓週一只剩送件。

⚠️ 系統狀態
cron 心跳正常。本班無異常。`

describe('parseBrief', () => {
  const p = parseBrief(SAMPLE, '2026-10-31')!
  it('拆出優先卡', () => {
    expect(p.tasks).toHaveLength(2)
    expect(p.tasks[0]).toEqual({ title: '訂房 — 三天兩夜', project: '2026-11-26 旅遊專案', due: '2026-11-01', why: '這是第一個實體前置。', next: '先定地點與預算。' })
    expect(p.tasks[1]).toMatchObject({ title: '繳交B表', project: '116年重測', due: '2026-11-02' })
  })
  it('進度由低到高；含「21 件完成 9 件、43%」寫法', () => {
    expect(p.progress).toEqual([{ name: '116年重測', pct: 43 }, { name: 'Inbox', pct: 91 }, { name: '115年農地重劃二圖', pct: 93 }])
  })
  it('抓出建議句與系統燈', () => {
    expect(p.tip).toContain('建議把進度通報提前')
    expect(p.system?.ok).toBe(true)
    expect(parseBrief(SAMPLE.replace('本班無異常', 'L3 失敗'), '2026-10-31')?.system?.ok).toBe(false)
  })
  it('認不出格式回 null，由畫面退回原文', () => {
    expect(parseBrief('隨便一段文字', '2026-10-31')).toBeNull()
  })
})

describe('dueDate', () => {
  it('跨年算明年', () => {
    expect(dueDate('到期 1/05', '2026-12-20')).toBe('2027-01-05')
    expect(dueDate('到期 11/01（週日）', '2026-10-31')).toBe('2026-11-01')
    expect(dueDate('沒有日期', '2026-10-31')).toBeNull()
  })
})

describe('crowdOf', () => {
  const t = (id: number, due: string | null, done = false) => ({ id, title: `T${id}`, projectId: 1, start: null, end: null, due, done, doneAt: null, priority: 0, percentDone: 0 })
  const g = { tasks: [t(1, '2026-11-02'), t(2, '2026-11-02'), t(3, '2026-10-30'), t(4, '2026-11-01', true), t(5, null)] } as unknown as GanttData
  it('只算未完成；分出逾期與最擠的一天', () => {
    const c = crowdOf(g, '2026-10-31')!
    expect(c).toMatchObject({ overdue: 1, total: 2 })
    expect(c.busiest).toMatchObject({ date: '2026-11-02', weekday: '一', weekend: false, titles: ['T1', 'T2'] })
    expect(c.days).toHaveLength(21)
    expect(c.days[0]).toMatchObject({ weekday: '六', weekend: true })
  })
  it('讀不到甘特圖回 null', () => {
    expect(crowdOf(null, '2026-10-31')).toBeNull()
  })
})

describe('dueLabel', () => {
  it('相對報告日期', () => {
    expect(dueLabel('2026-10-31', '2026-10-31')).toEqual({ text: '當天到期', hot: true })
    expect(dueLabel('2026-11-02', '2026-10-31')).toEqual({ text: '2 天後・11/2', hot: true })
    expect(dueLabel('2026-10-29', '2026-10-31')?.text).toBe('逾期 2 天')
    expect(dueLabel('2026-11-20', '2026-10-31')?.hot).toBe(false)
    expect(dueLabel(null, '2026-10-31')).toBeNull()
  })
})
