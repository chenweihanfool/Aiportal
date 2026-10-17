import { describe, expect, it } from "vitest"
import { isActiveCase, sanitizeCaseTaskState } from "./caseTaskState"

describe("sanitizeCaseTaskState", () => {
  it("passes only the two known marks", () => {
    expect(sanitizeCaseTaskState("進行中")).toBe("進行中")
    expect(sanitizeCaseTaskState("已結案")).toBe("已結案")
  })
  it("treats everything else as no mark", () => {
    for (const v of [undefined, null, "", "active", "已完成", " 進行中", "進行中 ", 1, true, {}, ["進行中"], "<script>"]) {
      expect(sanitizeCaseTaskState(v)).toBeNull()
    }
  })
})

describe("isActiveCase（首頁「N 進行中」）", () => {
  it("counts active cases, with or without a status written", () => {
    expect(isActiveCase("active", null)).toBe(true)
    expect(isActiveCase(null, undefined)).toBe(true)
    expect(isActiveCase(undefined, "進行中")).toBe(true)
  })
  it("excludes cases the task system marks as closed", () => {
    expect(isActiveCase("active", "已結案")).toBe(false)
    expect(isActiveCase(null, "已結案")).toBe(false)
  })
  it("keeps the old rule for non-active status regardless of the mark", () => {
    expect(isActiveCase("closed", null)).toBe(false)
    expect(isActiveCase("closed", "進行中")).toBe(false)
  })
  it("ignores unknown marks (external input) instead of excluding on them", () => {
    for (const v of ["亂寫", "已完成", " 已結案", "已結案 ", 1, {}, ["已結案"]]) expect(isActiveCase("active", v)).toBe(true)
  })
})
