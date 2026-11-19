// 搜尋直達答案（3.14.0）的純邏輯：範本命中時找出它用在哪些方法頁／哪一步，以及閱讀面板要顯示的路線與「為什麼」。
// 不碰 React／網路；元件在 SearchAnswerPanel.tsx，測試在 searchAnswer.test.ts。
import type { Topic } from './knowledgeView'
import type { StepCase, StepDoc, StepInsight, StepPitfall, StepRule } from './knowledgeSteps'

export interface TemplateUse { topic: Topic; stepIndex: number }

export const MAX_USES = 3
const MAX_DOCS = 2
const MAX_WHY = 2
const MAX_RELATED = 3

const docCount = (t: Topic): number => (t.steps ?? []).reduce((n, s) => n + s.docs.length, 0)

/** 範本用在哪些方法：先比 templateId，全都沒有才比 family（舊版範本也對得到方法）；每題一筆（第一個命中的步驟），docs 多的題目在前，最多 3 筆 */
export function findTemplateUses(topics: readonly Topic[] | null | undefined, templateId: string, family: string | null | undefined): TemplateUse[] {
  if (!topics || topics.length === 0) return []
  const collect = (match: (d: StepDoc) => boolean): TemplateUse[] => {
    const out: TemplateUse[] = []
    for (const topic of topics) {
      const steps = topic.steps
      if (!steps || steps.length === 0) continue
      const stepIndex = steps.findIndex((s) => s.docs.some(match))
      if (stepIndex >= 0) out.push({ topic, stepIndex })
    }
    return out
  }
  let uses = collect((d) => d.templateId === templateId)
  if (uses.length === 0 && family) uses = collect((d) => d.family === family)
  // Array.prototype.sort 穩定：docs 一樣多時維持 feed 原順序
  return uses.sort((a, b) => docCount(b.topic) - docCount(a.topic)).slice(0, MAX_USES)
}

export interface RouteStation { index: number; title: string; docCount: number; current: boolean }
export interface StepAnswer {
  docs: StepDoc[]
  rules: StepRule[]
  pitfalls: StepPitfall[]
  cases: StepCase[]
  insights: StepInsight[]
}
export interface Answer {
  route: RouteStation[]
  stepIndex: number
  step: StepAnswer | null
  related: Array<{ id: string; name: string }>
}

/** 日期新到舊；沒有日期的排最後 */
function casesNewestFirst(cases: readonly StepCase[]): StepCase[] {
  return [...cases].sort((a, b) => (b.date ?? '').localeCompare(a.date ?? ''))
}

/** 閱讀面板要的資料。stepIndex 超出範圍或不是整數時當成 -1（只有路線，沒有 step），不丟例外 */
export function answerFor(topic: Topic, stepIndex: number): Answer {
  const steps = topic.steps ?? []
  const idx = Number.isInteger(stepIndex) && stepIndex >= 0 && stepIndex < steps.length ? stepIndex : -1
  const route = steps.map((s, i) => ({ index: i, title: s.title, docCount: s.docs.length, current: i === idx }))
  const related = (topic.related ?? []).slice(0, MAX_RELATED).map((r) => ({ id: r.id, name: r.name }))
  if (idx < 0) return { route, stepIndex: -1, step: null, related }
  const s = steps[idx]
  return {
    route,
    stepIndex: idx,
    step: {
      docs: s.docs.slice(0, MAX_DOCS),
      rules: s.why.rules.slice(0, MAX_WHY),
      pitfalls: s.why.pitfalls.slice(0, MAX_WHY),
      cases: casesNewestFirst(s.cases).slice(0, MAX_WHY),
      insights: s.why.insights.slice(0, MAX_WHY),
    },
    related,
  }
}
