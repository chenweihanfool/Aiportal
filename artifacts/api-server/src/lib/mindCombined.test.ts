import { describe, expect, it } from "vitest";
import { combineMind } from "./mindCombined";

describe("combineMind", () => {
  it("weights ideas 80% and the daily report 20%", () => {
    expect(combineMind(100, 65)).toBe(93);
    expect(combineMind(62.4, 40)).toBe(57.9);
  });
  it("falls back to the ideas score when there is no report score", () => {
    expect(combineMind(88.25, null)).toBe(88.3);
  });
  it("is null without an ideas score (ideas is the main component)", () => {
    expect(combineMind(null, 70)).toBeNull();
    expect(combineMind(Number.NaN, 70)).toBeNull();
  });
});
