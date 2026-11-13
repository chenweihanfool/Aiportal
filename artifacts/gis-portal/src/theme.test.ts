import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { CSS_TOKENS, CSS_TOKENS_LIGHT } from './theme'

// portal.css 的 :root 設計 token 必須與 theme.ts 的 CSS_TOKENS 一致（同名、同值、沒有多也沒有少）。
const css = readFileSync(fileURLToPath(new URL('./portal.css', import.meta.url)), 'utf8')
const root = css.match(/:root\s*\{([\s\S]*?)\n\}/)?.[1] ?? ''
const declared = Object.fromEntries([...root.matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)].map((m) => [m[1]!, m[2]!.trim()]))

const parse = (block: string) => Object.fromEntries([...block.matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)].map((m) => [m[1]!, m[2]!.trim()]))
const lightBlock = css.match(/:root\[data-theme="light"\]\s*\{([\s\S]*?)\n\}/)?.[1] ?? ''
const mediaBlock = css.match(/@media \(prefers-color-scheme: light\)\s*\{\s*:root:not\(\[data-theme="dark"\]\)\s*\{([\s\S]*?)\n  \}/)?.[1] ?? ''
const lightDeclared = parse(lightBlock)
const mediaDeclared = parse(mediaBlock)

describe('設計 token', () => {
  it('portal.css :root 有 CSS_TOKENS 的每一個，值相同', () => {
    for (const [k, v] of Object.entries(CSS_TOKENS)) expect(declared[k], k).toBe(v)
  })
  it('樣式表用到的 --c-*／--sp-*／--r-*／--fs-* 都有定義', () => {
    const used = new Set([...css.matchAll(/var\((--(?:c|sp|r|fs)-[\w-]+)/g)].map((m) => m[1]!))
    for (const k of used) expect(declared[k], k).toBeDefined()
  })
  it('淺色區塊 :root[data-theme="light"] 與 CSS_TOKENS_LIGHT 同名同值（沒有多也沒有少）', () => {
    expect(Object.keys(lightDeclared).length).toBeGreaterThan(0)
    for (const [k, v] of Object.entries(CSS_TOKENS_LIGHT)) expect(lightDeclared[k], k).toBe(v)
    for (const k of Object.keys(lightDeclared)) expect(CSS_TOKENS_LIGHT[k], k).toBeDefined()
  })
  it('「跟系統」的 media 淺色區塊與 [data-theme=light] 區塊內容相同', () => {
    expect(Object.keys(mediaDeclared).length).toBeGreaterThan(0)
    expect(mediaDeclared).toEqual(lightDeclared)
    expect(css).toMatch(/color-scheme:\s*light/)
  })
})
