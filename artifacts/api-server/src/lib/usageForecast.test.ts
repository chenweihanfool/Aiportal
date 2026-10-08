import { describe, expect, it } from "vitest"
import { DEFAULT_USD_PER_CALL, forecastOllama, observedUsdPerDay, sanitizeBalance, sanitizeUsageDays } from "./usageForecast"

const days = (calls: number[], start = "2026-10-01") =>
  calls.map((c, i) => ({ date: new Date(Date.parse(`${start}T00:00:00Z`) + i * 86_400_000).toISOString().slice(0, 10), calls: c }))
const at = (iso: string, balanceUsd: number) => ({ enteredAt: iso, balanceUsd })
const NOW = new Date("2026-10-08T12:00:00Z")

describe("observedUsdPerDay", () => {
  it("needs two snapshots at least 12h apart", () => {
    expect(observedUsdPerDay([at("2026-10-08T00:00:00Z", 30)], NOW)).toBeNull()
    expect(observedUsdPerDay([at("2026-10-08T00:00:00Z", 30), at("2026-10-08T06:00:00Z", 29)], NOW)).toBeNull()
  })
  it("computes dollars per day from the balance drop", () => {
    const r = observedUsdPerDay([at("2026-10-06T00:00:00Z", 35), at("2026-10-08T00:00:00Z", 30)], NOW)
    expect(r).toBeCloseTo(2.5, 3)
  })
  it("restarts after a top-up instead of counting it as negative spend", () => {
    const r = observedUsdPerDay([at("2026-10-01T00:00:00Z", 10), at("2026-10-05T00:00:00Z", 55), at("2026-10-07T00:00:00Z", 50)], NOW)
    expect(r).toBeCloseTo(2.5, 3)
  })
  it("returns null when the balance did not drop", () => {
    expect(observedUsdPerDay([at("2026-10-06T00:00:00Z", 30), at("2026-10-08T00:00:00Z", 30)], NOW)).toBeNull()
  })
})

describe("forecastOllama", () => {
  const base = { today: "2026-10-08", now: NOW, refillAt: "2026-10-29" }

  it("estimates from calls when only one balance snapshot exists", () => {
    const f = forecastOllama({ ...base, days: days([1000, 1000, 1000, 1000, 1000, 1000, 1000]), entries: [at("2026-10-08T04:00:00Z", 29.31)] })
    expect(f.source).toBe("estimated")
    expect(f.callsPerDay).toBe(1000)
    expect(f.usdPerDay).toBeCloseTo(1000 * DEFAULT_USD_PER_CALL, 2)
    expect(f.balanceUsd).toBe(29.31)
    expect(f.daysToRefill).toBe(21)
    expect(f.daysUntilEmpty).toBeGreaterThan(0)
  })

  it("prefers the observed burn rate and flags a shortfall before the refill", () => {
    const f = forecastOllama({ ...base, days: days([1, 1, 1, 1, 1, 1, 1]), entries: [at("2026-10-06T00:00:00Z", 35), at("2026-10-08T00:00:00Z", 30)] })
    expect(f.source).toBe("observed")
    expect(f.usdPerDay).toBeCloseTo(2.5, 3)
    expect(f.daysUntilEmpty).toBe(12)
    expect(f.emptyDate).toBe("2026-10-20")
    expect(f.shortfallUsd).toBeCloseTo(2.5 * 21 - 30, 2)
    expect(f.level).toBe("warn")
  })

  it("is ok when the balance outlasts the refill date", () => {
    const f = forecastOllama({ ...base, days: [], entries: [at("2026-10-06T00:00:00Z", 60), at("2026-10-08T00:00:00Z", 58)] })
    expect(f.shortfallUsd).toBeNull()
    expect(f.level).toBe("ok")
  })

  it("goes critical when under 3 days remain", () => {
    const f = forecastOllama({ ...base, days: [], entries: [at("2026-10-06T00:00:00Z", 10), at("2026-10-08T00:00:00Z", 4)] })
    expect(f.daysUntilEmpty).toBeCloseTo(1.3, 1)
    expect(f.level).toBe("crit")
  })

  it("does not use today's partial day and reports no data honestly", () => {
    const f = forecastOllama({ ...base, days: [{ date: "2026-10-08", calls: 600 }], entries: [] })
    expect(f.callsPerDay).toBeNull()
    expect(f.source).toBe("none")
    expect(f.daysUntilEmpty).toBeNull()
    expect(f.level).toBe("ok")
  })
})

describe("sanitizeUsageDays", () => {
  it("keeps valid days and drops garbage", () => {
    const out = sanitizeUsageDays([
      { date: "2026-10-07", models: { "deepseek-v4.1-flash": { calls: 1300, inputTokens: 5, outputTokens: 6, cacheReadTokens: 7 }, "": { calls: 1 } } },
      { date: "bad", models: {} },
      { date: "2026-10-06", models: [] },
      null,
    ])
    expect(out).toHaveLength(1)
    expect(Object.keys(out[0]!.models)).toEqual(["deepseek-v4.1-flash"])
    expect(out[0]!.models["deepseek-v4.1-flash"]!.calls).toBe(1300)
  })
  it("clamps negatives and non-numbers to 0", () => {
    const out = sanitizeUsageDays([{ date: "2026-10-07", models: { m: { calls: -5, inputTokens: "x" } } }])
    expect(out[0]!.models["m"]).toEqual({ calls: 0, inputTokens: 0, outputTokens: 0, cacheReadTokens: 0 })
  })
  it("returns [] for non-arrays", () => {
    expect(sanitizeUsageDays({})).toEqual([])
  })
})

describe("sanitizeBalance", () => {
  it("accepts a normal entry and defaults the cap to 60", () => {
    expect(sanitizeBalance({ balanceUsd: 29.31, refillAt: "2026-10-29", monthUsedUsd: 50.69 })).toEqual({ balanceUsd: 29.31, capUsd: 60, refillAt: "2026-10-29", monthUsedUsd: 50.69, note: null })
  })
  it("explains what is wrong in plain words", () => {
    expect(sanitizeBalance({})).toMatch(/餘額/)
    expect(sanitizeBalance({ balanceUsd: -1 })).toMatch(/餘額/)
    expect(sanitizeBalance({ balanceUsd: 5, refillAt: "10/29" })).toMatch(/YYYY-MM-DD/)
    expect(sanitizeBalance({ balanceUsd: 5, monthUsedUsd: "x" })).toMatch(/本月已用/)
    expect(sanitizeBalance(null)).toMatch(/餘額/)
  })
})
