import { describe, expect, it } from 'vitest'
import {
  addDays, atHours, buildCards, cardKeyOf, countLabel, defaultDay, hash, railPos, sortCards, visibleCards, type NowCard,
} from './nowCards'
import type { CompanionData, PersonAction } from './companion'
import type { NudgeMatch, TopicNudges } from './topicNudges'

const TODAY = '2026-11-13'

const match = (o: Partial<NudgeMatch> & { topicId: string }): NudgeMatch => ({
  forDate: TODAY, name: o.topicId, path: ['測量', '鑑界'], published: true, point: '要點', triggers: [{ kind: 'task', title: '機密任務標題', due: TODAY }], score: 50, ...o,
})

const nudges = (o: Partial<TopicNudges> = {}): TopicNudges => ({ computedAt: 'x', date: TODAY, matches: [], recall: [], ...o })

const quietPeople = (names: string[]) => names.map((name) => ({ name, lastDate: '2026-10-01', daysQuiet: 43, events: 3, usualGapDays: 14 }))
const companion = (names: string[]): CompanionData => ({ computedAt: 'x', date: TODAY, onThisDay: [], quietPeople: quietPeople(names), socialDays: [] })

const base = { companion: null, personActions: [] as PersonAction[] | null, brief: null, day: 'today' as const, todayIso: TODAY, nudges: null as TopicNudges | null }

describe('hash', () => {
  it('固定輸入有固定輸出（FNV-1a 32 位，36 進位）', () => {
    expect(hash('')).toBe('ztntfp')
    expect(hash('a')).toBe('1r9wi7g')
    expect(hash('王先生')).toBe(hash('王先生'))
    expect(hash('王先生')).not.toBe(hash('王小姐'))
  })
})

describe('cardKeyOf', () => {
  it('各種卡片的格式', () => {
    expect(cardKeyOf({ kind: 'topic', topicId: 'T1', matchedBy: 'case', caseName: '王案', firstTrigger: 'x' })).toBe('topic:T1:case:王案')
    expect(cardKeyOf({ kind: 'topic', topicId: 'T1', matchedBy: 'terms', caseName: null, firstTrigger: '寫報告' })).toBe(`topic:T1:terms:${hash('寫報告')}`)
    expect(cardKeyOf({ kind: 'topic', topicId: 'T1', firstTrigger: '寫報告' })).toBe(`topic:T1:terms:${hash('寫報告')}`)
    expect(cardKeyOf({ kind: 'resume', caseName: '王案' })).toBe('resume:王案')
    expect(cardKeyOf({ kind: 'recall', topicId: 'T2' })).toBe('recall:T2')
    expect(cardKeyOf({ kind: 'quiet', name: '阿哲' })).toBe(`quiet:${hash('阿哲')}`)
    expect(cardKeyOf({ kind: 'brief', date: '2026-11-14' })).toBe('brief:2026-11-14')
  })
  it('任務標題與人名原文不會出現在鍵裡', () => {
    const cards = buildCards({ ...base, nudges: nudges({ matches: [match({ topicId: 'T1' })] }), companion: companion(['阿哲']) })
    expect(cards.length).toBe(2)
    for (const c of cards) {
      expect(c.key).not.toContain('機密任務標題')
      expect(c.key).not.toContain('阿哲')
    }
  })
})

describe('defaultDay', () => {
  it('台北 21:00（UTC 13:00）切到明天', () => {
    expect(defaultDay(Date.parse('2026-11-13T12:59:00Z'))).toBe('today')
    expect(defaultDay(Date.parse('2026-11-13T13:00:00Z'))).toBe('tomorrow')
    expect(defaultDay(Date.parse('2026-11-13T16:00:00Z'))).toBe('today') // 台北隔天 00:00
  })
})

describe('railPos／atHours', () => {
  it('08–22 對應 0～100，範圍外夾值', () => {
    expect(railPos('08:00')).toBe(0)
    expect(railPos('15:00')).toBe(50)
    expect(railPos('22:00')).toBe(100)
    expect(railPos('06:30')).toBe(0)
    expect(railPos('23:30')).toBe(100)
    expect(railPos(null)).toBeNull()
    expect(railPos('abc')).toBeNull()
  })
  it('atHours 解析 HH:MM', () => {
    expect(atHours('09:30')).toBe(9.5)
    expect(atHours('25:00')).toBeNull()
  })
})

