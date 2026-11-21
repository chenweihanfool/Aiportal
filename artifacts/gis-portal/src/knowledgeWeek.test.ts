import { describe, expect, it } from 'vitest'
import { cleanClaimText, knowledgeWeekDetail, userCorrectionDetail } from './knowledgeWeek'
import { knowledgeWeek, userCorrections } from './statusAside'
import type { Topic, TopicClaim } from './knowledgeView'

const TODAY = '2026-11-14'
const day = (n: number) => new Date(Date.parse(`${TODAY}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10)
const NOW = new Date(`${TODAY}T04:00:00Z`)

const topic = (o: Partial<Topic> & { id: string; name: string }): Topic => ({
  kind: 'concept', why: '', firstSeen: day(-100), lastSeen: null, updated: null, revision: 1, docs: 1, newDocs: 0, monthsSpan: 1, firstMonth: null, lastMonth: null,
  body: null, growth: [], sources: [], related: [], branch: null, path: [], monthCounts: [], diagram: null, ...o,
})
const claim = (o: Partial<TopicClaim> & { id: string }): TopicClaim => ({
  section: 'what', status: 'active', origin: 'model', pinned: false, firstSeen: day(-1), lastChanged: day(-1), text: '- x', ...o,
})

describe('cleanClaimText', () => {
  it('去掉開頭「- 」或「* 」與 ⟦n⟧ 標記並 trim', () => {
    expect(cleanClaimText('- 這是句子 ⟦1⟧')).toBe('這是句子')
    expect(cleanClaimText('* 這是句子⟦2⟧⟦12⟧ 尾')).toBe('這是句子 尾')
    expect(cleanClaimText('  沒有符號  ')).toBe('沒有符號')
    expect(cleanClaimText('-')).toBe('-')
  })
})

const topics = [
  topic({
    id: 'a', name: '甲題', firstSeen: day(-30),
    growth: [{ date: day(-1), text: '新增 2 個來源' }],
    claims: [
      claim({ id: 'a1', firstSeen: day(-6), text: '- 甲一⟦1⟧' }),
      claim({ id: 'a2', firstSeen: day(-1), text: '- 甲二' }),
      claim({ id: 'a3', firstSeen: day(-20), text: '- 舊句' }),
      claim({ id: 'ua1', origin: 'user', firstSeen: day(-20), lastChanged: day(-2), text: '- 我補的甲' }),
    ],
    claimStats: { active: 3, retired: 0, disputed: 0, user: 1 },
  }),
  topic({
    id: 'b', name: '乙題', firstSeen: day(-60),
    growth: [{ date: day(-40), text: '舊頁' }, { date: day(-5), text: '改版一' }, { date: day(-1), text: '改版二' }],
    claims: [
      claim({ id: 'b1', firstSeen: day(-3), text: '- 乙二' }),
      claim({ id: 'b2', firstSeen: day(-1), text: '- 乙一⟦3⟧' }),
      claim({ id: 'b3', firstSeen: day(-6), text: '- 乙三' }),
      claim({ id: 'ub1', origin: 'user', firstSeen: day(-20), lastChanged: day(-1), text: '- 我補的乙一' }),
      claim({ id: 'ub2', origin: 'user', firstSeen: day(-20), lastChanged: day(-4), text: '我補的乙二', status: 'disputed' }),
    ],
    claimStats: { active: 3, retired: 0, disputed: 1, user: 2 },
  }),
  topic({ id: 'c', name: '丙題', firstSeen: day(-90), claims: [claim({ id: 'c1', firstSeen: day(-2), text: '- 丙一' })] }),
  topic({ id: 'd', name: '丁題', firstSeen: day(-80), growth: [{ date: day(-30), text: '舊頁' }, { date: day(-5), text: '改版一' }, { date: day(-1), text: '改版二' }] }),
  topic({ id: 'e', name: '乙二題', firstSeen: day(-70), claims: [claim({ id: 'e1', firstSeen: day(-4), text: '- 乙二題一' })] }),
  topic({
    id: 'f', name: '戊題', firstSeen: day(-50),
    growth: [{ date: day(-2), text: '新增 1 個來源' }],
    claims: [claim({ id: 'u1', origin: 'user', lastChanged: day(-2), status: 'disputed', text: '- 我補的' })],
  }),
]

describe('knowledgeWeekDetail', () => {
  it('pages 只收 new-page，新→舊', () => {
    const d = knowledgeWeekDetail(topics, NOW)
    expect(d.pages.map((r) => r.id)).toEqual(['a', 'f'])
    expect(d.pages.map((r) => r.date)).toEqual([day(-1), day(-2)])
    expect(d.pages[0]).toMatchObject({ name: '甲題', kind: 'concept', detail: '新增 2 個來源' })
  })

  it('revised 只收 revised，同題多天只留最新一天，新→舊', () => {
    const d = knowledgeWeekDetail(topics, NOW)
    expect(d.revised.map((r) => r.id).sort()).toEqual(['b', 'd'])
    expect(d.revised.every((r) => r.date === day(-1))).toBe(true)
    expect(d.revised.find((r) => r.id === 'b')!.detail).toBe('改版二')
  })

  it('claimGroups 組內 firstSeen 新→舊、text 已清洗；組依句數多→少、同數依題名', () => {
    const d = knowledgeWeekDetail(topics, NOW)
    expect(d.claimGroups.map((g) => [g.id, g.claims.length])).toEqual([['b', 3], ['a', 2], ['c', 1], ['e', 1], ['f', 1]])
    expect(d.claimGroups[0]!.claims.map((c) => c.firstSeen)).toEqual([day(-1), day(-3), day(-6)])
    expect(d.claimGroups[1]!.claims.map((c) => c.text)).toEqual(['甲二', '甲一'])
    // d 沒有句子；f 的更正 firstSeen 預設 day(-1)，也算這週新句子
    expect(d.claimGroups.find((g) => g.id === 'f')!.claims.map((c) => c.id)).toEqual(['u1'])
  })

  it('totals 與 knowledgeWeek 的頁數／句數一致', () => {
    const d = knowledgeWeekDetail(topics, NOW)
    const k = knowledgeWeek(topics, NOW)
    expect(d.totals).toEqual(k)
    expect(d.totals.pages).toBe(2)
    expect(d.totals.claims).toBe(8)
  })

  it('沒有資料：三段都空、totals 為 0', () => {
    const d = knowledgeWeekDetail([], NOW)
    expect(d).toEqual({ pages: [], revised: [], claimGroups: [], totals: { pages: 0, claims: 0 } })
  })
})

describe('userCorrectionDetail', () => {
  it('只收 origin user 的句子；組內與組間依 lastChanged 新→舊；disputed 標記', () => {
    const d = userCorrectionDetail(topics)
    expect(d.total).toBe(userCorrections(topics))
    expect(d.total).toBe(3)
    expect(d.groups.map((g) => g.id)).toEqual(['b', 'a', 'f'])
    expect(d.groups[0]!.claims.map((c) => c.lastChanged)).toEqual([day(-1), day(-4)])
    expect(d.groups[0]!.claims[1]).toEqual({ id: 'ub2', text: '我補的乙二', lastChanged: day(-4), disputed: true })
    expect(d.groups[2]!.claims).toEqual([{ id: 'u1', text: '我補的', lastChanged: day(-2), disputed: true }])
    expect(d.missingText).toBe(false)
  })

  it('total>0 但沒有 origin user 句子時 missingText', () => {
    const t = topic({ id: 'x', name: '某題', claims: [claim({ id: 'm1' })], claimStats: { active: 1, retired: 0, disputed: 0, user: 2 } })
    const d = userCorrectionDetail([t])
    expect(d).toEqual({ total: 2, groups: [], missingText: true })
  })

  it('total 為 0：groups 空、missingText 不算', () => {
    expect(userCorrectionDetail([])).toEqual({ total: 0, groups: [], missingText: false })
    expect(userCorrectionDetail([topic({ id: 'x', name: '某題' })])).toEqual({ total: 0, groups: [], missingText: false })
  })
})
