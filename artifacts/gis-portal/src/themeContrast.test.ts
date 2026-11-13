import { describe, expect, it } from 'vitest'
import { CSS_TOKENS, CSS_TOKENS_LIGHT } from './theme'

// WCAG 2.x 相對亮度與對比（#rrggbb）
function lum(hex: string): number {
  const c = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4))
  return 0.2126 * c[0]! + 0.7152 * c[1]! + 0.0722 * c[2]!
}
export function contrast(a: string, b: string): number {
  const x = lum(a), y = lum(b)
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05)
}

const TEXT = ['--c-ink', '--c-ink-2', '--c-ink-3', '--c-accent', '--c-warn', '--c-crit'] as const
const BG = ['--c-bg', '--c-surface'] as const
const themes = { dark: CSS_TOKENS, light: { ...CSS_TOKENS, ...CSS_TOKENS_LIGHT } } as const

describe('對比（WCAG AA 4.5:1）', () => {
  it('公式：黑白 21:1、同色 1:1', () => {
    expect(contrast('#000000', '#ffffff')).toBeCloseTo(21, 5)
    expect(contrast('#336699', '#336699')).toBeCloseTo(1, 5)
  })
  for (const [name, tokens] of Object.entries(themes)) {
    for (const t of TEXT) {
      for (const b of BG) {
        it(`${name}：${t} 對 ${b} ≥ 4.5`, () => {
          expect(contrast(tokens[t]!, tokens[b]!)).toBeGreaterThanOrEqual(4.5)
        })
      }
    }
  }
})
