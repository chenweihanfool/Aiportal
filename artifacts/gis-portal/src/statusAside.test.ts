import { describe, expect, it } from 'vitest'
import {
  deltaText, dimCell, dimDelta, dimRecentValues, knowledgeWeek, knowledgeWeekText, parsePushStats, parseRecent, parseSearchStats, pctText,
  serviceSummary, sparkPoints, todayLine, userCorrections,
} from './statusAside'
import type { Topic, TopicClaim } from './knowledgeView'
import type { UsageData } from './boardApi'
import type { PaidServicesData } from './paidServicesView'

const TODAY = '2026-11-14'
const day = (n: number) => new Date(Date.parse(`${TODAY}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10)
const hist = (vals: Array<number | null>, key = 'calm') => vals.map((v, i) => ({ date: day(-(vals.length - 1 - i)), components: { [key]: v } }))

describe('dimRecentValues／dimDelta', () => {
  it('取最近 7 個有值的日子（舊→新），跳過 null 與沒有 components 的日子', () => {
    const h = [...hist([1, 2, 3, null, 5, 6, 7, 8, 9, 10]), { date: day(-20) }]
    expect(dimRecentValues(h, 'calm', TODAY)).toEqual([3, 5, 6, 7, 8, 9, 10])
  })
  it('未來日期與沒有該 key 的列不算；值夾在 0–100；順序不拘', () => {
    const h = [{ date: day(1), components: { calm: 50 } }, { date: day(-1), components: { calm: 150 } }, { date: day(-2), components: { fitness: 5 } }, { date: day(0), components: { calm: -3 } }]
    expect(dimRecentValues(h, 'calm', TODAY)).toEqual([100, 0])
  })
  it('history 不是陣列回 []', () => {
    expect(dimRecentValues(null, 'calm', TODAY)).toEqual([])
    expect(dimRecentValues(undefined, 'calm', TODAY)).toEqual([])
  })
  it('今天與平均的差：取整；少於 2 天或今天沒分數＝null', () => {
    expect(dimDelta(80, [70, 70, 70, 70, 70, 70, 70])).toBe(10)
    expect(dimDelta(60, [70, 80])).toBe(-15)
    expect(dimDelta(75, [75, 75])).toBe(0)
    expect(dimDelta(80, [70])).toBeNull()
    expect(dimDelta(80, [])).toBeNull()
    expect(dimDelta(null, [70, 80])).toBeNull()
  })
})

describe('deltaText', () => {
  it('▲n／▼n／—', () => {
    expect(deltaText(3)).toBe('▲3')
    expect(deltaText(-4)).toBe('▼4')
    expect(deltaText(0)).toBe('—')
    expect(deltaText(null)).toBe('—')
  })
})

describe('sparkPoints', () => {
  it('少於 2 點不畫', () => {
    expect(sparkPoints([])).toBeNull()
    expect(sparkPoints([50])).toBeNull()
  })
  it('點數＝值數、x 從 0 到 w、較高的值 y 較小', () => {
    const p = sparkPoints([50, 60, 70], 60, 16, 2)!.split(' ').map((s) => s.split(',').map(Number) as [number, number])
    expect(p).toHaveLength(3)
    expect(p[0]![0]).toBe(0)
    expect(p[2]![0]).toBe(60)
    expect(p[2]![1]).toBeLessThan(p[0]![1])
  })
  it('幾乎持平的線不會被放大成滿版起伏', () => {
    const p = sparkPoints([70, 71], 60, 16, 2)!.split(' ').map((s) => Number(s.split(',')[1]))
    expect(Math.abs(p[0]! - p[1]!)).toBeLessThan(3)
  })
  it('y 都在 pad 與 h-pad 之間', () => {
    for (const s of sparkPoints([10, 90, 50, 20], 60, 16, 2)!.split(' ')) {
      const y = Number(s.split(',')[1])
      expect(y).toBeGreaterThanOrEqual(2)
      expect(y).toBeLessThanOrEqual(14)
    }
  })
})

describe('dimCell', () => {
  it('組合差與迷你線', () => {
    const c = dimCell(hist([70, 70, 70, 70, 70, 70, 70]), 'calm', 80, TODAY)
    expect(c.delta).toBe(10)
    expect(c.spark).not.toBeNull()
  })
  it('資料不足（只有 1 天）：差與線都沒有', () => {
    const c = dimCell(hist([70]), 'calm', 80, TODAY)
    expect(c.delta).toBeNull()
    expect(c.spark).toBeNull()
  })
  it('完全沒有 history：仍回今天分數', () => {
    expect(dimCell(null, 'calm', 66, TODAY)).toEqual({ key: 'calm', value: 66, delta: null, spark: null })
  })
})

const topic = (o: Partial<Topic> & { id: string }): Topic => ({
  name: o.id, kind: 'concept', why: '', firstSeen: '2026-01-01', lastSeen: null, updated: null, revision: 1, docs: 1, newDocs: 0, monthsSpan: 1, firstMonth: null, lastMonth: null,
  body: null, growth: [], sources: [], related: [], branch: null, path: [], monthCounts: [], diagram: null, ...o,
})
const claim = (id: string, firstSeen: string): TopicClaim => ({ id, section: 'what', status: 'active', origin: 'model', pinned: false, firstSeen, lastChanged: firstSeen, text: '- x' })
const NOW = new Date(`${TODAY}T04:00:00Z`)

describe('knowledgeWeek／userCorrections', () => {
  const topics = [
    topic({ id: 'a', firstSeen: day(-20), growth: [{ date: day(-2), text: '新頁' }], claims: [claim('c1', day(-1)), claim('c2', day(-30))], claimStats: { active: 2, retired: 0, disputed: 0, user: 2 } }),
    topic({ id: 'b', firstSeen: day(-40), growth: [{ date: day(-40), text: '舊頁' }, { date: day(-3), text: '改版' }], claims: [claim('c3', day(-6)), claim('c4', day(-7))], claimStats: { active: 2, retired: 0, disputed: 0, user: 1 } }),
    topic({ id: 'c', firstSeen: day(-90) }),
  ]
  it('7 天內新增的頁數（只算 new-page，改版不算）與新句子數（firstSeen 在 7 天內）', () => {
    const k = knowledgeWeek(topics, NOW)
    expect(k.pages).toBe(1)
    expect(k.claims).toBe(2)
    expect(knowledgeWeekText(k)).toBe('+1 頁・+2 句')
  })
  it('沒有題目時是 +0 頁・+0 句', () => expect(knowledgeWeekText(knowledgeWeek([], NOW))).toBe('+0 頁・+0 句'))
  it('你的更正：claimStats.user 加總，沒有 claimStats 的題目算 0', () => expect(userCorrections(topics)).toBe(3))
})

describe('pctText', () => {
  it('比例轉百分比', () => {
    expect(pctText(0.333)).toBe('33.3%')
    expect(pctText(0.5)).toBe('50%')
    expect(pctText(0)).toBe('0%')
    expect(pctText(1)).toBe('100%')
  })
  it('不是數字回 —', () => {
    expect(pctText(null)).toBe('—')
    expect(pctText(undefined)).toBe('—')
    expect(pctText(Number.NaN)).toBe('—')
  })
})

describe('統計解析', () => {
  it('search stats：契約的實際 payload', () => {
    const s = parseSearchStats({ days: 7, searches: 3, zero: 1, zeroRate: 0.333, clicked: 2, clickRate: 0.667, topZero: [{ q: '鑑界', count: 2 }, { q: 5, count: 1 }, null] })!
    expect(s).toMatchObject({ days: 7, searches: 3, zero: 1, zeroRate: 0.333, clicked: 2, clickRate: 0.667 })
    expect(s.topZero).toEqual([{ q: '鑑界', count: 2 }])
  })
  it('search stats：缺必要欄位回 null', () => {
    expect(parseSearchStats({})).toBeNull()
    expect(parseSearchStats(null)).toBeNull()
    expect(parseSearchStats({ searches: '3', zeroRate: 0 })).toBeNull()
  })
  it('push stats：契約的實際 payload', () => {
    const p = parsePushStats({ days: 14, shown: 10, opened: 5, openRate: 0.5, useful: 3, useless: 2, uselessRate: 0.2, byKind: [{ kind: 'topic', shown: 6, opened: 4, useless: 1 }, { shown: 1 }], daysWithCards: 7 })!
    expect(p).toMatchObject({ days: 14, shown: 10, opened: 5, openRate: 0.5, useful: 3, useless: 2, uselessRate: 0.2, daysWithCards: 7 })
    expect(p.byKind).toEqual([{ kind: 'topic', shown: 6, opened: 4, useless: 1 }])
  })
  it('push stats：缺必要欄位回 null', () => {
    expect(parsePushStats({ shown: 1 })).toBeNull()
    expect(parsePushStats('x')).toBeNull()
  })
  it('recent：去重、去空、最多 5 個、非字串略過', () => {
    expect(parseRecent({ recent: ['a', ' a ', '', 'b', 3, 'c', 'd', 'e', 'f'] })).toEqual(['a', 'b', 'c', 'd', 'e'])
    expect(parseRecent({})).toEqual([])
    expect(parseRecent(null)).toEqual([])
  })
})

const usageOk = { balance: { enteredAt: 'x', balanceUsd: 30, capUsd: 60, refillAt: null, monthUsedUsd: 0, note: 'auto' }, forecast: { level: 'ok', daysUntilEmpty: null, emptyDate: null } } as unknown as UsageData
const paidOk = {
  deepseek: { status: 'ok', data: { available: true, balances: [{ currency: 'CNY', total: 80, granted: 0, toppedUp: 80 }] } },
  tavily: { status: 'ok', data: { plan: null, used: 10, limit: 1000, accountUsed: null, accountLimit: null } }, fetchedAt: 'x',
} as PaidServicesData

describe('serviceSummary', () => {
  it('兩個端點都沒資料：看用量', () => expect(serviceSummary({ usage: null, paid: null })).toEqual({ text: '看用量', abnormal: false }))
  it('都正常：N 項自動讀取', () => expect(serviceSummary({ usage: usageOk, paid: paidOk })).toEqual({ text: '3 項自動讀取，正常', abnormal: false }))
  it('餘額低（warn）：點名並標異常', () => {
    const low = { ...usageOk, forecast: { ...(usageOk as unknown as { forecast: object }).forecast, level: 'warn' } } as unknown as UsageData
    const r = serviceSummary({ usage: low, paid: paidOk })
    expect(r.abnormal).toBe(true)
    expect(r.text).toContain('Ollama')
  })
  it('DeepSeek 讀取失敗：異常', () => {
    const r = serviceSummary({ usage: usageOk, paid: { ...paidOk, deepseek: { status: 'error', message: 'HTTP 500' } } })
    expect(r).toEqual({ text: 'DeepSeek 要注意', abnormal: true })
  })
  it('額度端點整個失敗：異常', () => {
    expect(serviceSummary({ usage: usageOk, paid: null, paidError: true })).toMatchObject({ abnormal: true, text: expect.stringContaining('額度端點') })
  })
})

describe('todayLine', () => {
  it('一句話＋建議合成一行', () => expect(todayLine('今天比昨天好。', '去走路')).toBe('今天比昨天好。　👉 去走路'))
  it('只有一句話', () => expect(todayLine('今天比昨天好。', null)).toBe('今天比昨天好。'))
  it('都沒有回 null', () => expect(todayLine('', null)).toBeNull())
})
