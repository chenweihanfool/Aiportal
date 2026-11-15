import { describe, expect, it } from 'vitest'
import type { IdeaItem } from './boardApi'
import { STATUS_ICON, STATUS_LABEL, absorbBadges, categoryColor, categoryCounts, moodPicks, pips, sortForList, topIdeas } from './ideasView'

const idea = (id: string, over: Partial<IdeaItem> = {}): IdeaItem => ({
  id, title: id, category: '系統', dimension: null, source: 'HERMES', why: null, value: 3, effort: 3, status: 'new',
  bornAt: '2026-10-01T10:00:00+08:00', lastMentioned: '2026-10-01T10:00:00+08:00', mentions: 1, backfill: false,
  days: ['2026-10-01'], history: [], score: 9, scoreWhy: [], weakBoost: false, ...over,
})

describe('ideasView', () => {
  it('keeps API top order and skips missing ids', () => {
    const list = [idea('IDEA-0001'), idea('IDEA-0002'), idea('IDEA-0003')]
    expect(topIdeas(list, ['IDEA-0003', 'IDEA-0009', 'IDEA-0001']).map((i) => i.id)).toEqual(['IDEA-0003', 'IDEA-0001'])
  })
  it('sorts open by score then closed by recency', () => {
    const list = [
      idea('IDEA-0001', { score: 5 }),
      idea('IDEA-0002', { status: 'done', score: null, lastMentioned: '2026-10-05T00:00:00+08:00' }),
      idea('IDEA-0003', { score: 12 }),
      idea('IDEA-0004', { status: 'dropped', score: null, lastMentioned: '2026-10-07T00:00:00+08:00' }),
    ]
    expect(sortForList(list).map((i) => i.id)).toEqual(['IDEA-0003', 'IDEA-0001', 'IDEA-0004', 'IDEA-0002'])
  })
  it('filters by category and stage', () => {
    const list = [idea('A', { category: '旅遊' }), idea('B', { status: 'done' }), idea('C', { category: null, status: 'shelved' })]
    expect(filterByStage(list, '旅遊', 'candidate').map((i) => i.id)).toEqual(['A'])
    expect(filterByStage(list, null, 'done').map((i) => i.id)).toEqual(['B'])
    expect(filterByStage(list, '未分類', 'archived').map((i) => i.id)).toEqual(['C'])
    expect(categoryCounts(list)).toEqual([['旅遊', 1], ['未分類', 1], ['系統', 1]])
    expect(stageCounts(list)).toEqual({ candidate: 1, focus: 0, archived: 1, done: 1, total: 3 })
  })
  it('gives stable colors and pips', () => {
    expect(categoryColor('系統')).toBe('#5f9bf0')
    expect(categoryColor('某個自訂類別')).toBe(categoryColor('某個自訂類別'))
    expect(categoryColor(null)).toBe('#5b6270')
    expect(pips(3)).toBe('●●●○○')
    expect(pips(null)).toBe('—')
  })
})

describe('🔀 absorbed ideas', () => {
  it('have a label and icon, count as archived, and are never an action target', () => {
    expect([STATUS_ICON.absorbed, STATUS_LABEL.absorbed]).toEqual(['🔀', '封存（併入）'])
    const list = [idea('IDEA-0039', { status: 'absorbed', score: null, mergedInto: 'IDEA-0022' }), idea('IDEA-0022'), idea('IDEA-0005', { status: 'dropped', score: null })]
    expect(filterByStage(list, null, 'archived').map((i) => i.id)).toEqual(['IDEA-0039', 'IDEA-0005'])
    expect(filterByStage(list, null, 'candidate').map((i) => i.id)).toEqual(['IDEA-0022'])
    expect(stageCounts(list)).toMatchObject({ candidate: 1, archived: 2, total: 3 })
    expect(nextActions('absorbed')).toEqual(['reopen'])
  })
  it('badges: merged-into arrow, and absorbed list capped at two plus a count', () => {
    expect(absorbBadges({ mergedInto: 'IDEA-0022', absorbed: [] })).toEqual({ mergedInto: '🔀 併入 → IDEA-0022', absorbed: null })
    expect(absorbBadges({ absorbed: ['IDEA-0039'] })).toEqual({ mergedInto: null, absorbed: '吸收：IDEA-0039' })
    expect(absorbBadges({ absorbed: ['A', 'B', 'C'] }).absorbed).toBe('吸收：A、B 等 3 個')
    expect(absorbBadges({})).toEqual({ mergedInto: null, absorbed: null })   // 舊 API 沒有新欄位
  })
})

