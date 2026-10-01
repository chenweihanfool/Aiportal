import { describe, expect, it } from "vitest"
import { diskAlertLevel, forecastDisk } from "./diskForecast"

const pts = (vals: Array<number | null>, start = "2026-09-20") =>
  vals.map((usedGb, i) => ({ date: new Date(Date.parse(`${start}T00:00:00Z`) + i * 86_400_000).toISOString().slice(0, 10), usedGb }))

describe("forecastDisk", () => {
  it("fits a steady growth and estimates days until full", () => {
    const r = forecastDisk(pts([10, 10.5, 11, 11.5, 12]), 20)
    expect(r.insufficient).toBe(false)
    expect(r.growthGbPerDay).toBeCloseTo(0.5, 3)
    expect(r.daysUntilFull).toBe(40)
    expect(r.basedOnDays).toBe(5)
  })

  it("reports insufficient data below 3 points or 2-day span", () => {
    expect(forecastDisk(pts([10, 11]), 20)).toMatchObject({ insufficient: true, growthGbPerDay: null, daysUntilFull: null })
    expect(forecastDisk(pts([10, null, null]), 20).insufficient).toBe(true)
    expect(forecastDisk([], 20).basedOnDays).toBe(0)
  })

  it("flat or shrinking usage → no days-until-full", () => {
    expect(forecastDisk(pts([10, 10, 10, 10]), 20).daysUntilFull).toBeNull()
    const shrink = forecastDisk(pts([12, 11, 10, 9]), 20)
    expect(shrink.growthGbPerDay).toBeLessThan(0)
    expect(shrink.daysUntilFull).toBeNull()
  })

  it("ignores measurement noise under 5 MB/day", () => {
    expect(forecastDisk(pts([10, 10.002, 10.004, 10.006]), 20).daysUntilFull).toBeNull()
  })

  it("uses only the latest 14 points and uses real date gaps", () => {
    const old = pts(Array(10).fill(50), "2026-08-01")
    const recent = pts([10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23], "2026-09-10")
    expect(forecastDisk([...old, ...recent], 30).growthGbPerDay).toBeCloseTo(1, 3)
    // 缺天：第 0、2、4 天 → 每天 +1
    const gapped = [{ date: "2026-09-01", usedGb: 10 }, { date: "2026-09-03", usedGb: 12 }, { date: "2026-09-05", usedGb: 14 }]
    expect(forecastDisk(gapped, 10).growthGbPerDay).toBeCloseTo(1, 3)
  })

  it("null free space gives null days", () => {
    expect(forecastDisk(pts([10, 11, 12]), null).daysUntilFull).toBeNull()
  })
})

describe("diskAlertLevel", () => {
  it.each([
    [50, 40, null, "ok"],
    [80, 20, null, "warn"],
    [90, 20, null, "crit"],
    [60, 2.9, null, "crit"],
    [60, 30, 40, "warn"],
    [60, 30, 13, "crit"],
    [null, null, null, "ok"],
  ] as const)("%s%% used, %s GB free, %s days → %s", (pct, free, days, level) => {
    expect(diskAlertLevel(pct, free, days)).toBe(level)
  })
})
