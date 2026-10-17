import { describe, expect, it } from "vitest"
import { sanitizeCaseTaskState } from "./caseTaskState"

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
