import { describe, expect, it } from "vitest"
import { DAY_ENTRIES_MAX, ENTRY_TEXT_MAX, TRIPS_MAX, TRIP_DAYS_MAX, TRIP_PHOTOS_MAX, sanitizeTripsPayload, taipeiToday } from "./hermesTrips"

// 台北時間 2026-10-15 中午
const NOW = new Date("2026-10-15T12:00:00+08:00")

const trip = (id: string, over: Record<string, unknown> = {}) => ({
  id, name: `遊 ${id}`, start: "2026-10-10", end: "2026-10-12", days: [], placeIds: [], ...over,
})
const entry = (time: string, over: Record<string, unknown> = {}) => ({ time, text: `內容 ${time}`, photos: [], photosPending: 0, ...over })
const ok = (body: unknown) => {
  const r = sanitizeTripsPayload(body, NOW)
  if (typeof r === "string") throw new Error(r)
  return r
}

describe("sanitizeTripsPayload", () => {
  it("rejects non-object body, non-array trips, and more than 50 trips", () => {
    expect(sanitizeTripsPayload(null, NOW)).toBe("body 不是物件")
    expect(sanitizeTripsPayload({}, NOW)).toBe("trips 不是陣列")
    const many = Array.from({ length: TRIPS_MAX + 1 }, (_, i) => trip(`T-${i}`))
    expect(sanitizeTripsPayload({ trips: many }, NOW)).toBe(`trips 超過 ${TRIPS_MAX} 筆`)
    expect(ok({ trips: many.slice(0, TRIPS_MAX) }).trips).toHaveLength(TRIPS_MAX)
  })

  it("uses the Taipei date for today", () => {
    expect(taipeiToday(new Date("2026-10-15T20:00:00+08:00"))).toBe("2026-10-15")
    // 台北 00:30 = UTC 前一天 16:30
    expect(taipeiToday(new Date("2026-10-14T16:30:00Z"))).toBe("2026-10-15")
  })

  it("skips trips without id/name/valid dates, end before start, impossible dates; keeps the first duplicate", () => {
    const r = ok({
      trips: [
        trip("T-1"),
        trip(""),
        trip("T-2", { name: "  " }),
        trip("T-3", { start: "2026/10/10" }),
        trip("T-4", { end: "2026-02-31" }),
        trip("T-5", { start: "2026-10-12", end: "2026-10-10" }),
        trip("T-1", { name: "重複" }),
        null,
        "x",
      ],
    })
    expect(r.trips.map((t) => t.id)).toEqual(["T-1"])
    expect(r.trips[0]!.name).toBe("遊 T-1")
    expect(r.skipped).toBe(8)
  })

  it("keeps a valid status and derives an invalid one from the dates (Taipei today = 2026-10-15)", () => {
    const r = ok({
      trips: [
        trip("A", { start: "2026-09-01", end: "2026-09-03", status: "planned" }), // 合法：照用
        trip("B", { start: "2026-09-01", end: "2026-09-03" }), // end < today → done
        trip("C", { start: "2026-10-20", end: "2026-10-22", status: "bogus" }), // start > today → planned
        trip("D", { start: "2026-10-14", end: "2026-10-16" }), // 進行中
        trip("E", { start: "2026-10-15", end: "2026-10-15" }), // 今天：ongoing
      ],
    })
    const st = Object.fromEntries(r.trips.map((t) => [t.id, t.status]))
    expect(st).toEqual({ A: "planned", B: "done", C: "planned", D: "ongoing", E: "ongoing" })
  })

  it("sorts trips by start (newest first), then id", () => {
    const r = ok({ trips: [trip("b", { start: "2026-08-01", end: "2026-08-02" }), trip("a", { start: "2026-10-10", end: "2026-10-11" }), trip("c", { start: "2026-10-10", end: "2026-10-11" })] })
    expect(r.trips.map((t) => t.id)).toEqual(["a", "c", "b"])
  })

  it("drops days outside [start, end], merges duplicate dates, sorts days and entries by time (stable)", () => {
    const r = ok({
      trips: [trip("T", {
        days: [
          { date: "2026-10-12", title: null, placeIds: ["FOOD-0002"], entries: [entry("18:00", { text: "晚餐" })] },
          { date: "2026-10-09", entries: [entry("10:00")] }, // 早於 start
          { date: "2026-10-10", title: "出發", placeIds: ["FOOD-0001"], entries: [entry("12:00", { text: "甲" }), entry("08:00")] },
          { date: "2026-10-10", title: "忽略第二個標題", placeIds: ["FOOD-0001", "FOOD-0003"], entries: [entry("12:00", { text: "乙" })] },
          { date: "2026-10-13", entries: [entry("09:00")] }, // 晚於 end
        ],
      })],
    })
    const days = r.trips[0]!.days
    expect(days.map((d) => d.date)).toEqual(["2026-10-10", "2026-10-12"])
    expect(days[0]).toMatchObject({ title: "出發", placeIds: ["FOOD-0001", "FOOD-0003"] })
    // 同 12:00 的兩筆依輸入順序（甲在前）
    expect(days[0]!.entries.map((e) => `${e.time}${e.text}`)).toEqual(["08:00內容 08:00", "12:00甲", "12:00乙"])
  })

  it("caps trip days at 60 (extra days are skipped)", () => {
    const days = Array.from({ length: 70 }, (_, i) => {
      const d = new Date(Date.UTC(2026, 0, 1) + i * 86_400_000).toISOString().slice(0, 10)
      return { date: d, entries: [] }
    })
    const r = ok({ trips: [trip("L", { start: "2026-01-01", end: "2026-12-31", days })] })
    expect(r.trips[0]!.days).toHaveLength(TRIP_DAYS_MAX)
  })

  it("validates entries: HH:MM only, empty entries dropped, pending-only kept, text trimmed and truncated", () => {
    const long = "字".repeat(ENTRY_TEXT_MAX + 50)
    const r = ok({
      trips: [trip("T", {
        days: [{
          date: "2026-10-10",
          entries: [
            entry("7:00"), entry("24:00"), entry("08:60"), entry("0800"),
            entry("09:00", { text: "   " }), // 沒文字、沒相片、沒待處理：略過
            entry("10:00", { text: "", photosPending: 2 }), // 只有待處理相片：保留
            entry("11:00", { text: "a\r\nb  ", photosPending: -1 }),
            entry("12:00", { text: long }),
          ],
        }],
      })],
    })
    const es = r.trips[0]!.days[0]!.entries
    expect(es.map((e) => e.time)).toEqual(["10:00", "11:00", "12:00"])
    expect(es[0]).toMatchObject({ text: "", photosPending: 2 })
    expect(es[1]).toMatchObject({ text: "a\nb", photosPending: 0 })
    expect(es[2]!.text).toHaveLength(ENTRY_TEXT_MAX)
  })

  it("keeps only https or site-absolute photo urls; caps 24 photos per entry", () => {
    const photos = [
      { url: "https://example.com/a.jpg", takenAt: "2026-10-10", caption: " 招牌 " },
      { url: "javascript:alert(1)" },
      { url: "data:image/png;base64,AAAA" },
      { url: "//evil.example/x.jpg" },
      ...Array.from({ length: 30 }, (_, i) => ({ url: `/media/${i}.webp` })),
    ]
    const r = ok({ trips: [trip("T", { days: [{ date: "2026-10-10", entries: [entry("09:00", { photos })] }] })] })
    const ph = r.trips[0]!.days[0]!.entries[0]!.photos
    expect(ph).toHaveLength(24)
    expect(ph[0]).toMatchObject({ url: "https://example.com/a.jpg", caption: "招牌", takenAt: "2026-10-10" })
  })

  it("caps photos per trip at 600 and drops the extras without error", () => {
    const photos = Array.from({ length: 24 }, (_, i) => ({ url: `/media/${i}.webp` }))
    const days = Array.from({ length: 30 }, (_, d) => ({
      date: new Date(Date.UTC(2026, 9, 1) + d * 86_400_000).toISOString().slice(0, 10),
      entries: Array.from({ length: 10 }, (_, e) => entry(`${String(e + 8).padStart(2, "0")}:00`, { photos })),
    }))
    const r = ok({ trips: [trip("P", { start: "2026-10-01", end: "2026-10-30", days })] })
    const total = r.trips[0]!.days.reduce((n, d) => n + d.entries.reduce((m, e) => m + e.photos.length, 0), 0)
    expect(total).toBe(TRIP_PHOTOS_MAX)
  })

  it("caps entries per day at 200", () => {
    const entries = Array.from({ length: DAY_ENTRIES_MAX + 20 }, (_, i) => entry(`${String(Math.floor(i / 60)).padStart(2, "0")}:${String(i % 60).padStart(2, "0")}`))
    const r = ok({ trips: [trip("E", { days: [{ date: "2026-10-10", entries }] })] })
    expect(r.trips[0]!.days[0]!.entries).toHaveLength(DAY_ENTRIES_MAX)
  })

  it("accepts a safe cover, nulls an unsafe one, and de-duplicates placeIds", () => {
    const r = ok({
      trips: [
        trip("C1", { cover: "/media/trips/c1.webp", placeIds: ["FOOD-0001", " FOOD-0001 ", "", "FOOD-0002"] }),
        trip("C2", { cover: "javascript:x" }),
        trip("C3", { cover: "https://example.com/c.jpg", generatedAt: "bad" }),
      ],
    })
    const byId = Object.fromEntries(r.trips.map((t) => [t.id, t]))
    expect(byId["C1"]).toMatchObject({ cover: "/media/trips/c1.webp", placeIds: ["FOOD-0001", "FOOD-0002"] })
    expect(byId["C2"]!.cover).toBeNull()
    expect(byId["C3"]!.cover).toBe("https://example.com/c.jpg")
    expect(r.generatedAt).toBeNull()
  })

  it("passes generatedAt through when it is a date", () => {
    expect(ok({ generatedAt: "2026-10-15", trips: [] })).toMatchObject({ generatedAt: "2026-10-15", trips: [], skipped: 0 })
  })
})
