import { describe, expect, it } from "vitest"
import { parseStorage } from "../lib/diskForecast"

describe("parseStorage", () => {
  it("returns null when the field is absent (old pusher) and [] for an empty array", () => {
    expect(parseStorage(undefined)).toBeNull()
    expect(parseStorage("x")).toBeNull()
    expect(parseStorage([])).toEqual([])
  })

  it("keeps valid rows, trims labels, rounds bytes, drops malformed ones", () => {
    const r = parseStorage([
      { label: " vault ", bytes: 1234.6 },
      { label: "", bytes: 5 },
      { label: "neg", bytes: -1 },
      { label: "nan", bytes: Number.NaN },
      { label: 3, bytes: 1 },
      null,
      { label: "pg", bytes: 0 },
    ])
    expect(r).toEqual([{ label: "vault", bytes: 1235 }, { label: "pg", bytes: 0 }])
  })

  it("caps rows at 30 and labels at 60 chars", () => {
    const rows = Array.from({ length: 40 }, (_, i) => ({ label: "x".repeat(80) + i, bytes: i }))
    const r = parseStorage(rows)!
    expect(r).toHaveLength(30)
    expect(r[0]!.label).toHaveLength(60)
  })
})

describe("parseStorage note", () => {
  it("keeps a trimmed non-empty note (capped at 80 chars) and omits blank or non-string notes", () => {
    const r = parseStorage([
      { label: "build cache", bytes: 1, note: "  可回收 17.3 GB  " },
      { label: "a", bytes: 2, note: "" },
      { label: "b", bytes: 3, note: 5 },
      { label: "c", bytes: 4, note: "x".repeat(100) },
    ])!
    expect(r[0]).toEqual({ label: "build cache", bytes: 1, note: "可回收 17.3 GB" })
    expect(r[1]).toEqual({ label: "a", bytes: 2 })
    expect(r[2]).toEqual({ label: "b", bytes: 3 })
    expect(r[3]!.note).toHaveLength(80)
  })
})
