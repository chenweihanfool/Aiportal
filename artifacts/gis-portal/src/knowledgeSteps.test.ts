import { describe, expect, it } from 'vitest'
import { caseSourcePosition, insightUsages, parseSteps, showsDocs, stepForNode, unlinkText, type TopicStep } from './knowledgeSteps'

const doc = {
  templateId: 'tpl_ab12cd34ef',
  family: '鑑界退費',
  docType: '函',
  role: '公文',
  score: 0.92,
  others: 2,
  evidence: ['1150101測試段12再鑑界'],
}

const step = {
  id: 's1',
  title: '確認退費依據',
  claim: 'c010',
  node: 'n1',
  docs: [doc],
  why: {
    rules: [{ text: '繳費後未辦理應退費', article: '第221條', claim: 'c010', src: 1 }],
    insights: [{ insightId: 'INS-2026-11-19-0a1b2c3d', quote: '先查繳費紀錄再回覆', date: '2026-11-19' }],
    pitfalls: [{ text: '只寄申請書沒附繳費收據', claim: 'c011', case: '1150101測試段12再鑑界' }],
  },
  cases: [{ case: '1150101測試段12再鑑界', date: '2026-11-01' }],
}

describe('parseSteps', () => {
  it('不是陣列回 []', () => {
    expect(parseSteps(undefined)).toEqual([])
    expect(parseSteps(null)).toEqual([])
    expect(parseSteps({ steps: [] })).toEqual([])
  })

  it('合格步驟原樣解析', () => {
    const [s] = parseSteps([step])
    expect(s).toEqual(step)
  })

  it('丟掉壞的步驟與壞的子項，同一個陣列裡的合格項保留', () => {
    const out = parseSteps([
      { ...step, id: 's2', title: '沒有節點', node: null },
      { ...step, id: 'x1' },
      { ...step, claim: 'c1' },
      null,
      {
        ...step,
        id: 's3',
        docs: [doc, { ...doc, templateId: 'tpl_bad' }, { ...doc, score: 2 }],
        why: {
          rules: [step.why.rules[0], { ...step.why.rules[0], article: '221' }],
          insights: [{ ...step.why.insights[0], insightId: 'INS-1' }],
          pitfalls: [step.why.pitfalls[0], { ...step.why.pitfalls[0], case: 3 }],
        },
        cases: [step.cases[0], { case: '' }],
      },
    ])
    expect(out.map((s) => s.id)).toEqual(['s2', 's3'])
    const s3 = out[1] as TopicStep
    expect(s3.docs).toHaveLength(1)
    expect(s3.why.rules).toHaveLength(1)
    expect(s3.why.insights).toEqual([])
    expect(s3.why.pitfalls).toHaveLength(1)
    expect(s3.cases).toEqual([{ case: '1150101測試段12再鑑界', date: '2026-11-01' }])
  })
})

describe('unlink text 組法', () => {
  it('每種連結都有對應前綴', () => {
    expect(unlinkText('doc', 'tpl_ab12cd34ef')).toBe('doc:tpl_ab12cd34ef')
    expect(unlinkText('insight', 'INS-2026-11-19-0a1b2c3d')).toBe('insight:INS-2026-11-19-0a1b2c3d')
    expect(unlinkText('rule', 'c010')).toBe('rule:c010')
    expect(unlinkText('pitfall', 'c011')).toBe('pitfall:c011')
    expect(unlinkText('case', '1150101測試段12再鑑界')).toBe('case:1150101測試段12再鑑界')
  })
})

describe('caseSourcePosition', () => {
  const sources = [{ id: 'a' }, { id: 'b', case: '別的案子' }, { id: 'c', case: '1150101測試段12再鑑界' }]
  it('回第一個相符來源的 1 起算位置', () => {
    expect(caseSourcePosition(sources, '1150101測試段12再鑑界')).toBe(3)
    expect(caseSourcePosition(sources, '別的案子')).toBe(2)
  })
  it('找不到回 null', () => {
    expect(caseSourcePosition(sources, '不存在的案子')).toBeNull()
    expect(caseSourcePosition([], '1150101測試段12再鑑界')).toBeNull()
  })
})

describe('business null 判斷', () => {
  it('null 不顯示 📄 列；有字或舊頁（undefined）照常顯示', () => {
    expect(showsDocs(null)).toBe(false)
    expect(showsDocs('鑑界')).toBe(true)
    expect(showsDocs(undefined)).toBe(true)
  })
})

describe('stepForNode', () => {
  it('找第一張 node 相符的步驟卡；沒有回 null', () => {
    const steps = parseSteps([step, { ...step, id: 's2', node: 'n2' }])
    expect(stepForNode(steps, 'n1')?.id).toBe('s1')
    expect(stepForNode(steps, 'zz')).toBeNull()
  })
})

describe('insightUsages', () => {
  it('列出引用該心得的題目與步驟序號；沒有就空陣列', () => {
    const steps = parseSteps([step, { ...step, id: 's2', title: '第二步', why: { rules: [], insights: [], pitfalls: [] } }])
    const topics = [{ id: 'T1', name: '測試鑑界', steps }, { id: 'T2', name: '沒步驟' }]
    expect(insightUsages(topics, 'INS-2026-11-19-0a1b2c3d')).toEqual([{ topicId: 'T1', topicName: '測試鑑界', stepNo: 1, stepTitle: '確認退費依據' }])
    expect(insightUsages(topics, 'INS-none')).toEqual([])
  })
})
