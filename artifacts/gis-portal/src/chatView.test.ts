import { describe, expect, it } from 'vitest'
import { applyEvent, applyStatus, emptyRun, parseSse, restartBusy, restartText, tokenText, type ChatEvent } from './chatView'

const run = (...evs: ChatEvent[]) => evs.reduce(applyEvent, emptyRun())

describe('parseSse', () => {
  it('事件名在 JSON 裡；註解行略過', () => {
    const { events, rest } = parseSse('', ': keepalive\n\ndata: {"event":"message.delta","delta":"ok"}\n\n: stream closed\n\n')
    expect(events).toEqual([{ event: 'message.delta', delta: 'ok' }])
    expect(rest).toBe('')
  })
  it('跨片段的事件接得起來', () => {
    const a = parseSse('', 'data: {"event":"mess')
    expect(a.events).toEqual([])
    const b = parseSse(a.rest, 'age.delta","delta":"x"}\n\n')
    expect(b.events[0]?.delta).toBe('x')
  })
  it('壞的一筆略過，後面照收', () => {
    expect(parseSse('', 'data: {bad\n\ndata: {"event":"run.completed"}\n\n').events.map((e) => e.event)).toEqual(['run.completed'])
  })
})

describe('applyEvent', () => {
  it('累積文字，完成時以 output 為準並記 token', () => {
    const s = run({ event: 'message.delta', delta: 'o' }, { event: 'message.delta', delta: 'k' }, { event: 'run.completed', output: 'ok!', usage: { total_tokens: 16308 } })
    expect(s).toMatchObject({ text: 'ok!', done: true, tokens: 16308 })
  })
  it('工具進度', () => {
    expect(run({ event: 'tool.started', tool: 'terminal', preview: 'ls' }).tools).toEqual(['🔧 terminal：ls'])
  })
  it('核准卡出現與消失', () => {
    const s = run({ event: 'approval.request', command: 'rm -rf x', description: '刪除' })
    expect(s.approval).toEqual({ command: 'rm -rf x', description: '刪除' })
    expect(applyEvent(emptyRun(), { event: 'approval.request', command: 'x', request_id: 'p1', execution_generation: 3 }).approval).toMatchObject({ requestId: 'p1', executionGeneration: 3 })
    expect(applyEvent(s, { event: 'approval.responded' }).approval).toBeNull()
  })
  it('失敗、中止、Gateway 重啟都會結束這次處理', () => {
    expect(run({ event: 'run.failed', error: '爆了' })).toMatchObject({ done: true, error: '爆了' })
    expect(run({ event: 'run.cancelled' })).toMatchObject({ done: true, error: '已中止' })
    expect(run({ event: 'run.interrupted' }).error).toContain('Gateway')
  })
  it('不認得的事件不影響狀態', () => {
    const s = emptyRun()
    expect(applyEvent(s, { event: 'reasoning.available', text: 'x' })).toBe(s)
  })
})

describe('applyStatus（斷線後）', () => {
  it('完成時拿到全文', () => {
    expect(applyStatus(emptyRun(), { status: 'completed', output: '全文', usage: { total_tokens: 100 } })).toMatchObject({ text: '全文', done: true, tokens: 100 })
  })
  it('待核准時補出核准卡', () => {
    expect(applyStatus(emptyRun(), { status: 'waiting_for_approval', approval: { command: 'x' } }).approval?.command).toBe('x')
  })
  it('還在跑就不動', () => {
    const s = emptyRun()
    expect(applyStatus(s, { status: 'running' })).toBe(s)
  })
})

describe('重啟文字', () => {
  const now = Date.parse('2026-10-30T12:00:00Z')
  const r = (status: string, over = {}) => ({ mode: 'graceful', status, note: null, requestedAt: '2026-10-30T11:59:00Z', ...over })
  it('進行中', () => {
    expect(restartText(r('pending'), now)).toContain('認領')
    expect(restartText(r('running'), now)).toContain('收尾')
    expect(restartBusy(r('running'))).toBe(true)
    expect(restartBusy(r('done'))).toBe(false)
  })
  it('結果顯示 note；一小時前的不顯示', () => {
    expect(restartText(r('timeout', { note: '可改用強制重啟' }), now)).toBe('可改用強制重啟')
    expect(restartText(r('done', { requestedAt: '2026-10-30T10:00:00Z' }), now)).toBeNull()
    expect(restartText(null, now)).toBeNull()
  })
})

describe('tokenText', () => {
  it('千位縮寫', () => {
    expect(tokenText(16308)).toBe('16.3k')
    expect(tokenText(900)).toBe('900')
  })
})
