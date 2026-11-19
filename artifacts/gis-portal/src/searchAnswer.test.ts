import { describe, expect, it } from 'vitest'
import type { Topic } from './knowledgeView'
import type { StepDoc, TopicStep } from './knowledgeSteps'
import { answerFor, findTemplateUses } from './searchAnswer'

const doc = (templateId: string, family: string): StepDoc => ({ templateId, family, docType: '函', role: '公文', score: 0.9, others: 0, evidence: [] })
const step = (id: string, title: string, docs: StepDoc[], extra: Partial<TopicStep> = {}): TopicStep => ({
  id, title, claim: 'c001', node: null, docs, why: { rules: [], insights: [], pitfalls: [] }, cases: [], ...extra,
})
const topic = (id: string, steps: TopicStep[] | undefined, related: Topic['related'] = []): Topic => ({
  id, name: `題目${id}`, kind: 'method', why: '', firstSeen: '2026-01-01', lastSeen: null, updated: null, revision: 1, docs: 0, newDocs: 0,
  monthsSpan: 0, firstMonth: null, lastMonth: null, body: null, growth: [], sources: [], related, branch: null, path: [], monthCounts: [], diagram: null,
  ...(steps ? { steps } : {}),
})

const A = 'tpl_aaaaaaaaaa'
const B = 'tpl_bbbbbbbbbb'
const C = 'tpl_cccccccccc'

describe('findTemplateUses', () => {
  it('templateId 命中：回題目與第一個命中的步驟', () => {
    const t = topic('t1', [step('s1', '一', [doc(B, '乙')]), step('s2', '二', [doc(A, '甲')]), step('s3', '三', [doc(A, '甲')])])
    const r = findTemplateUses([t], A, '甲')
    expect(r).toHaveLength(1)
    expect(r[0].stepIndex).toBe(1)
  })
  it('templateId 都找不到才用 family 後備', () => {
    const t = topic('t1', [step('s1', '一', [doc(B, '甲')])])
    expect(findTemplateUses([t], A, '甲')[0].stepIndex).toBe(0)
    expect(findTemplateUses([t], A, '丙')).toEqual([])
  })
  it('有 templateId 命中時不混入 family 命中', () => {
    const t1 = topic('t1', [step('s1', '一', [doc(A, '甲')])])
    const t2 = topic('t2', [step('s1', '一', [doc(B, '甲')])])
    expect(findTemplateUses([t1, t2], A, '甲').map((u) => u.topic.id)).toEqual(['t1'])
  })
  it('多題目依 docs 由多到少排序、最多 3 筆', () => {
    const mk = (id: string, n: number) => topic(id, [step('s1', '一', [doc(A, '甲'), ...Array.from({ length: n }, (_, i) => doc(`tpl_${String(i).padStart(10, 'd')}`, `x${i}`))])])
    const r = findTemplateUses([mk('a', 0), mk('b', 3), mk('c', 1), mk('d', 2)], A, '甲')
    expect(r.map((u) => u.topic.id)).toEqual(['b', 'd', 'c'])
  })
  it('null、空陣列、沒有 steps 都回 []', () => {
    expect(findTemplateUses(null, A, '甲')).toEqual([])
    expect(findTemplateUses([], A, '甲')).toEqual([])
    expect(findTemplateUses([topic('t1', undefined), topic('t2', [])], A, '甲')).toEqual([])
  })
})

describe('answerFor', () => {
  const full = step('s2', '第二步', [doc(A, '甲'), doc(B, '乙'), doc(C, '丙')], {
    why: {
      rules: [1, 2, 3].map((n) => ({ text: `規定${n}`, article: `第${n}條`, claim: 'c001', src: 1 })),
      insights: [1, 2, 3].map((n) => ({ insightId: `INS-2026-01-0${n}-0000000${n}`, quote: `心得${n}`, date: '2026-01-01' })),
      pitfalls: [1, 2, 3].map((n) => ({ text: `坑${n}`, claim: 'c001', case: null })),
    },
    cases: [{ case: '舊案', date: '2025-01-01' }, { case: '新案', date: '2026-03-01' }, { case: '無日期', date: null }, { case: '中案', date: '2025-09-01' }],
  })
  const t = topic('t1', [step('s1', '第一步', []), full], [1, 2, 3, 4].map((n) => ({ id: `r${n}`, name: `相關${n}`, sharedDocs: 1, sharedCases: 0 })))

  it('路線每站有名稱、文件數，只有目前這步 current', () => {
    const a = answerFor(t, 1)
    expect(a.route).toEqual([
      { index: 0, title: '第一步', docCount: 0, current: false },
      { index: 1, title: '第二步', docCount: 3, current: true },
    ])
  })
  it('各列上限：docs/rules/pitfalls/cases/insights 最多 2、related 最多 3', () => {
    const a = answerFor(t, 1)
    expect(a.step?.docs).toHaveLength(2)
    expect(a.step?.rules).toHaveLength(2)
    expect(a.step?.pitfalls).toHaveLength(2)
    expect(a.step?.cases).toHaveLength(2)
    expect(a.step?.insights).toHaveLength(2)
    expect(a.related.map((r) => r.id)).toEqual(['r1', 'r2', 'r3'])
  })
  it('cases 日期新到舊，沒有日期排最後', () => {
    expect(answerFor(t, 1).step?.cases.map((c) => c.case)).toEqual(['新案', '中案'])
    const only = topic('t2', [step('s1', '一', [], { cases: [{ case: '無日期', date: null }, { case: '有日期', date: '2025-01-01' }] })])
    expect(answerFor(only, 0).step?.cases.map((c) => c.case)).toEqual(['有日期', '無日期'])
  })
  it('stepIndex 超出範圍或 -1：只有路線、全部不高亮、不丟例外', () => {
    for (const i of [-1, 2, 99, 1.5, NaN]) {
      const a = answerFor(t, i)
      expect(a.stepIndex).toBe(-1)
      expect(a.step).toBeNull()
      expect(a.route.every((s) => !s.current)).toBe(true)
      expect(a.route).toHaveLength(2)
    }
  })
  it('沒有 steps 的題目回空路線', () => {
    expect(answerFor(topic('t3', undefined), 0).route).toEqual([])
  })
})
