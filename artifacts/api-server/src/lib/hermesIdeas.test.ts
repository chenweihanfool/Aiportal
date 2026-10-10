import { describe, expect, it } from "vitest"
import { rankIdeas, sanitizeIdeasPayload } from "./hermesIdeas"

const idea = (id: string, over: Record<string, unknown> = {}) => ({
  id, title: `想法 ${id}`, category: "系統", dimension: null, source: "HERMES", why: null, value: 3, effort: 3,
  status: "new", bornAt: "2026-10-09T21:40:00+08:00", lastMentioned: "2026-10-09T21:40:00+08:00", mentions: 1,
  backfill: false, days: ["2026-10-09"], history: [{ status: "new", at: "2026-10-09T21:40:00+08:00" }],
  baseScore: 9, baseWhy: ["價值 3 × 可行 3（難度 3）＝ 9"], ...over,
})

describe("sanitizeIdeasPayload", () => {
  it("rejects non-array ideas", () => {
    expect(sanitizeIdeasPayload({})).toBe("ideas 不是陣列")
    expect(sanitizeIdeasPayload(null)).toBe("body 不是物件")
  })
  it("drops malformed rows and clamps fields", () => {
    const r = sanitizeIdeasPayload({
      generatedAt: "2026-10-09",
      ideas: [idea("IDEA-0001", { value: 9, effort: 2 }), idea("bad"), { id: "IDEA-0002" }, idea("IDEA-0003", { status: "weird" })],
      weeks: [{ weekStart: "2026-10-05", born: 3, done: -1 }, { weekStart: "x" }],
    })
    if (typeof r === "string") throw new Error(r)
    expect(r.ideas.map((i) => i.id)).toEqual(["IDEA-0001"])
    expect(r.ideas[0]!.value).toBeNull()
    expect(r.ideas[0]!.effort).toBe(2)
    expect(r.weeks).toEqual([{ weekStart: "2026-10-05", born: 3, done: 0 }])
    expect(r.generatedAt).toBe("2026-10-09")
  })
})

describe("sanitizeIdeasPayload — 🔀 併入", () => {
  it("keeps absorbed ideas (an unknown status would drop the whole row) and carries mergedInto / absorbed", () => {
    const r = sanitizeIdeasPayload({
      ideas: [
        idea("IDEA-0039", { status: "absorbed", baseScore: null, mergedInto: "IDEA-0022" }),
        idea("IDEA-0022", { absorbed: ["IDEA-0039", "junk", 5] }),
        idea("IDEA-0001"),                                         // 舊快照沒有新欄位
        idea("IDEA-0002", { mergedInto: "not-an-id" }),
      ],
    })
    if (typeof r === "string") throw new Error(r)
    expect(r.ideas.map((i) => i.id)).toEqual(["IDEA-0039", "IDEA-0022", "IDEA-0001", "IDEA-0002"])
    expect(r.ideas[0]).toMatchObject({ status: "absorbed", mergedInto: "IDEA-0022", absorbed: [] })
    expect(r.ideas[1]).toMatchObject({ mergedInto: null, absorbed: ["IDEA-0039"] })
    expect(r.ideas[2]).toMatchObject({ mergedInto: null, absorbed: [] })
    expect(r.ideas[3]!.mergedInto).toBeNull()
  })
  it("absorbed ideas are never ranked", () => {
    const { top } = rankIdeas([idea("IDEA-0039", { status: "absorbed", baseScore: 99 }), idea("IDEA-0022")] as never, null)
    expect(top).toEqual(["IDEA-0022"])
  })
})

describe("rankIdeas", () => {
  it("ranks open ideas only and applies the weakest-dimension boost", () => {
    const { ideas, top } = rankIdeas(
      [
        idea("IDEA-0001", { baseScore: 10 }),
        idea("IDEA-0002", { baseScore: 8, category: "旅遊", dimension: "旅遊生活" }),
        idea("IDEA-0003", { baseScore: 20, status: "done" }),
        idea("IDEA-0004", { baseScore: 5 }),
        idea("IDEA-0005", { baseScore: 1 }),
      ] as never,
      "旅遊生活",
    )
    expect(top).toEqual(["IDEA-0002", "IDEA-0001", "IDEA-0004"]) // 8×1.3＝10.4 > 10
    const travel = ideas.find((i) => i.id === "IDEA-0002")!
    expect(travel.score).toBe(10.4)
    expect(travel.weakBoost).toBe(true)
    expect(travel.scoreWhy.at(-1)).toContain("補短板")
    expect(ideas.find((i) => i.id === "IDEA-0003")!.score).toBeNull()
  })
  it("ties break by id and no weakest means no boost", () => {
    const { top, ideas } = rankIdeas([idea("IDEA-0002"), idea("IDEA-0001")] as never, null)
    expect(top).toEqual(["IDEA-0001", "IDEA-0002"])
    expect(ideas.every((i) => !i.weakBoost)).toBe(true)
  })
})