import { buildLifeline, buildLineage, buildScatter, lifeStats, quadrantOf, scaleTime } from './ideasView'

describe('idea provenance (來龍去脈)', () => {
  const NOW = Date.parse('2026-10-22T12:00:00+08:00')
  it('builds a lifeline for a finished idea', () => {
    const lf = buildLifeline(idea('A', {
      status: 'done', bornAt: '2026-10-01T10:00:00+08:00', mentions: 3, days: ['2026-10-01', '2026-10-05', '2026-10-05', '2026-10-09'],
      history: [{ status: 'doing', at: '2026-10-12T09:00:00+08:00' }, { status: 'done', at: '2026-10-20T09:00:00+08:00' }],
    }), NOW)!
    expect(lf.ongoing).toBe(false)
    expect(lf.recalls.map((r) => r.date)).toEqual(['2026-10-01', '2026-10-05', '2026-10-09'])
    expect(lf.steps.map((s) => s.status)).toEqual(['new', 'doing', 'done'])
    expect(lf.daysAlive).toBe(19)
    expect(lf.summary).toBe('10/1 誕生 → 想起 3 次 → 10/12 聚焦 → 10/20 已完成（歷時 19 天）')
  })
  it('runs an open idea up to now, and survives bad data', () => {
    const lf = buildLifeline(idea('B', { history: [{ status: 'nonsense', at: 'x' }] }), NOW)!
    expect(lf.ongoing).toBe(true)
    expect(lf.endMs).toBe(NOW)
    expect(lf.steps).toHaveLength(1)
    expect(buildLifeline(idea('C', { bornAt: 'bad' }), NOW)).toBeNull()
  })
  it('scales time and tolerates a zero-length span', () => {
    expect(scaleTime(5, 0, 10, 0, 100)).toBe(50)
    expect(scaleTime(99, 0, 10, 0, 100)).toBe(100)
    expect(scaleTime(5, 5, 5, 0, 100)).toBe(50)
  })
  it('builds lineage from either side and ignores cycles', () => {
    const list = [
      idea('A', { absorbed: ['B', 'C'] }),
      idea('B', { status: 'absorbed', mergedInto: 'A' }),
      idea('C', { status: 'absorbed' }), // 只有承接者那邊記了
      idea('D'),
    ]
    const t = buildLineage(list, 'B')!
    expect(t.root.id).toBe('A')
    expect(t.root.children.map((c) => c.id)).toEqual(['B', 'C'])
    expect(t.size).toBe(3)
    expect(buildLineage(list, 'D')).toBeNull()
    const loop = [idea('X', { mergedInto: 'Y' }), idea('Y', { mergedInto: 'X', absorbed: ['X'] })]
    expect(buildLineage(loop, 'X')!.size).toBe(2)
  })
  it('scatters value × effort and counts the unrated', () => {
    const { points, skipped } = buildScatter([idea('A', { value: 5, effort: 1, mentions: 4 }), idea('B', { value: null })])
    expect(skipped).toBe(1)
    expect(points[0]).toMatchObject({ x: 1, y: 5, r: 7, open: true })
    expect(quadrantOf(5, 1)).toBe('quickWin')
    expect(quadrantOf(5, 4)).toBe('bigBet')
    expect(quadrantOf(2, 1)).toBe('chore')
    expect(quadrantOf(2, 5)).toBe('avoid')
  })
  it('summarises life stats', () => {
    const s = lifeStats([
      idea('A', { status: 'done', mentions: 3, history: [{ status: 'done', at: '2026-10-11T10:00:00+08:00' }] }),
      idea('B', { status: 'shelved', history: [{ status: 'shelved', at: '2026-10-21T10:00:00+08:00' }] }),
      idea('C'),
    ], NOW)
    expect(s).toEqual({ total: 3, closed: 2, medianDaysToClose: 15, recurring: 1 })
  })
})

