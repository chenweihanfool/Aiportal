import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { buildHhiBreakdown } from './boardView'
import { DIMENSION_HERO_FIELD } from './DimensionCards'
import { DIMENSIONS, dimensionBySubsystem, dimensionOf } from './dimensions'

describe('面向註冊表', () => {
  it('六個面向、key／名稱／識別色／分數欄位／權重欄位都不重複', () => {
    expect(DIMENSIONS.map((d) => d.key)).toEqual(['lifeFreedom', 'fitness', 'calm', 'mind', 'social', 'travel'])
    for (const f of ['key', 'label', 'color', 'scoreKey', 'weightKey', 'subsystemId'] as const) {
      expect(new Set(DIMENSIONS.map((d) => d[f])).size, f).toBe(DIMENSIONS.length)
    }
  })
  it('預設權重加起來是 1（與後端基準權重一致）', () => {
    expect(Math.round(DIMENSIONS.reduce((s, d) => s + d.defaultWeight, 0) * 1000) / 1000).toBe(1)
  })
  it('每個面向都有「衡量什麼」與資料來源', () => {
    for (const d of DIMENSIONS) {
      expect(d.about.measures.length, d.key).toBeGreaterThan(10)
      expect(d.about.source.length, d.key).toBeGreaterThan(1)
    }
  })
  it('查詢函式：依 key、依子系統；不認得的回 null', () => {
    expect(dimensionOf('calm')?.subsystemId).toBe('vikunja')
    expect(dimensionBySubsystem('pf-cwh')?.key).toBe('lifeFreedom')
    expect(dimensionBySubsystem('mind-index')?.detail).toBe('mind')
    expect(dimensionOf('nope')).toBeNull()
    expect(dimensionBySubsystem('nope')).toBeNull()
  })
  it('只有 detail=subsystem 的四個面向有原始分數欄位對照表（給各面向卡用）', () => {
    expect(DIMENSION_HERO_FIELD).toEqual({ 'pf-cwh': 'lifeFreedomIndex', fitnessforge: 'habitIndex', vikunja: 'busyIndex', travel: 'travelScore' })
  })
})

describe('各處都由註冊表推導（改一處、全站跟著變）', () => {
  it('幸福指數拆解的六列＝註冊表的順序與名稱；權重缺值時用註冊表的預設', () => {
    const b = buildHhiBreakdown({ displayedScore: 70 })!
    expect(b.rows.map((r) => [r.key, r.label, r.weightPct])).toEqual(DIMENSIONS.map((d) => [d.key, d.label, Math.round(d.defaultWeight * 100)]))
  })
  it('分數與權重欄位照註冊表讀', () => {
    const data: Record<string, unknown> = { displayedScore: 70, weights: {} }
    DIMENSIONS.forEach((d, i) => { data[d.scoreKey] = 50 + i; (data.weights as Record<string, number>)[d.weightKey] = 0.1 })
    const b = buildHhiBreakdown(data)!
    expect(b.rows.map((r) => r.value)).toEqual([50, 51, 52, 53, 54, 55])
    expect(b.rows.every((r) => r.weightPct === 10)).toBe(true)
  })
})

describe('與後端不漂移', () => {
  const read = (rel: string) => readFileSync(resolve(__dirname, '../../api-server/src/lib', rel), 'utf8')
  const index = read('happinessIndex.ts')
  const history = read('happinessDimensionHistory.ts')
  it('hhi 摘要的分數欄位與權重欄位，後端 happinessIndex.ts 都有定義', () => {
    for (const d of DIMENSIONS) {
      expect(index, d.scoreKey).toContain(d.scoreKey)
      expect(index, d.weightKey).toContain(d.weightKey)
    }
  })
  it('歷史接口的面向 key（components）後端 happinessDimensionHistory.ts 都有', () => {
    for (const d of DIMENSIONS) expect(history, d.key).toMatch(new RegExp(`['"]${d.key}['"]`))
  })
  it('預設權重與後端基準權重一致', () => {
    for (const d of DIMENSIONS) {
      const m = new RegExp(`${d.weightKey}:\\s*([0-9.]+)`).exec(index)
      expect(m, d.weightKey).not.toBeNull()
      expect(Number(m![1]), d.weightKey).toBe(d.defaultWeight)
    }
  })
})
