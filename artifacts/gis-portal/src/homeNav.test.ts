import { describe, expect, it } from 'vitest'
import { HOME_SECTIONS, HOME_SHORTCUTS, activeSection, sectionDef } from './homeNav'

const order = HOME_SECTIONS.map((s) => s.id)

describe('HOME_SECTIONS', () => {
  it('has unique ids', () => {
    expect(new Set(order).size).toBe(order.length)
  })
})

describe('HOME_SHORTCUTS', () => {
  it('id 不重複，每一筆都有名稱與圖示', () => {
    expect(new Set(HOME_SHORTCUTS.map((s) => s.id)).size).toBe(HOME_SHORTCUTS.length)
    for (const s of HOME_SHORTCUTS) {
      expect(s.label.length).toBeGreaterThan(0)
      expect(s.icon.length).toBeGreaterThan(0)
    }
  })
  it('使用者常用的三個都在，連結是 hash 路由', () => {
    expect(HOME_SHORTCUTS.map((s) => s.label)).toEqual(['時間軸', '想法庫', '關係'])
    for (const s of HOME_SHORTCUTS) if ('href' in s) expect(s.href.startsWith('#')).toBe(true)
  })
})

describe('activeSection', () => {
  it('picks the first visible section in registry order', () => {
    expect(activeSection(order, new Set(['sec-fun', 'sec-growth']), null)).toBe('sec-growth')
  })
  it('keeps the previous one when nothing is visible', () => {
    expect(activeSection(order, new Set(), 'sec-fun')).toBe('sec-fun')
    expect(activeSection(order, new Set(), null)).toBeNull()
  })
  it('ignores ids that are not registered', () => {
    expect(activeSection(order, new Set(['nope']), 'sec-today')).toBe('sec-today')
  })
})

describe('sectionDef', () => {
  it('每一筆都有標題與圖示，可依 id 取回', () => {
    for (const s of HOME_SECTIONS) {
      expect(s.title.length).toBeGreaterThan(0)
      expect(s.icon.length).toBeGreaterThan(0)
      expect(sectionDef(s.id)).toBe(s)
    }
  })
  it('不在註冊表裡的 id 丟錯', () => {
    expect(() => sectionDef('sec-nope')).toThrow(/HOME_SECTIONS/)
  })
})