import { hasMerge, matchesQuery, sortMergedGroups } from './ideasView'
import type { IdeaStatus } from './boardApi'
import { archiveReason, focusDays, ACTION_LABEL, ACTION_MARK, FOCUS_COLOR, FOCUS_ICON, FOCUS_LABEL, FOCUS_LIMIT, STAGE_COLOR, STAGE_ICON, STAGE_LABEL, actionMessage, filterByStage, ideaDashboard, isFocus, nextActions, stageCounts, stageOf } from './ideasView'
describe('idea search & merged filter', () => {
  const list = [
    idea('IDEA-0001', { title: '日記自動摘要', absorbed: ['IDEA-0002'] }),
    idea('IDEA-0002', { title: '每日回顧', status: 'absorbed', mergedInto: 'IDEA-0001', why: '跟摘要重複' }),
    idea('IDEA-0003', { title: '旅遊清單', category: '旅遊', absorbed: [] }),
    idea('IDEA-0004', { title: 'Docker 備份', status: 'absorbed', mergedInto: 'IDEA-0009' }), // 承接者不在清單內
  ]
  it('detects merges in both directions', () => {
    expect(list.map(hasMerge)).toEqual([true, true, false, true])
    expect(filterByStage(list, null, 'merged').map((i) => i.id)).toEqual(['IDEA-0001', 'IDEA-0002', 'IDEA-0004'])
  })
  it('searches id, title, why, category, partner id; all tokens must hit; case & width insensitive', () => {
    const ids = (q: string) => filterByStage(list, null, 'all', q).map((i) => i.id)
    expect(ids('摘要')).toEqual(['IDEA-0001', 'IDEA-0002'])
    expect(ids('摘要 回顧')).toEqual(['IDEA-0002'])
    expect(ids('docker')).toEqual(['IDEA-0004'])
    expect(ids('ＤＯＣＫＥＲ')).toEqual(['IDEA-0004'])
    expect(ids('idea-0003')).toEqual(['IDEA-0003'])
    expect(ids('旅遊')).toEqual(['IDEA-0003'])
    expect(ids('IDEA-0009')).toEqual(['IDEA-0004'])
    expect(ids('  ')).toHaveLength(4)
    expect(matchesQuery(list[0]!, '不存在')).toBe(false)
  })
  it('combines search with the merged filter', () => {
    expect(filterByStage(list, null, 'merged', '備份').map((i) => i.id)).toEqual(['IDEA-0004'])
  })
  it('groups merged ideas under their absorber', () => {
    const shuffled = [list[1]!, list[3]!, list[0]!]
    expect(sortMergedGroups(shuffled).map((i) => i.id)).toEqual(['IDEA-0001', 'IDEA-0002', 'IDEA-0004'])
  })
})

