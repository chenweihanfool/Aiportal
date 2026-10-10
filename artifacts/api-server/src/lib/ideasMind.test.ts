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
  it("birth score compares last 7 days with the 8-week median (baseline at least 1)", () => {
    // 過去 8 週每週 2 個（第 8～63 天），近 7 天 3 個 → 3/2 → 上限 100；近 7 天 1 個 → 50
    const past = Array.from({ length: 8 }, (_, w) => [idea(10 + w * 7), idea(11 + w * 7)]).flat()
    const r1 = computeIdeasMind([...past, idea(0), idea(2), idea(6)], TODAY)
    expect(r1.birth).toMatchObject({ born7: 3, baseline: 2, score: 100 })
    const r2 = computeIdeasMind([...past, idea(3)], TODAY)
    expect(r2.birth).toMatchObject({ born7: 1, baseline: 2, score: 50 })
    expect(computeIdeasMind([idea(1)], TODAY).birth).toMatchObject({ born7: 1, baseline: 1, score: 100 })
  })

  it("action score: done in 28 days over ideas that had the chance, against a 20% target", () => {
    const ideas = [
      idea(40, [["done", 5]]), // 窗口內實行 → 分子＋分母
      idea(40), idea(40), idea(40), idea(40), idea(40), idea(40), idea(40), idea(40), // 8 個開放中 → 分母
      idea(60, [["done", 40]]), // 窗口前就實行 → 不算
      idea(60, [["dropped", 35]]), // 窗口前就放棄 → 不算
      idea(3), // 未滿 7 天 → 不算
    ]
    const r = computeIdeasMind(ideas, TODAY)
    expect(r.action).toMatchObject({ done28: 1, eligible: 9 })
    expect(r.action.score).toBe(Math.round((100 * (1 / 9)) / 0.2 * 10) / 10) // 55.6
    expect(r.score).toBeCloseTo(0.4 * r.birth.score + 0.6 * r.action.score, 0)
    expect(r.formula).toContain("40%")
  })

  it("🔀 absorbed ideas are not in the denominator, whether absorbed before or inside the window", () => {
    const open = [idea(40), idea(40)]
    expect(computeIdeasMind(open, TODAY).action.eligible).toBe(2)
    const withAbsorbed = [...open, idea(40, [["absorbed", 35]]), idea(40, [["absorbed", 5]])]
    expect(computeIdeasMind(withAbsorbed, TODAY).action.eligible).toBe(2)
  })

  it("an idea reopened inside the window counts again; empty library scores 0", () => {
    const reopened = idea(60, [["shelved", 40], ["doing", 10]])
    expect(computeIdeasMind([reopened], TODAY).action.eligible).toBe(1)
    expect(computeIdeasMind([], TODAY)).toMatchObject({ score: 0, action: { eligible: 0, score: 0 } })
  })
})
