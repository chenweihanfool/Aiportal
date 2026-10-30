import { describe, expect, it } from "vitest"
import { computeIdeasMind } from "./ideasMind"

const TODAY = "2026-10-20"
const at = (ymd: string) => `${ymd}T10:00:00+08:00`
const daysAgo = (n: number) => new Date(Date.parse(`${TODAY}T10:00:00+08:00`) - n * 86_400_000 + 8 * 3600e3).toISOString().slice(0, 10)
let seq = 0
const idea = (bornDaysAgo: number, history: Array<[string, number]> = []) => ({
  id: `IDEA-${String(++seq).padStart(4, "0")}`, title: "x", category: null, dimension: null, source: null, why: null,
  value: 3, effort: 3, status: (history.at(-1)?.[0] ?? "new") as never, bornAt: at(daysAgo(bornDaysAgo)),
  lastMentioned: at(daysAgo(bornDaysAgo)), mentions: 1, backfill: false, days: [], baseScore: 9, baseWhy: [],
  history: [{ status: "new", at: at(daysAgo(bornDaysAgo)) }, ...history.map(([s, d]) => ({ status: s, at: at(daysAgo(d)) }))],
})

describe("computeIdeasMind", () => {
  it("birth score uses a fixed target: 6 new ideas in 7 days = 50", () => {
    const six = [0, 1, 2, 3, 4, 5].map((d) => idea(d))
    expect(computeIdeasMind(six, TODAY).birth).toMatchObject({ born7: 6, score: 50 })
    expect(computeIdeasMind([...six, idea(30)], TODAY).birth.born7).toBe(6)
    expect(computeIdeasMind([], TODAY)).toMatchObject({ score: 0, birth: { born7: 0, score: 0 }, action: { done28: 0, score: 0 } })
  })

  it("the score keeps moving at the real pace instead of saturating", () => {
    const ten = Array.from({ length: 10 }, (_, d) => idea(d % 7))
    const done18 = Array.from({ length: 18 }, (_, d) => idea(40, [["done", d]]))
    const r = computeIdeasMind([...ten, ...done18], TODAY)
    expect(r.score).toBeGreaterThan(70)
    expect(r.score).toBeLessThan(80)
  })

  it("action score counts ideas done in 28 days: 8 = 50; done before the window does not count", () => {
    const eight = Array.from({ length: 8 }, (_, d) => idea(40, [["done", d]]))
    expect(computeIdeasMind(eight, TODAY).action).toMatchObject({ done28: 8, score: 50 })
    expect(computeIdeasMind([idea(60, [["done", 40]])], TODAY).action.done28).toBe(0)
  })

  it("backfilled ideas count for neither arm (10/09 補登 44 筆 done 不能灌分)", () => {
    const bf = Array.from({ length: 44 }, () => ({ ...idea(2, [["done", 1]]), backfill: true }))
    expect(computeIdeasMind(bf, TODAY)).toMatchObject({ score: 0, birth: { born7: 0 }, action: { done28: 0 } })
  })
})