describe('三階段與聚焦', () => {
  it('stageOf 與 isFocus', () => {
    expect((['new', 'evaluating', 'doing'] as IdeaStatus[]).map(stageOf)).toEqual(['candidate', 'candidate', 'candidate'])
    expect((['shelved', 'dropped', 'absorbed', 'done'] as IdeaStatus[]).map(stageOf)).toEqual(['archived', 'archived', 'archived', 'done'])
    expect((['new', 'evaluating', 'doing', 'done'] as IdeaStatus[]).map(isFocus)).toEqual([false, false, true, false])
  })
  it('階段的標籤、圖示、顏色與聚焦上限', () => {
    expect([STAGE_LABEL.candidate, STAGE_LABEL.archived, STAGE_LABEL.done]).toEqual(['候選', '封存', '已完成'])
    expect([STAGE_ICON.candidate, STAGE_ICON.archived, STAGE_ICON.done]).toEqual(['🌱', '📦', '✅'])
    expect(STAGE_COLOR).toEqual({ candidate: '#e8b23d', archived: '#7a8190', done: '#5fbf7a' })
    expect([FOCUS_LABEL, FOCUS_ICON, FOCUS_COLOR, FOCUS_LIMIT]).toEqual(['聚焦', '🎯', '#f5a623', 3])
  })
  it('nextActions：候選可聚焦、聚焦可回候選、封存與已完成只能重開', () => {
    expect(nextActions('new')).toEqual(['focus', 'done', 'archive'])
    expect(nextActions('evaluating')).toEqual(['focus', 'done', 'archive'])
    expect(nextActions('doing')).toEqual(['unfocus', 'done', 'archive'])
    for (const s of ['shelved', 'dropped', 'absorbed', 'done'] as IdeaStatus[]) expect(nextActions(s)).toEqual(['reopen'])
  })
  it('actionMessage 與 statusMessage 同格式', () => {
    expect([ACTION_MARK.focus, ACTION_LABEL.focus]).toEqual(['🚀', '聚焦'])
    expect(actionMessage({ id: 'IDEA-0001', title: 'x' }, 'focus')).toBe('💡🚀 IDEA-0001「x」聚焦\n（請照想法庫格式寫進今天的日記）')
    expect(actionMessage({ id: 'IDEA-0002', title: 'y' }, 'archive', ' 先放著 ')).toBe('💡🗄️ IDEA-0002「y」封存\n先放著')
    expect(actionMessage({ id: 'IDEA-0003', title: 'z' }, 'reopen')).toContain('重新列為候選')
  })
  it('filterByStage 與 stageCounts：focus 只算聚焦、也在 candidate 內', () => {
    const list = [
      idea('S1', { absorbed: ['S7'] }), idea('S2', { status: 'evaluating' }), idea('S3', { status: 'doing' }), idea('S4', { status: 'done' }),
      idea('S5', { status: 'shelved' }), idea('S6', { status: 'dropped' }), idea('S7', { status: 'absorbed', mergedInto: 'S1' }),
    ]
    expect(stageCounts(list)).toEqual({ candidate: 3, focus: 1, archived: 3, done: 1, total: 7 })
    expect(filterByStage(list, null, 'candidate').map((i) => i.id)).toEqual(['S1', 'S2', 'S3'])
    expect(filterByStage(list, null, 'focus').map((i) => i.id)).toEqual(['S3'])
    expect(filterByStage(list, null, 'done').map((i) => i.id)).toEqual(['S4'])
    expect(filterByStage(list, null, 'archived').map((i) => i.id)).toEqual(['S5', 'S6', 'S7'])
    expect(filterByStage(list, null, 'merged').map((i) => i.id)).toEqual(['S1', 'S7'])
    expect(filterByStage(list, null, 'all')).toHaveLength(7)
    expect(filterByStage(list, '系統', 'candidate', 'S2').map((i) => i.id)).toEqual(['S2'])
  })
})

