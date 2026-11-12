import { afterEach, describe, expect, it, vi } from 'vitest'
import { claimState, isStuck, isWrongNow, loadPending, overlay, PENDING_KEY, postCorrection, savePending, settle, type PendingItem } from './knowledgeCorrections'
import type { TopicClaim } from './knowledgeView'

const item = (over: Partial<PendingItem> & { id: number }): PendingItem => ({ topicId: 't1', claimId: 'c001', kind: 'wrong', section: null, text: null, at: 1_000_000, ...over })
const claim = (over: Partial<TopicClaim> = {}): TopicClaim => ({ id: 'c001', section: '步驟', status: 'active', origin: 'model', pinned: false, firstSeen: '2026-01-01', lastChanged: '2026-01-01', text: '- x', ...over })
const memStore = (init?: string) => {
  const m = new Map<string, string>()
  if (init !== undefined) m.set(PENDING_KEY, init)
  return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => { m.set(k, v) } }
}

describe('待生效佇列 localStorage', () => {
  it('存了再讀得回來', () => {
    const s = memStore()
    const list = [item({ id: 1 }), item({ id: 2, kind: 'add', claimId: null, section: '步驟', text: '補的' })]
    expect(savePending(s, list)).toBe(true)
    expect(loadPending(s)).toEqual(list)
  })
  it('壞資料當空；壞的單筆略過；store 丟例外或沒有 store 不爆', () => {
    expect(loadPending(memStore('{oops'))).toEqual([])
    expect(loadPending(memStore('{"a":1}'))).toEqual([])
    expect(loadPending(memStore(JSON.stringify([item({ id: 1 }), { id: 'x' }, null])))).toEqual([item({ id: 1 })])
    expect(loadPending(null)).toEqual([])
    const boom = { getItem: () => { throw new Error('no') }, setItem: () => { throw new Error('no') } }
    expect(loadPending(boom)).toEqual([])
    expect(savePending(boom, [])).toBe(false)
    expect(savePending(undefined, [])).toBe(false)
  })
})

describe('settle', () => {
  it('只移除已套用的（依題目比對 id）；題目找不到或沒有 appliedCorrections 的保留', () => {
    const pending = [item({ id: 1 }), item({ id: 2 }), item({ id: 3, topicId: 't2' }), item({ id: 4, topicId: 't3' }), item({ id: 5, topicId: 'zz' })]
    const out = settle(pending, [
      { id: 't1', appliedCorrections: [1] },
      { id: 't2', appliedCorrections: [1, 2] },
      { id: 't3' },
    ])
    expect(out.map((p) => p.id)).toEqual([2, 3, 4, 5])
  })
})

describe('isStuck', () => {
  it('超過 60 分鐘才算', () => {
    const it0 = item({ id: 1, at: 0 })
    expect(isStuck(it0, new Date(60 * 60_000))).toBe(false)
    expect(isStuck(it0, new Date(60 * 60_000 + 1))).toBe(true)
  })
})

describe('overlay', () => {
  const claims = [{ id: 'c001' }, { id: 'c002' }]
  it('同一條 wrong→fix→undo 以最後一筆為準', () => {
    const o = overlay(claims, [item({ id: 1, kind: 'wrong' }), item({ id: 2, kind: 'fix', text: '新句' }), item({ id: 3, kind: 'undo' })])
    expect(o.byClaim.get('c001')!.kind).toBe('undo')
    expect(o.byClaim.get('c001')!.item.id).toBe(3)
    const o2 = overlay(claims, [item({ id: 1, kind: 'wrong' }), item({ id: 2, kind: 'fix', text: '新句' })])
    expect(o2.byClaim.get('c001')).toMatchObject({ kind: 'fix', text: '新句' })
    const o3 = overlay(claims, [item({ id: 2, kind: 'fix', text: '新句' }), item({ id: 3, kind: 'wrong' })])
    expect(o3.byClaim.get('c001')).toMatchObject({ kind: 'wrong', text: null })
  })
  it('add 依節名分組；不認識的 claim id 不進 byClaim', () => {
    const o = overlay(claims, [
      item({ id: 1, kind: 'add', claimId: null, section: '步驟', text: 'a' }),
      item({ id: 2, kind: 'add', claimId: null, section: '常見誤解', text: 'b' }),
      item({ id: 3, kind: 'add', claimId: null, section: '步驟', text: 'c' }),
      item({ id: 4, kind: 'wrong', claimId: 'c999' }),
    ])
    expect(o.adds.get('步驟')!.map((p) => p.id)).toEqual([1, 3])
    expect(o.adds.get('常見誤解')!.map((p) => p.id)).toEqual([2])
    expect(o.byClaim.size).toBe(0)
  })
})

