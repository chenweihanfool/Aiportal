import { describe, expect, it } from 'vitest'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { branchTone, fallbackFlow, forkFromFlow, forkFromText, type Fork } from './knowledgeFork'
import { layoutFlow } from './knowledgeDiagramLayout'
// Windows 大小寫不敏感：'./KnowledgeFork' 會先命中 knowledgeFork.ts；新檔一律帶副檔名
import { KnowledgeFork } from './KnowledgeFork.tsx'
import type { Bullet, FlowDiagram, FlowNode } from './knowledgeView'
import type { Station, StationKind } from './knowledgeIslands'

const node = (id: string, label: string, phase: number, lane = 0, shape: 'step' | 'decision' = 'step', sub?: string): FlowNode => {
  const n: FlowNode = { id, label, src: [], lane, phase, shape }
  if (sub) n.sub = sub
  return n
}

const flow = (): FlowDiagram => ({
  type: 'flow',
  version: 1,
  lanes: ['申請', '審查'],
  phases: ['收件', '初審', '結果'],
  nodes: [
    node('q', '要不要補件', 0, 0, 'decision', '缺件才看'),
    node('a', '補件單', 1, 0),
    node('b', '退件通知', 1, 1),
    node('c', '核准通過', 2, 0),
    node('d', '重新送件', 2, 1),
    node('orphan', '沒出邊的判斷', 2, 0, 'decision'),
  ],
  edges: [
    { from: 'q', to: 'c', label: '齊全' },
    { from: 'q', to: 'b', label: '退回' },
    { from: 'q', to: 'a', label: '缺件' },
    { from: 'q', to: 'd', label: '再看看', back: true },
  ],
})

const bullet = (text: string, extra: Partial<Bullet> = {}): Bullet => ({ text, refs: [], single: false, ...extra })

describe('branchTone', () => {
  it('stop 優先於 retry', () => {
    expect(branchTone('退回', '駁回', false)).toBe('stop')
    expect(branchTone('x', '流程終止', false)).toBe('stop')
    expect(branchTone('撤回', '不受理', false)).toBe('stop')
  })
  it('back 或退回字樣＝retry', () => {
    expect(branchTone('通過', '', true)).toBe('retry')
    expect(branchTone('重測', '', false)).toBe('retry')
    expect(branchTone('補正', '', false)).toBe('retry')
  })
  it('ok 字樣或 label 是「是」', () => {
    expect(branchTone('核定', '', false)).toBe('ok')
    expect(branchTone('　是 ', '', false)).toBe('ok')
    expect(branchTone('x', '結案', false)).toBe('ok')
  })
  it('其餘 neutral', () => {
    expect(branchTone('缺件', '補件單', false)).toBe('neutral')
  })
})

describe('forkFromFlow', () => {
  it('依目的 phase、lane 排序，tone／sub／back 正確', () => {
    const f = forkFromFlow(flow(), 'q')
    expect(f).not.toBeNull()
    expect(f!.question).toBe('要不要補件')
    expect(f!.sub).toBe('缺件才看')
    expect(f!.plain).toEqual([])
    expect(f!.branches.map((b) => b.dest)).toEqual(['補件單', '退件通知', '核准通過', '重新送件'])
    expect(f!.branches.map((b) => b.tone)).toEqual(['neutral', 'retry', 'ok', 'retry'])
    expect(f!.branches[0]).toMatchObject({ label: '缺件', sub: '申請', targetId: 'a', back: false })
    expect(f!.branches[3]).toMatchObject({ label: '再看看', sub: '審查', targetId: 'd', back: true })
  })
  it('沒有 label 的邊用「→」', () => {
    const d = flow()
    d.edges = [{ from: 'q', to: 'a' }]
    expect(forkFromFlow(d, 'q')!.branches[0]!.label).toBe('→')
  })
  it('非 decision、不存在、沒有出邊都回 null', () => {
    expect(forkFromFlow(flow(), 'a')).toBeNull()
    expect(forkFromFlow(flow(), 'zzz')).toBeNull()
    expect(forkFromFlow(flow(), 'orphan')).toBeNull()
  })
})

describe('forkFromText', () => {
  const targets = [
    { id: 's2', label: '補件', stepNo: 2 },
    { id: 's3', label: '送件', stepNo: 3 },
    { id: 'x', label: '資料', stepNo: 5 },
    { id: 'y', label: '資料補齊', stepNo: 6 },
  ]

  it('when／then 進分支，targetId 依第 N 步與最長標題', () => {
    const f = forkFromText([
      bullet('如果：缺件 → 就：第 2 步 補件', { when: '缺件', then: '第 2 步 補件' }),
      bullet('如果：少章 → 就：第三步 送件', { when: '少章', then: '第三步 送件' }),
      bullet('如果：不完整 → 就：把資料補齊再送件', { when: '不完整', then: '把資料補齊再送件' }),
      bullet('只是補充說明'),
    ], targets)
    expect(f).not.toBeNull()
    expect(f!.question).toBe('遇到這些情況')
    expect(f!.branches).toHaveLength(3)
    expect(f!.branches[0]).toMatchObject({ label: '缺件', dest: '第 2 步 補件', targetId: 's2', tone: 'neutral', back: false })
    expect(f!.branches[1]).toMatchObject({ label: '少章', dest: '第三步 送件', targetId: 's3' })
    expect(f!.branches[2]).toMatchObject({ targetId: 'y' })
    expect(f!.plain).toHaveLength(1)
    expect(f!.plain[0]!.text).toBe('只是補充說明')
  })
  it('沒有 when／then 的條目放 plain；空清單回 null', () => {
    const f = forkFromText([bullet('只有一句')], targets)
    expect(f).not.toBeNull()
    expect(f!.branches).toEqual([])
    expect(f!.plain).toHaveLength(1)
    expect(forkFromText([], targets)).toBeNull()
  })
  it('沒有對到的目標就沒有 targetId', () => {
    const f = forkFromText([bullet('x', { when: '缺件', then: '先把東西寄回來' })], targets)
    expect(f!.branches[0]!.targetId).toBeUndefined()
  })
})

