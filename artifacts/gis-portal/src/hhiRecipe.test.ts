import { describe, expect, it } from 'vitest'
import { recipeCard } from './hhiRecipe'
import { RANK } from './nowCards'
import type { DailyLife } from './milestones'

const day = (y: number, m: number, d: number) => new Date(Date.UTC(y, m - 1, d)).toISOString().slice(0, 10)
const hist = (dates: string[], scores: number[]) => dates.map((date, i) => ({ date, displayedScore: scores[i]! }))
const lifeOf = (entries: Record<string, Partial<DailyLife[string]>>): DailyLife => {
  const out: DailyLife = {}
  for (const [date, v] of Object.entries(entries)) out[date] = { date, socialPeople: 0, newPlaces: [], trip: null, workouts: [], ...v }
  return out
}

/** 11/1～11/7 的隔天差都是 [1,1,1,0,0,0,0]；見人 3 天、沒見人 3 天 → 差 1 分 */
const novHistory = hist(
  Array.from({ length: 7 }, (_, i) => day(2026, 11, 1 + i)),
  [60, 61, 62, 63, 63, 63, 63],
)
const novLife = lifeOf({
  [day(2026, 11, 1)]: { socialPeople: 1 },
  [day(2026, 11, 2)]: { socialPeople: 1 },
  [day(2026, 11, 3)]: { socialPeople: 1 },
})

describe('recipeCard', () => {
  it('1～7 日推出上個月的配方卡', () => {
    const c = recipeCard({ history: novHistory, life: novLife, today: '2026-12-03' })
    expect(c).toEqual({
      key: 'recipe:2026-11', kind: 'recipe', forDate: '2026-12-03', at: null,
      why: '每月初整理上個月', title: '你的幸福配方：11 月',
      lines: ['見人的日子，隔天幸福指數多 1 分（3／3 天）'], point: '', rank: RANK.recipe,
    })
    expect(c?.rank).toBe(5.5)
    expect(recipeCard({ history: novHistory, life: novLife, today: '2026-12-01' })).not.toBeNull()
    expect(recipeCard({ history: novHistory, life: novLife, today: '2026-12-07' })).not.toBeNull()
  })
  it('8 日以後不推', () => {
    expect(recipeCard({ history: novHistory, life: novLife, today: '2026-12-08' })).toBeNull()
  })
  it('上個月沒有成立的項目就不推', () => {
    expect(recipeCard({ history: novHistory, life: lifeOf({}), today: '2026-12-03' })).toBeNull()
    expect(recipeCard({ history: novHistory, life: null, today: '2026-12-03' })).toBeNull()
  })
})