describe('claimState', () => {
  const now = new Date('2026-11-12T03:00:00Z')
  it('正式 disputed：劃線、日期、可撤回', () => {
    const s = claimState({ text: '~~壞句~~（使用者標記有誤 2026-11-10）' }, claim({ status: 'disputed' }), undefined, now)
    expect(s).toMatchObject({ wrong: true, canUndo: true, pending: null })
    expect(s.display).toEqual({ text: '壞句', date: '2026-11-10', mark: 'disputed' })
    expect(isWrongNow(claim({ status: 'disputed' }))).toBe(true)
  })
  it('暫定 fix：顯示新文字、算你更正的；暫定 undo：回到原樣', () => {
    const fix = overlay([{ id: 'c001' }], [item({ id: 1, kind: 'fix', text: '新句' })]).byClaim.get('c001')
    const s1 = claimState({ text: '原句' }, claim(), fix, now)
    expect(s1).toMatchObject({ wrong: false, mine: true, override: true, canUndo: true })
    expect(s1.display.text).toBe('新句')
    const undo = overlay([{ id: 'c001' }], [item({ id: 1, kind: 'fix', text: '新句' }), item({ id: 2, kind: 'undo' })]).byClaim.get('c001')
    const s2 = claimState({ text: '~~原句~~（使用者標記有誤 2026-11-10）' }, claim({ status: 'disputed', origin: 'user' }), undo, now)
    expect(s2).toMatchObject({ wrong: false, mine: false, canUndo: false })
    expect(s2.display.text).toBe('原句')
  })
  it('卡住的暫定狀態 stuck＝true', () => {
    const e = overlay([{ id: 'c001' }], [item({ id: 1, kind: 'wrong', at: now.getTime() - 61 * 60_000 })]).byClaim.get('c001')
    expect(claimState({ text: 'x' }, claim(), e, now).stuck).toBe(true)
  })
})

describe('postCorrection', () => {
  afterEach(() => vi.unstubAllGlobals())
  it('POST 到 api/knowledge/corrections、帶 x-admin-password', async () => {
    const f = vi.fn(async () => new Response(JSON.stringify({ id: 9, topicId: 't1', claimId: 'c001', kind: 'wrong', section: null, text: null, createdAt: 'x' }), { status: 201 }))
    vi.stubGlobal('fetch', f)
    const r = await postCorrection('pw', { topicId: 't1', claimId: 'c001', kind: 'wrong' })
    expect(r.id).toBe(9)
    const [url, init] = f.mock.calls[0] as unknown as [string, RequestInit]
    expect(url.endsWith('api/knowledge/corrections')).toBe(true)
    expect(init.method).toBe('POST')
    expect((init.headers as Record<string, string>)['x-admin-password']).toBe('pw')
    expect(JSON.parse(init.body as string)).toEqual({ topicId: 't1', claimId: 'c001', kind: 'wrong' })
  })
  it('非 2xx 丟出後端 message；401 沒 message 給預設', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ message: 'text 超過 500 字' }), { status: 400 })))
    await expect(postCorrection('pw', { topicId: 't1', kind: 'add', text: 'x' })).rejects.toThrow('text 超過 500 字')
    vi.stubGlobal('fetch', vi.fn(async () => new Response('', { status: 401 })))
    await expect(postCorrection('pw', { topicId: 't1', kind: 'add', text: 'x' })).rejects.toThrow('沒有權限')
  })
})
