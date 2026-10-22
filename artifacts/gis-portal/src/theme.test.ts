import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { CSS_TOKENS } from './theme'

// portal.css 的 :root 設計 token 必須與 theme.ts 的 CSS_TOKENS 一致（同名、同值、沒有多也沒有少）。
const css = readFileSync(fileURLToPath(new URL('./portal.css', import.meta.url)), 'utf8')
const root = css.match(/:root\s*\{([\s\S]*?)\n\}/)?.[1] ?? ''
const declared = Object.fromEntries([...root.matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)].map((m) => [m[1]!, m[2]!.trim()]))

describe('設計 token', () => {
  it('portal.css :root 有 CSS_TOKENS 的每一個，值相同', () => {
    for (const [k, v] of Object.entries(CSS_TOKENS)) expect(declared[k], k).toBe(v)
  })
  it('樣式表用到的 --c-*／--sp-*／--r-*／--fs-* 都有定義', () => {
    const used = new Set([...css.matchAll(/var\((--(?:c|sp|r|fs)-[\w-]+)/g)].map((m) => m[1]!))
    for (const k of used) expect(declared[k], k).toBeDefined()
  })
})
