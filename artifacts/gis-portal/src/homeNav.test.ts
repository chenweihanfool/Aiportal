import { describe, expect, it } from 'vitest'
import { HOME_SECTIONS, activeSection } from './homeNav'

const order = HOME_SECTIONS.map((s) => s.id)

describe('HOME_SECTIONS', () => {
  it('has unique ids', () => {
    expect(new Set(order).size).toBe(order.length)
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
