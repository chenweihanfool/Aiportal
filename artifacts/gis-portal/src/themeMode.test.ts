import { describe, expect, it } from 'vitest'
import { THEME_KEY, applyThemeMode, isThemeMode, readThemeMode, writeThemeMode, type ThemeStore } from './themeMode'

const memStore = (init: Record<string, string> = {}): ThemeStore & { data: Record<string, string> } => {
  const data = { ...init }
  return { data, getItem: (k) => (k in data ? data[k]! : null), setItem: (k, v) => { data[k] = v } }
}
const boom: ThemeStore = { getItem() { throw new Error('blocked') }, setItem() { throw new Error('blocked') } }

describe('themeMode', () => {
  it('沒值、亂值、store 壞掉都回 system', () => {
    expect(readThemeMode(memStore())).toBe('system')
    expect(readThemeMode(memStore({ [THEME_KEY]: 'blue' }))).toBe('system')
    expect(readThemeMode(boom)).toBe('system')
    expect(readThemeMode(null)).toBe('system')
  })
  it('讀得回 dark／light／system', () => {
    for (const m of ['dark', 'light', 'system'] as const) expect(readThemeMode(memStore({ [THEME_KEY]: m }))).toBe(m)
  })
  it('寫入用 hm-theme 鍵；壞掉的 store 不炸、回 false', () => {
    const s = memStore()
    expect(writeThemeMode(s, 'light')).toBe(true)
    expect(s.data['hm-theme']).toBe('light')
    expect(writeThemeMode(boom, 'dark')).toBe(false)
    expect(writeThemeMode(null, 'dark')).toBe(false)
  })
  it('dark／light 設 data-theme，system 移除', () => {
    const root = { dataset: {} as Record<string, string | undefined> }
    applyThemeMode(root, 'dark'); expect(root.dataset.theme).toBe('dark')
    applyThemeMode(root, 'light'); expect(root.dataset.theme).toBe('light')
    applyThemeMode(root, 'system'); expect(root.dataset.theme).toBeUndefined()
    expect('theme' in root.dataset).toBe(false)
    expect(() => applyThemeMode(null, 'dark')).not.toThrow()
  })
  it('isThemeMode', () => {
    expect(isThemeMode('dark')).toBe(true)
    expect(isThemeMode('x')).toBe(false)
    expect(isThemeMode(undefined)).toBe(false)
  })
})
