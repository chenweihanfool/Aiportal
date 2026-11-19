import { describe, expect, it } from 'vitest'
import { shouldFocusSearch, type HotkeyTarget } from './searchHotkey'

const ev = (target: HotkeyTarget, extra: Partial<{ key: string; ctrlKey: boolean; metaKey: boolean; altKey: boolean }> = {}) => ({
  key: '/', ctrlKey: false, metaKey: false, altKey: false, target, ...extra,
})

describe('shouldFocusSearch', () => {
  it('一般頁面按 `/` 要攔', () => {
    expect(shouldFocusSearch(ev({ tagName: 'BODY' }))).toBe(true)
    expect(shouldFocusSearch(ev({ tagName: 'DIV' }))).toBe(true)
    expect(shouldFocusSearch(ev(null))).toBe(true)
  })

  it('不是 `/` 就不攔', () => {
    expect(shouldFocusSearch(ev({ tagName: 'BODY' }, { key: 'k' }))).toBe(false)
    expect(shouldFocusSearch(ev({ tagName: 'BODY' }, { key: '?' }))).toBe(false)
  })

  it('輸入框、textarea、select、contenteditable 都不攔（尤其 contenteditable 的大寫屬性）', () => {
    expect(shouldFocusSearch(ev({ tagName: 'INPUT' }))).toBe(false)
    expect(shouldFocusSearch(ev({ tagName: 'TEXTAREA' }))).toBe(false)
    expect(shouldFocusSearch(ev({ tagName: 'SELECT' }))).toBe(false)
    expect(shouldFocusSearch(ev({ tagName: 'DIV', isContentEditable: true }))).toBe(false)
  })

  it('有修飾鍵時都不攔（Ctrl/⌘/Alt）', () => {
    expect(shouldFocusSearch(ev({ tagName: 'BODY' }, { ctrlKey: true }))).toBe(false)
    expect(shouldFocusSearch(ev({ tagName: 'BODY' }, { metaKey: true }))).toBe(false)
    expect(shouldFocusSearch(ev({ tagName: 'BODY' }, { altKey: true }))).toBe(false)
  })
})
