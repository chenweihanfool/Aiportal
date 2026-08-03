import { describe, expect, it } from "vitest";
import {
  HAPPINESS_CONFIG,
  computeDisplayedScore,
  computeHappinessComponents,
  getHappinessConfigVersion,
  roundHalfUp,
} from "./happinessIndex";

describe("computeHappinessComponents", () => {
  it("matches the spec's worked example: 79 / 32 / 100", () => {
    // calmScore = clamp(100-100,0,100) = 0
    // baseScore = 0.45*79 + 0.30*32 + 0.25*0 = 35.55+9.6+0 = 45.15
    // weakestScore = min(79,32,0) = 0 (calm)
    // finalRaw = 0.85*45.15 + 0.15*0 = 38.3775
    // finalScore = roundHalfUp(38.3775) = 38
    const result = computeHappinessComponents({
      lifeFreedomScore: 79,
      fitnessHabitScore: 32,
      busynessScore: 100,
    });
    expect(result.components.calmScore).toBe(0);
    expect(result.baseScore).toBeCloseTo(45.15, 10);
    expect(result.finalRaw).toBeCloseTo(38.3775, 10);
    expect(result.finalScore).toBe(38);
    expect(result.weakestComponent).toBe("生活從容");
  });

  it("busyness of 0 inverts to calmScore of exactly 100", () => {
    const result = computeHappinessComponents({
      lifeFreedomScore: 50,
      fitnessHabitScore: 50,
      busynessScore: 0,
    });
    expect(result.components.calmScore).toBe(100);
  });

  it("renormalizes weights when one dimension is missing", () => {
    // Deliberately unequal values so the test actually distinguishes correct
    // weight-renormalization from bugs like "just average the available
    // ones equally" or "keep the original weights without renormalizing".
    // lifeFreedomScore=90 (weight .45), busynessScore=40 -> calmScore=60 (weight .25).
    // fitness missing -> remaining weights 0.45+0.25=0.70.
    // baseScore = (0.45*90 + 0.25*60) / 0.70 = (40.5+15) / 0.70 = 79.285714...
    // (an equal-weight average of the two would wrongly give (90+60)/2=75;
    // keeping the un-renormalized weights would wrongly give 40.5+15=55.5)
    const result = computeHappinessComponents({
      lifeFreedomScore: 90,
      fitnessHabitScore: null,
      busynessScore: 40,
    });
    expect(result.components.availableComponents).toEqual(["lifeFreedom", "calm"]);
    expect(result.baseScore).toBeCloseTo(79.28571428571429, 10);
  });

  it("returns null (not a fake 0) when all three dimensions are missing", () => {
    const result = computeHappinessComponents({
      lifeFreedomScore: null,
      fitnessHabitScore: null,
      busynessScore: null,
    });
    expect(result.finalScore).toBeNull();
    expect(result.baseScore).toBeNull();
    expect(result.weakestScore).toBeNull();
    expect(result.weakestComponent).toBeNull();
    expect(result.components.availableComponents).toEqual([]);
  });

  it("single available dimension: weakest-link correction is a no-op", () => {
    const result = computeHappinessComponents({
      lifeFreedomScore: 72,
      fitnessHabitScore: null,
      busynessScore: null,
    });
    expect(result.baseScore).toBe(72);
    expect(result.weakestScore).toBe(72);
    // finalRaw = 0.85*72 + 0.15*72 = 72 exactly, since base === weakest
    expect(result.finalRaw).toBeCloseTo(72, 10);
    expect(result.finalScore).toBe(72);
  });

  it("round-half-up at the .5 boundary", () => {
    // Pins the rounding rule explicitly per spec, rather than relying on
    // Math.round's (correct, but implicit and easy to "fix" incorrectly
    // later) half-up behavior for non-negative numbers.
    expect(roundHalfUp(52.5)).toBe(53);
    expect(roundHalfUp(0.5)).toBe(1);
    expect(roundHalfUp(37.5)).toBe(38);
    expect(roundHalfUp(37.49999)).toBe(37);
  });
});

describe("computeDisplayedScore", () => {
  it("matches the spec's worked example: today 40, yesterday displayed 60 -> 46", () => {
    expect(computeDisplayedScore(40, 60)).toBe(46);
  });

  it("falls back to finalScore verbatim when there's no yesterday row", () => {
    expect(computeDisplayedScore(72, null)).toBe(72);
  });

  it("rounds a smoothing result that lands on a .5 boundary half-up", () => {
    // 0.7*41 + 0.3*40 = 28.7 + 12 = 40.7 -- not a boundary case; construct one:
    // 0.7*x + 0.3*y = N.5 for integer x,y. 0.7*45+0.3*50=31.5+15=46.5.
    expect(computeDisplayedScore(45, 50)).toBe(47); // roundHalfUp(46.5) = 47
  });
});

describe("getHappinessConfigVersion", () => {
  it("is stable across calls with the same config", () => {
    expect(getHappinessConfigVersion()).toBe(getHappinessConfigVersion());
  });

  it("changes when any weight changes", () => {
    const baseline = getHappinessConfigVersion();
    const changed = getHappinessConfigVersion({
      ...HAPPINESS_CONFIG,
      lifeFreedomWeight: 0.50,
      fitnessWeight: 0.25,
    });
    expect(changed).not.toBe(baseline);
  });

  it("is unchanged when nothing changes (fresh object, same values)", () => {
    const identical = getHappinessConfigVersion({ ...HAPPINESS_CONFIG });
    expect(identical).toBe(getHappinessConfigVersion());
  });
});