describe('ideaDashboard', () => {
  const NOW = Date.parse('2026-11-15T12:00:00+08:00')
  it('空陣列：不拋錯、12 個月全 0、其餘為 null 或空', () => {
    const d = ideaDashboard([], NOW)
    expect(d.counts).toEqual({ candidate: 0, focus: 0, archived: 0, done: 0, total: 0 })
    expect(d.focusOver).toBe(false)
    expect(d.staleFocus).toEqual([])
    expect(d.staleCandidates).toBe(0)
    expect(d.monthly).toHaveLength(12)
    expect(d.monthly[0]!.month).toBe('2025-12')
    expect(d.monthly[11]!.month).toBe('2026-11')
    expect(d.monthly.every((m) => m.born === 0 && m.done === 0)).toBe(true)
    expect(d.medianDaysToDone).toBeNull()
    expect(d.doneRate).toBeNull()
    expect(d.byCategory).toEqual([])
    expect(d.badges).toEqual([])
    expect(d.next).toBeNull()
  })
  it('一筆想法也能算', () => {
    const d = ideaDashboard([idea('ONE', { status: 'doing', lastMentioned: '2026-11-10T12:00:00+08:00' })], NOW)
    expect(d.counts).toEqual({ candidate: 1, focus: 1, archived: 0, done: 0, total: 1 })
    expect(d.focusOver).toBe(false)
    expect(d.doneRate).toBeNull()
    expect(d.next).toEqual({ target: 1, remaining: 1, ratio: 0 })
  })
  it('多筆：統計、久未想起、月度、中位天數、完成率、類別、徽章、下一個里程碑', () => {
    const list = [
      idea('IDEA-0001', { status: 'done', category: '系統', bornAt: '2026-09-01T10:00:00+08:00', lastMentioned: '2026-09-21T10:00:00+08:00', history: [{ status: 'done', at: '2026-09-21T10:00:00+08:00' }] }),
      idea('IDEA-0002', { status: 'done', category: '系統', bornAt: '2026-10-01T10:00:00+08:00', lastMentioned: '2026-10-11T10:00:00+08:00', history: [{ status: 'doing', at: '2026-10-05T10:00:00+08:00' }, { status: 'done', at: '2026-10-11T10:00:00+08:00' }] }),
      idea('IDEA-0003', { status: 'doing', category: '旅遊', lastMentioned: '2026-09-01T12:00:00+08:00' }),
      idea('IDEA-0004', { status: 'new', category: null, lastMentioned: '2026-07-01T12:00:00+08:00' }),
      idea('IDEA-0005', { status: 'shelved', category: '旅遊' }),
      idea('IDEA-0006', { status: 'dropped', category: '旅遊' }),
      idea('IDEA-0007', { status: 'absorbed', category: '系統', mergedInto: 'IDEA-0001' }),
      idea('IDEA-0008', { status: 'evaluating', category: null }),
    ]
    const d = ideaDashboard(list, NOW)
    expect(d.counts).toEqual({ candidate: 3, focus: 1, archived: 3, done: 2, total: 8 })
    expect(d.focusOver).toBe(false)
    expect(d.staleFocus).toEqual([{ id: 'IDEA-0003', title: 'IDEA-0003', days: 75 }])
    expect(d.staleCandidates).toBe(1)
    const m = (k: string) => d.monthly.find((x) => x.month === k)!
    expect(m('2026-09')).toEqual({ month: '2026-09', born: 1, done: 1 })
    expect(m('2026-10')).toEqual({ month: '2026-10', born: 7, done: 1 })
    expect(m('2026-11')).toEqual({ month: '2026-11', born: 0, done: 0 })
    expect(d.medianDaysToDone).toBe(15)
    expect(d.doneRate).toBe(0.5)
    expect(d.byCategory.find((c) => c.category === '系統')).toEqual({ category: '系統', total: 2, done: 2, rate: 1 })
    expect(d.byCategory.find((c) => c.category === '旅遊')).toEqual({ category: '旅遊', total: 3, done: 0, rate: 0 })
    expect(d.byCategory.find((c) => c.category === '未分類')).toEqual({ category: '未分類', total: 2, done: 0, rate: 0 })
    expect(d.byCategory[0]!.category).toBe('旅遊')
    expect(d.byCategory.reduce((n, c) => n + c.total, 0)).toBe(7)
    expect(d.badges.map((b) => b.id)).toEqual(['first', 'ladder-1', 'fastest', 'streak'])
    expect(d.badges[0]).toMatchObject({ detail: 'IDEA-0001（9/21）' })
    expect(d.badges[2]).toMatchObject({ detail: 'IDEA-0002（10 天）' })
    expect(d.badges[3]).toMatchObject({ detail: '2026-09～2026-10' })
    expect(d.next).toEqual({ target: 5, remaining: 3, ratio: 0.4 })
  })
  it('聚焦超過上限才算超額；久未想起滿 30／90 天就算', () => {
    const four = Array.from({ length: 4 }, (_, i) => idea(`F${i}`, { status: 'doing' as const, lastMentioned: '2026-10-16T12:00:00+08:00' }))
    const d = ideaDashboard(four, NOW)
    expect(d.focusOver).toBe(true)
    expect(d.staleFocus.map((x) => x.days)).toEqual([30, 30, 30, 30])
    const old = ideaDashboard([idea('O', { status: 'evaluating', lastMentioned: '2026-08-17T12:00:00+08:00' })], NOW)
    expect(old.staleCandidates).toBe(1)
  })
  it('月份以第一次 done 計；連續月與完成最多的月份；併入不算完成率分母', () => {
    const list = [
      idea('X', { status: 'done', bornAt: '2026-08-01T10:00:00+08:00', history: [{ status: 'done', at: '2026-09-10T10:00:00+08:00' }, { status: 'done', at: '2026-10-05T10:00:00+08:00' }] }),
      idea('Y', { status: 'done', bornAt: '2026-09-15T10:00:00+08:00', history: [{ status: 'done', at: '2026-10-15T10:00:00+08:00' }] }),
      idea('W', { status: 'done', bornAt: '2026-10-02T10:00:00+08:00', history: [{ status: 'done', at: '2026-10-20T10:00:00+08:00' }] }),
      idea('Z', { status: 'done', bornAt: '2026-10-10T10:00:00+08:00', history: [{ status: 'done', at: '2026-11-10T10:00:00+08:00' }] }),
      idea('ABS', { status: 'absorbed' }), idea('ABS2', { status: 'absorbed' }),
    ]
    const d = ideaDashboard(list, NOW)
    const m = (k: string) => d.monthly.find((x) => x.month === k)!
    expect(m('2026-09').done).toBe(1)
    expect(m('2026-10').done).toBe(2)
    expect(m('2026-11').done).toBe(1)
    expect(d.medianDaysToDone).toBe(31)
    expect(d.doneRate).toBe(1)
    expect(d.badges.find((b) => b.id === 'streak')).toMatchObject({ detail: '2026-09～2026-11' })
    expect(d.badges.find((b) => b.id === 'best-month')).toMatchObject({ detail: '2026-10（2 個）' })
    expect(d.next).toEqual({ target: 5, remaining: 1, ratio: 0.8 })
  })
  it('以台北時間切月', () => {
    const d = ideaDashboard([idea('T', { bornAt: '2026-09-30T16:30:00.000Z', history: [{ status: 'done', at: '2026-10-31T16:30:00.000Z' }] })], NOW)
    expect(d.monthly.find((m) => m.month === '2026-10')).toMatchObject({ born: 1 })
    expect(d.monthly.find((m) => m.month === '2026-11')).toMatchObject({ done: 1 })
  })
})

