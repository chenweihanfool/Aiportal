import { describe, expect, it } from "vitest"
import { parsePushers } from "./pusherHealth"

describe("parsePushers", () => {
  it("returns null when the pusher does not send the field", () => {
    expect(parsePushers(undefined)).toBeNull()
    expect(parsePushers({})).toBeNull()
  })
  it("keeps valid rows, drops rows without feed, clamps unknown level to warn", () => {
    const r = parsePushers([
      { feed: "hermes-graph", level: "ok", lastOk: "2026-10-09T15:05:00+08:00", ageMin: 3.2, expectedEveryMin: 10, okCount: 5 },
      { level: "ok" },
      { feed: "hermes-usage", level: "weird", lastError: "x".repeat(500) },
    ])!
    expect(r.map((x) => x.feed)).toEqual(["hermes-graph", "hermes-usage"])
    expect(r[0]).toMatchObject({ level: "ok", ageMin: 3.2, okCount: 5, failCount: 0, path: null })
    expect(r[1]!.level).toBe("warn")
    expect(r[1]!.lastError).toHaveLength(200)
  })
})
