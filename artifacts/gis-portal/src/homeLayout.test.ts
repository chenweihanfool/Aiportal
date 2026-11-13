import { describe, expect, it } from 'vitest'
import { HOME_LAYOUT_KEY, readHomeLayout, writeHomeLayout, type LayoutStore } from './homeLayout'

const mem = (init: Record<string, string> = {}): LayoutStore & { data: Record<string, string> } => {
  const data = { ...init }
  return { data, getItem: (k) => (k in data ? data[k]! : null), setItem: (k, v) => { data[k] = v } }
}
const boom: LayoutStore = { getItem: () => { throw new Error('denied') }, setItem: () => { throw new Error('denied') } }

describe('readHomeLayout', () => {
  it('鍵名固定為 hm-layout', () => expect(HOME_LAYOUT_KEY).toBe('hm-layout'))
  it('沒值預設 v3', () => expect(readHomeLayout(mem())).toBe('v3'))
  it('classic 讀回 classic', () => expect(readHomeLayout(mem({ 'hm-layout': 'classic' }))).toBe('classic'))
  it('v3 讀回 v3', () => expect(readHomeLayout(mem({ 'hm-layout': 'v3' }))).toBe('v3'))
  it('亂值回 v3', () => expect(readHomeLayout(mem({ 'hm-layout': 'nope' }))).toBe('v3'))
  it('store 丟例外回 v3', () => expect(readHomeLayout(boom)).toBe('v3'))
  it('沒有 store 回 v3', () => { expect(readHomeLayout(null)).toBe('v3'); expect(readHomeLayout(undefined)).toBe('v3') })
})

describe('writeHomeLayout', () => {
  it('寫入後讀得回來', () => {
    const s = mem()
    expect(writeHomeLayout(s, 'classic')).toBe(true)
    expect(s.data['hm-layout']).toBe('classic')
    expect(readHomeLayout(s)).toBe('classic')
    writeHomeLayout(s, 'v3')
    expect(readHomeLayout(s)).toBe('v3')
  })
  it('丟例外時不炸、回 false', () => {
    expect(writeHomeLayout(boom, 'classic')).toBe(false)
    expect(writeHomeLayout(null, 'classic')).toBe(false)
  })
})
