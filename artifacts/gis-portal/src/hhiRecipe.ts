// 幸福觸發 3（3.6.0）：每月初推一張「你的幸福配方」。純函式，不碰 DOM、不發網路。
// 規則見任務單 hhi-recipe：每個月 1～7 日，拿上個月每天做了哪些事對照隔天幸福指數，
// 列出做了之後隔天分數比較高／低的前 3 項並註明樣本數。
import { monthlyRecipe, prevMonth, recipeLine } from './companion'
import type { HhiHistoryPoint } from './boardApi'
import type { DailyLife } from './milestones'
import { RANK, cardKeyOf, type NowCard } from './nowCards'

export interface RecipeCardInput {
  history: readonly HhiHistoryPoint[]
  life: DailyLife | null
  today: string
}

/** 每月 1～7 日、上個月有成立項目才推卡 */
export function recipeCard({ history, life, today }: RecipeCardInput): NowCard | null {
  const dd = Number(today.slice(8, 10))
  if (!(dd >= 1 && dd <= 7)) return null
  const ym = prevMonth(today)
  const { items } = monthlyRecipe(history, life, ym)
  if (items.length === 0) return null
  return {
    key: cardKeyOf({ kind: 'recipe', ym }),
    kind: 'recipe', forDate: today, at: null,
    why: '每月初整理上個月',
    title: `你的幸福配方：${Number(ym.slice(5, 7))} 月`,
    lines: items.map(recipeLine), point: '', rank: RANK.recipe,
  }
}
