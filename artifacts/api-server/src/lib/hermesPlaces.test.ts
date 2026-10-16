import { describe, expect, it } from "vitest"
import { coordsFromMapUrl, PLACES_MAX, safeImageUrl, sanitizePlacesPayload } from "./hermesPlaces"

const place = (id: string, over: Record<string, unknown> = {}) => ({
  id, name: `店 ${id}`, kind: "food", status: "want", lat: 25.03, lng: 121.56, addedAt: "2026-06-02", ...over,
})

describe("sanitizePlacesPayload", () => {
  it("rejects non-object body and non-array places", () => {
    expect(sanitizePlacesPayload(null)).toBe("body 不是物件")
    expect(sanitizePlacesPayload({})).toBe("places 不是陣列")
  })

  it("rejects more than 2000 places", () => {
    const many = Array.from({ length: PLACES_MAX + 1 }, (_, i) => place(`FOOD-${i}`))
    expect(sanitizePlacesPayload({ places: many })).toBe(`places 超過 ${PLACES_MAX} 筆`)
    const ok = sanitizePlacesPayload({ places: many.slice(0, PLACES_MAX) })
    if (typeof ok === "string") throw new Error(ok)
    expect(ok.places).toHaveLength(PLACES_MAX)
  })

  it("keeps places with no coordinate at all (lat/lng null, list only) but skips ones whose coordinate is given and invalid", () => {
    const r = sanitizePlacesPayload({
      places: [place("FOOD-0001"), place("FOOD-0002", { lat: undefined, lng: undefined }), place("FOOD-0003", { lat: 91 }), place("FOOD-0004", { lng: 181 }), place("FOOD-0005", { lat: "25" })],
    })
    if (typeof r === "string") throw new Error(r)
    expect(r.places.map((p) => p.id)).toEqual(["FOOD-0001", "FOOD-0002"])
    expect(r.places[1]).toMatchObject({ id: "FOOD-0002", lat: null, lng: null })
    expect(r.skipped).toBe(3)                           // 91、181、"25"：給了但不合法
  })

  it("a lone lat or lng without its partner is bad data, not 'no coordinate'", () => {
    const r = sanitizePlacesPayload({ places: [place("FOOD-0001", { lng: undefined }), place("FOOD-0002", { lat: null, lng: 121.5 })] })
    if (typeof r === "string") throw new Error(r)
    expect(r.places).toEqual([])
    expect(r.skipped).toBe(2)
  })

  it("takes coordinates from a Google Maps link when lat/lng are missing; a short link gives none, so the place is kept without coordinates", () => {
    const r = sanitizePlacesPayload({
      places: [
        place("FOOD-0001", { lat: undefined, lng: undefined, mapUrl: "https://www.google.com/maps/@25.0478,121.5170,17z" }),
        place("FOOD-0002", { lat: undefined, lng: undefined, mapUrl: "https://maps.app.goo.gl/AbCdEf" }),
      ],
    })
    if (typeof r === "string") throw new Error(r)
    expect(r.places).toHaveLength(2)
    expect(r.places[0]).toMatchObject({ id: "FOOD-0001", lat: 25.0478, lng: 121.517 })
    expect(r.places[1]).toMatchObject({ id: "FOOD-0002", lat: null, lng: null, mapUrl: "https://maps.app.goo.gl/AbCdEf" })
    expect(r.skipped).toBe(0)
  })

  it("drops rows missing id, name, valid status or addedAt", () => {
    const r = sanitizePlacesPayload({
      places: [place(""), place("FOOD-0002", { name: "  " }), place("FOOD-0003", { status: "eaten" }), place("FOOD-0004", { addedAt: "2026/06/02" }), place("FOOD-0005"), null, "x"],
    })
    if (typeof r === "string") throw new Error(r)
    expect(r.places.map((p) => p.id)).toEqual(["FOOD-0005"])
    expect(r.skipped).toBe(6)
  })

  it("keeps only the first of duplicate ids and counts the rest as skipped", () => {
    const r = sanitizePlacesPayload({ places: [place("FOOD-0001", { name: "甲" }), place("FOOD-0001", { name: "乙" })] })
    if (typeof r === "string") throw new Error(r)
    expect(r.places).toHaveLength(1)
    expect(r.places[0]!.name).toBe("甲")
    expect(r.skipped).toBe(1)
  })

  it("falls back unknown kind to food and nulls out-of-range fields", () => {
    const r = sanitizePlacesPayload({ places: [place("FOOD-0001", { kind: "hotel", priceLevel: 0, rating: 9, visitedAt: "10/15" })] })
    if (typeof r === "string") throw new Error(r)
    expect(r.places[0]).toMatchObject({ kind: "food", priceLevel: null, rating: null, visitedAt: null })
  })

  it("filters photos: only https or site-absolute paths, positive sizes, at most 24", () => {
    const photos = [
      { url: "https://example.com/a.jpg", thumb: "/media/a_t.webp", w: 640, h: 480, takenAt: "2026-06-02", caption: "  招牌  " },
      { url: "javascript:alert(1)" },
      { url: "data:image/png;base64,AAAA" },
      { url: "//evil.example/x.jpg" },
      { url: "https://example.com/has space.jpg" },
      { url: "/media/b.webp", thumb: "javascript:x", w: -1, h: 0, takenAt: "2026/01/01" },
      ...Array.from({ length: 30 }, (_, i) => ({ url: `/media/${i}.webp` })),
    ]
    const r = sanitizePlacesPayload({ places: [place("FOOD-0001", { photos })] })
    if (typeof r === "string") throw new Error(r)
    const ph = r.places[0]!.photos
    expect(ph).toHaveLength(24)
    expect(ph[0]).toEqual({ url: "https://example.com/a.jpg", thumb: "/media/a_t.webp", w: 640, h: 480, takenAt: "2026-06-02", caption: "招牌" })
    expect(ph[1]).toEqual({ url: "/media/b.webp", thumb: null, w: null, h: null, takenAt: null, caption: null })
    expect(ph.some((x) => x.url.startsWith("javascript") || x.url.startsWith("data:"))).toBe(false)
  })

  it("trims and caps strings and lists", () => {
    const r = sanitizePlacesPayload({
      places: [place("FOOD-0001", { name: "n".repeat(300), why: " 理由 ", tags: Array.from({ length: 60 }, (_, i) => `t${i}`), days: ["2026-06-02", "bad"] })],
    })
    if (typeof r === "string") throw new Error(r)
    const p = r.places[0]!
    expect(p.name).toHaveLength(200)
    expect(p.why).toBe("理由")
    expect(p.tags).toHaveLength(50)
    expect(p.days).toEqual(["2026-06-02"])
  })

  it("sorts output by id and reports generatedAt", () => {
    const r = sanitizePlacesPayload({ generatedAt: "2026-10-15", places: [place("FOOD-0003"), place("FOOD-0001"), place("FOOD-0002")] })
    if (typeof r === "string") throw new Error(r)
    expect(r.places.map((p) => p.id)).toEqual(["FOOD-0001", "FOOD-0002", "FOOD-0003"])
    expect(r.generatedAt).toBe("2026-10-15")
    expect(r.skipped).toBe(0)
  })
})

describe("safeImageUrl / coordsFromMapUrl", () => {
  it("accepts https and site-absolute paths only", () => {
    expect(safeImageUrl("https://a.example/x.jpg")).toBe("https://a.example/x.jpg")
    expect(safeImageUrl("/media/x.webp")).toBe("/media/x.webp")
    expect(safeImageUrl("http://a.example/x.jpg")).toBeNull()
    expect(safeImageUrl("//a.example/x.jpg")).toBeNull()
    expect(safeImageUrl("data:image/svg+xml,<svg>")).toBeNull()
    expect(safeImageUrl(42)).toBeNull()
  })
  it("parses common Google Maps forms and rejects out-of-range values", () => {
    expect(coordsFromMapUrl("https://www.google.com/maps/place/x/@25.03,121.56,17z")).toEqual({ lat: 25.03, lng: 121.56 })
    expect(coordsFromMapUrl("https://maps.google.com/?q=24.8,120.96")).toEqual({ lat: 24.8, lng: 120.96 })
    expect(coordsFromMapUrl("https://maps.google.com/?q=95,120")).toBeNull()
    expect(coordsFromMapUrl(null)).toBeNull()
  })
})
