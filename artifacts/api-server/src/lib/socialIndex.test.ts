import { describe, expect, it } from "vitest";
import { computeSocialIndex } from "./socialIndex";

describe("computeSocialIndex", () => {
  it("returns all-null (資料準備中) when there are zero observed days", () => {
    const result = computeSocialIndex({
      observedDayCount: 0,
      distinctPersonCount: 3,
      weightedInteractionPoints: 10,
      daysWithInteraction: 2,
    });
    expect(result).toEqual({
      breadthScore: null,
      intensityScore: null,
      connectionRateScore: null,
      socialScore: null,
    });
  });

  it("observedDayCount >= 1 but zero interactions -> socialScore is a real 0, not missing", () => {
    const result = computeSocialIndex({
      observedDayCount: 5,
      distinctPersonCount: 0,
      weightedInteractionPoints: 0,
      daysWithInteraction: 0,
    });
    expect(result.breadthScore).toBe(0);
    expect(result.intensityScore).toBe(0);
    expect(result.connectionRateScore).toBe(0);
    expect(result.socialScore).toBe(0);
  });

  it("breadth caps at 5 distinct people (5*20=100), doesn't keep climbing past that", () => {
    const result = computeSocialIndex({
      observedDayCount: 7,
      distinctPersonCount: 8, // more than 5
      weightedInteractionPoints: 0,
      daysWithInteraction: 0,
    });
    expect(result.breadthScore).toBe(100);
  });

  it("breadth below the cap scales linearly at 20 points per person", () => {
    const result = computeSocialIndex({
      observedDayCount: 7,
      distinctPersonCount: 3,
      weightedInteractionPoints: 0,
      daysWithInteraction: 0,
    });
    expect(result.breadthScore).toBe(60);
  });

  it("intensity weighting: face_to_face=3/call=2/text=1 points, target 15 points = 100", () => {
    // e.g. 3 face_to_face (9) + 2 call (4) + 2 text (2) = 15 points exactly
    const result = computeSocialIndex({
      observedDayCount: 7,
      distinctPersonCount: 0,
      weightedInteractionPoints: 15,
      daysWithInteraction: 0,
    });
    expect(result.intensityScore).toBe(100);
  });

  it("intensity caps at 100 even when weighted points exceed the 15-point target", () => {
    const result = computeSocialIndex({
      observedDayCount: 7,
      distinctPersonCount: 0,
      weightedInteractionPoints: 30, // double the target
      daysWithInteraction: 0,
    });
    expect(result.intensityScore).toBe(100);
  });

  it("intensity below the target rounds half-up (e.g. 5/15*100 = 33.33 -> 33)", () => {
    const result = computeSocialIndex({
      observedDayCount: 7,
      distinctPersonCount: 0,
      weightedInteractionPoints: 5,
      daysWithInteraction: 0,
    });
    expect(result.intensityScore).toBe(33);
  });

  it("connection rate = days-with-interaction / observed-days, not / 7", () => {
    // Only 3 of the 7-day window were actually observed (diary written),
    // and 2 of those 3 had an interaction -> 2/3 = 66.67 -> 67, NOT 2/7.
    const result = computeSocialIndex({
      observedDayCount: 3,
      distinctPersonCount: 1,
      weightedInteractionPoints: 3,
      daysWithInteraction: 2,
    });
    expect(result.connectionRateScore).toBe(67);
  });

  it("matches a worked example combining all three sub-scores: 0.40/0.40/0.20 weights", () => {
    // breadth: 4 people * 20 = 80
    // intensity: 12/15*100 = 80
    // connectionRate: 5/7*100 = 71.43 -> 71
    // socialScore = round(0.40*80 + 0.40*80 + 0.20*71) = round(32+32+14.2) = round(78.2) = 78
    const result = computeSocialIndex({
      observedDayCount: 7,
      distinctPersonCount: 4,
      weightedInteractionPoints: 12,
      daysWithInteraction: 5,
    });
    expect(result.breadthScore).toBe(80);
    expect(result.intensityScore).toBe(80);
    expect(result.connectionRateScore).toBe(71);
    expect(result.socialScore).toBe(78);
  });
});