const station = (id: string, kind: StationKind, label: string): Station => ({ id, kind, label, bullets: [] })

describe('fallbackFlow', () => {
  it('只留 prep／step／decision，依原順序連邊', () => {
    const f = fallbackFlow([
      station('prep', 'prep', '開工前準備'),
      station('w', 'what', '這件事在幹嘛'),
      station('s0', 'step', '填寫申請書並送件'),
      station('d', 'decision', '補件或退件'),
      station('p', 'pitfall', '文件漏簽'),
      station('s1', 'step', '領件'),
    ])
    expect(f).not.toBeNull()
    expect(f!.lanes).toEqual(['流程'])
    expect(f!.nodes.map((n) => n.id)).toEqual(['prep', 's0', 'd', 's1'])
    expect(f!.nodes.map((n) => n.shape)).toEqual(['step', 'step', 'decision', 'step'])
    expect(f!.nodes.every((n) => n.lane === 0 && n.src.length === 0)).toBe(true)
    expect(f!.phases).toEqual(['開工前準備', '填寫申請書並送件', '補件或退件', '領件'])
    expect(f!.nodes[0]!.label).toBe('開工前準備')
    expect(f!.edges).toEqual([
      { from: 'prep', to: 's0' },
      { from: 's0', to: 'd' },
      { from: 'd', to: 's1' },
    ])
  })
  it('超過 12 站只留前 12 站，且可以直接 layoutFlow', () => {
    const many = Array.from({ length: 15 }, (_, i) => station(`s${i}`, 'step', `第${i + 1}步做這件事`))
    const f = fallbackFlow(many)!
    expect(f.nodes).toHaveLength(12)
    expect(f.phases).toHaveLength(12)
    expect(f.edges).toHaveLength(11)
    expect(f.phases.every((p) => [...p].length <= 8)).toBe(true)
    const laid = layoutFlow(f)
    expect(laid.nodes).toHaveLength(12)
    expect(laid.width).toBeGreaterThan(0)
  })
  it('少於 2 站或沒有合格站回 null', () => {
    expect(fallbackFlow([])).toBeNull()
    expect(fallbackFlow([station('p', 'prep', '準備')])).toBeNull()
    expect(fallbackFlow([station('w', 'what', '什麼'), station('u', 'unknown', '不知道')])).toBeNull()
  })
})

const forkOf = (): Fork => forkFromFlow(flow(), 'q')!


describe('KnowledgeFork 渲染（renderToStaticMarkup）', () => {
  it('寬版畫出問題、膠囊與可點的去向卡', () => {
    const html = renderToStaticMarkup(createElement(KnowledgeFork, { fork: forkOf(), onJump: () => {} }))
    expect(html).toContain('data-layout="wide"')
    expect(html).toContain('要不要補件')
    expect(html).toContain('缺件才看')
    expect(html).toContain('kfk-cap')
    expect(html).toContain('缺件')
    expect(html).toContain('補件單')
    expect((html.match(/role="button"/g) ?? []).length).toBe(4)
  })
  it('沒有 targetId 或沒有 onJump 的去向卡不可點', () => {
    const fork: Fork = {
      question: '要不要',
      branches: [
        { label: '走 A', dest: '甲', tone: 'ok', back: false },
        { label: '走 B', dest: '乙', tone: 'neutral', back: false, targetId: 'b' },
      ],
      plain: [],
    }
    const noJump = renderToStaticMarkup(createElement(KnowledgeFork, { fork }))
    expect(noJump).not.toContain('role="button"')
    const withJump = renderToStaticMarkup(createElement(KnowledgeFork, { fork, onJump: () => {} }))
    expect((withJump.match(/role="button"/g) ?? []).length).toBe(1)
  })
  it('plain 條目去掉句尾更正標記，圖例只列出現的 tone', () => {
    const fork: Fork = {
      question: '要不要',
      branches: [{ label: '走 A', dest: '甲', tone: 'stop', back: false }],
      plain: [bullet('補充說明（使用者補充 2026-01-02）')],
    }
    const html = renderToStaticMarkup(createElement(KnowledgeFork, { fork }))
    expect(html).toContain('補充說明')
    expect(html).not.toContain('使用者補充')
    expect(html).toContain('紅＝流程終止')
    expect(html).not.toContain('綠＝往下走')
  })
})