describe('buildCards', () => {
  it('舊格式 feed（沒有 why／at／matchedBy／resumes）也能組出卡', () => {
    const cards = buildCards({ ...base, nudges: nudges({ matches: [match({ topicId: 'T1' })] }) })
    expect(cards).toHaveLength(1)
    expect(cards[0].why).toBe('任務「機密任務標題」')
    expect(cards[0].at).toBeNull()
    expect(cards[0].key).toBe(`topic:T1:terms:${hash('機密任務標題')}`)
  })
  it('新欄位：why、at、case 比對、resumes', () => {
    const cards = buildCards({
      ...base,
      nudges: nudges({
        matches: [match({ topicId: 'T1', why: '14:00 任務', at: '14:00', matchedBy: 'case', caseName: '王案' })],
        resumes: [{ forDate: TODAY, at: null, caseName: '王案', quietDays: 39, why: '停了 39 天', events: [{ date: '2026-10-05', title: '電話' }, { date: '2026-10-02', title: '收件' }] }],
      }),
    })
    expect(cards.map((c) => c.kind)).toEqual(['topic', 'resume'])
    expect(cards[0].why).toBe('14:00 任務')
    expect(cards[1].lines).toEqual(['10/05 電話', '10/02 收件'])
  })
  it('今天分頁只收 forDate＝今天；明天分頁收明天的 topic、brief，不收 recall／quiet', () => {
    const n = nudges({ matches: [match({ topicId: 'A' }), match({ topicId: 'B', forDate: '2026-11-14' })], recall: [{ topicId: 'R', name: 'R', path: [], published: true, point: '', reason: '去年這時候', lastMonth: null, years: [] }] })
    const brief = { date: '2026-11-14', summary: '3 項任務' }
    const today = buildCards({ ...base, nudges: n, companion: companion(['甲']), brief })
    expect(today.map((c) => c.kind).sort()).toEqual(['quiet', 'recall', 'topic'])
    expect(today.find((c) => c.kind === 'topic')?.topicId).toBe('A')
    const tomorrow = buildCards({ ...base, nudges: n, companion: companion(['甲']), brief, day: 'tomorrow' })
    expect(tomorrow.map((c) => c.kind).sort()).toEqual(['brief', 'topic'])
    expect(tomorrow.find((c) => c.kind === 'topic')?.topicId).toBe('B')
  })
  it('quiet：沿用 visibleQuietPeople 與 rotateQuiet，why 帶平常間隔；提醒設定沒讀到（null）就不推', () => {
    const actions: PersonAction[] = [{ name: '乙', action: 'never', until: null, reason: null, updatedAt: '2026-11-01T00:00:00Z' }]
    const cards = buildCards({ ...base, companion: companion(['甲', '乙', '丙']), personActions: actions })
    expect(cards.map((c) => c.person)).toEqual(['甲', '丙'])
    expect(cards[0].why).toBe('平常約 14 天聯絡一次，已 43 天')
    expect(buildCards({ ...base, companion: companion(['甲']), personActions: null })).toEqual([])
  })
})

describe('sortCards', () => {
  const c = (key: string, rank: number, at: string | null): NowCard => ({ key, kind: 'topic', forDate: TODAY, at, why: '', title: key, lines: [], point: '', rank })
  it('有 at 的依時間先，其餘依 rank', () => {
    const sorted = sortCards([c('brief', 5, null), c('late', 2, '16:00'), c('case', 0, null), c('early', 3, '09:30'), c('terms', 2, null)])
    expect(sorted.map((x) => x.key)).toEqual(['early', 'late', 'case', 'terms', 'brief'])
  })
  it('同 rank 保持原順序', () => {
    expect(sortCards([c('a', 2, null), c('b', 2, null)]).map((x) => x.key)).toEqual(['a', 'b'])
  })
})

describe('visibleCards', () => {
  const many = Array.from({ length: 7 }, (_, i): NowCard => ({ key: `k${i}`, kind: 'recall', forDate: TODAY, at: null, why: '', title: `t${i}`, lines: [], point: '', rank: i }))
  const now = Date.parse('2026-11-13T05:00:00Z')
  it('取前 5 則', () => {
    expect(visibleCards(many, null, now)).toHaveLength(5)
  })
  it('濾掉 suppressed 與本機待送的沒用，後面的候補遞補', () => {
    const v = visibleCards(many, { suppressed: ['k0'], later: [] }, now, ['k1'])
    expect(v.map((x) => x.key)).toEqual(['k2', 'k3', 'k4', 'k5', 'k6'])
  })
  it('later：until 之前濾掉、之後回來', () => {
    const fb = { suppressed: [], later: [{ cardKey: 'k0', until: '2026-11-13T20:00:00+08:00' }] }
    expect(visibleCards(many, fb, Date.parse('2026-11-13T11:59:00Z')).map((x) => x.key)).not.toContain('k0')
    expect(visibleCards(many, fb, Date.parse('2026-11-13T12:00:00Z')).map((x) => x.key)).toContain('k0')
  })
})

describe('其他', () => {
  it('countLabel 兩位數', () => {
    expect(countLabel(3)).toBe('03 / 05')
  })
  it('addDays', () => {
    expect(addDays('2026-11-30', 1)).toBe('2026-12-01')
  })
})
