import { describe, expect, it } from "vitest"
import { describePostSource, hasArrayField, shouldRejectEmptyGraph } from "./graphGuard"

describe("shouldRejectEmptyGraph", () => {
  it("rejects an empty push over an existing non-empty graph", () => {
    expect(shouldRejectEmptyGraph(0, 935)).toBe(true)
    expect(shouldRejectEmptyGraph(0, 1)).toBe(true)
  })
  it("accepts any non-empty push", () => {
    expect(shouldRejectEmptyGraph(1, 935)).toBe(false)
    expect(shouldRejectEmptyGraph(900, 935)).toBe(false)
    expect(shouldRejectEmptyGraph(5, 0)).toBe(false)
  })
  it("accepts an empty push when there was nothing to protect (first run or already empty)", () => {
    expect(shouldRejectEmptyGraph(0, 0)).toBe(false)
    expect(shouldRejectEmptyGraph(0, null)).toBe(false)
    expect(shouldRejectEmptyGraph(0, undefined)).toBe(false)
  })
})

describe("describePostSource", () => {
  it("keeps only identifying fields and never the credential header", () => {
    const s = describePostSource({ "x-forwarded-for": "1.2.3.4", "user-agent": "PowerShell/7.4", "x-admin-password": "secret" }, "10.0.0.5")
    expect(s).toEqual({ ip: "10.0.0.5", forwardedFor: "1.2.3.4", userAgent: "PowerShell/7.4" })
    expect(JSON.stringify(s)).not.toContain("secret")
  })
  it("handles missing and array headers and truncates long values", () => {
    expect(describePostSource({}, undefined)).toEqual({ ip: null, forwardedFor: null, userAgent: null })
    expect(describePostSource({ "x-forwarded-for": ["a", "b"] }, undefined).forwardedFor).toBe("a")
    expect(describePostSource({ "user-agent": "x".repeat(500) }, undefined).userAgent).toHaveLength(200)
  })
})

describe("hasArrayField", () => {
  it("accepts a body that carries the array field, even when it is empty", () => {
    expect(hasArrayField({ events: [] }, "events")).toBe(true)
    expect(hasArrayField({ events: [{ id: 1 }], other: 1 }, "events")).toBe(true)
  })
  it("rejects probes and malformed bodies", () => {
    expect(hasArrayField({}, "events")).toBe(false)
    expect(hasArrayField({ probe: true }, "events")).toBe(false)
    expect(hasArrayField({ events: "x" }, "events")).toBe(false)
    expect(hasArrayField({ events: null }, "events")).toBe(false)
    expect(hasArrayField(undefined, "events")).toBe(false)
    expect(hasArrayField(null, "events")).toBe(false)
    expect(hasArrayField([], "events")).toBe(false)
  })
})