describe('archiveReason 與 focusDays', () => {
  it('封存原因只有放棄與併入', () => {
    expect([archiveReason('dropped'), archiveReason('absorbed'), archiveReason('shelved'), archiveReason('new')]).toEqual(['放棄', '併入', null, null])
  })
  it('聚焦天數取最後一次轉 doing；非聚焦或沒記到回 null', () => {
    const now = Date.parse('2026-11-15T12:00:00+08:00')
    const hist = [{ status: 'doing', at: '2026-10-01T10:00:00+08:00' }, { status: 'evaluating', at: '2026-10-05T10:00:00+08:00' }, { status: 'doing', at: '2026-11-05T10:00:00+08:00' }]
    expect(focusDays({ status: 'doing', history: hist }, now)).toBe(10)
    expect(focusDays({ status: 'doing', history: [] }, now)).toBeNull()
    expect(focusDays({ status: 'new', history: hist }, now)).toBeNull()
  })
})

describe('moodPicks', () => {
  const ideas = [
    idea('A', { value: 5, effort: 1, score: 5 }), // 快贏
    idea('B', { value: 4, effort: 2, score: 10 }), // 快贏
    idea('C', { value: 5, effort: 2, score: 3 }), // 快贏
    idea('D', { value: 2, effort: 4, score: 9 }), // 避開
    idea('H', { value: 5, effort: 4, score: 6 }), // 大案
    idea('G', { value: 2, effort: 1, score: 8 }), // 雜務
    idea('E', { status: 'doing', value: 5, effort: 1, score: 20 }),
    idea('F', { status: 'done', value: 5, effort: 1, score: 30 }),
    idea('S', { status: 'shelved', value: 5, effort: 1, score: 30 }),
  ]
  it('門檻：59.9 快贏、60 正常、79.9 正常、80 大案、null 正常', () => {
    expect(moodPicks(ideas, ideas, 59.9).mode).toBe('quick')
    expect(moodPicks(ideas, ideas, 60).mode).toBe('normal')
    expect(moodPicks(ideas, ideas, 79.9).mode).toBe('normal')
    expect(moodPicks(ideas, ideas, 80).mode).toBe('big')
    expect(moodPicks(ideas, ideas, null).mode).toBe('normal')
    expect(moodPicks(ideas, ideas, 60).picks.map((i) => i.id)).toEqual(['A', 'B', 'C'])
    expect(moodPicks(ideas, ideas, null).hint).toBeNull()
  })
  it('quick 依 score 高到低（null 視為 0、同分依 id），不足時用原本順序補位不重複', () => {
    const q = moodPicks(ideas, ideas, 50)
    expect(q.mode).toBe('quick')
    expect(q.picks.map((i) => i.id)).toEqual(['B', 'A', 'C'])
    expect(q.hint).toBe('今天幸福指數 50，先挑快贏的（價值高、難度低）')
    const few = [idea('Q', { value: 5, effort: 1, score: 1 }), idea('X', { value: 2, effort: 4, score: 9 }), idea('Y', { value: 2, effort: 1, score: 8 })]
    const fill = moodPicks(few, [few[1]!, few[0]!, few[2]!], 40)
    expect(fill.picks.map((i) => i.id)).toEqual(['Q', 'X', 'Y'])
    expect(new Set(fill.picks.map((i) => i.id)).size).toBe(3)
    const tie = [idea('T2', { value: 5, effort: 1, score: null }), idea('T1', { value: 5, effort: 1, score: 4 }), idea('T3', { value: 5, effort: 1, score: 4 })]
    expect(moodPicks(tie, tie, 0).picks.map((i) => i.id)).toEqual(['T1', 'T3', 'T2'])
  })
  it('池中沒有快贏時仍標 quick，但 hint 改成挑一個小的先做', () => {
    const chores = [idea('X', { value: 2, effort: 4, score: 9 }), idea('Y', { value: 2, effort: 1, score: 8 })]
    const r = moodPicks(chores, chores, 45)
    expect(r.mode).toBe('quick')
    expect(r.hint).toBe('今天幸福指數 45，挑一個小的先做')
    expect(r.picks.map((i) => i.id)).toEqual(['X', 'Y'])
  })
  it('big：有大案先推大案；沒有大案 mode 仍 big、hint null、picks 照原本順序', () => {
    const b = moodPicks(ideas, ideas, 85)
    expect(b.mode).toBe('big')
    expect(b.hint).toBe('今天狀態不錯（85），適合推一個大案')
    expect(b.picks[0]!.id).toBe('H')
    const noBig = [idea('A', { value: 5, effort: 1, score: 5 }), idea('D', { value: 2, effort: 4, score: 9 })]
    const n = moodPicks(noBig, noBig, 90)
    expect(n).toEqual({ picks: noBig, mode: 'big', hint: null })
  })
  it('聚焦與非候選不入池，也不會被補位選進來', () => {
    const top = [ideas[6]!, ideas[7]!, ideas[8]!, ideas[0]!, ideas[3]!] // E, F, S, A, D
    const r = moodPicks(ideas, top, 50)
    expect(r.picks.map((i) => i.id)).toEqual(['B', 'A', 'C'])
    expect(r.picks.every((i) => !['doing', 'done', 'shelved'].includes(i.status))).toBe(true)
    const normal = moodPicks(ideas, top, 70)
    expect(normal.picks.map((i) => i.id)).toEqual(['A', 'D'])
  })
})
