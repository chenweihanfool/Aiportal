import { describe, expect, it } from "vitest";
import {
  HAPPINESS_CONFIG,
  computeDisplayedScore,
  computeHappinessComponents,
  getHappinessConfigVersion,
  roundHalfUp,
} from "./happinessIndex";

describe("computeHappinessComponents", () => {
  it("matches the spec's worked example: 79 / 32 / 100 (mind absent)", () => {
    // mind absent -> renormalize over the remaining three. Their weights
    // (.36/.24/.20) were scaled down proportionally from the pre-mind
    // 45/30/25 split specifically so this renormalizes back to the exact
    // same 45/30/25 ratio -- this test also pins that property.
    // calmScore = clamp(100-100,0,100) = 0
    // baseScore = 0.45*79 + 0.30*32 + 0.25*0 = 35.55+9.6+0 = 45.15
    // weakestScore = min(79,32,0) = 0 (calm)
    // finalRaw = 0.85*45.15 + 0.15*0 = 38.3775
    // finalScore = roundHalfUp(38.3775) = 38
    const result = computeHappinessComponents({
      lifeFreedomScore: 79,
      fitnessHabitScore: 32,
      busynessScore: 100,
      mindScore: null,
    });
    expect(result.components.calmScore).toBe(0);
    expect(result.baseScore).toBeCloseTo(45.15, 10);
    expect(result.finalRaw).toBeCloseTo(38.3775, 10);
    expect(result.finalScore).toBe(38);
    expect(result.weakestComponent).toBe("生活從容");
  });

  it("matches a worked example with all four dimensions present: 79 / 32 / 100 / 90", () => {
    // calmScore = 0 (as above). mindScore = 90 directly (already 0-100, higher better).
    // baseScore = 0.36*79 + 0.24*32 + 0.20*0 + 0.20*90
    //           = 28.44 + 7.68 + 0 + 18 = 54.12
    // weakestScore = min(79,32,0,90) = 0 (calm)
    // finalRaw = 0.85*54.12 + 0.15*0 = 46.002
    // finalScore = roundHalfUp(46.002) = 46
    const result = computeHappinessComponents({
      lifeFreedomScore: 79,
      fitnessHabitScore: 32,
      busynessScore: 100,
      mindScore: 90,
    });
    expect(result.components.mindScore).toBe(90);
    expect(result.baseScore).toBeCloseTo(54.12, 10);
    expect(result.finalRaw).toBeCloseTo(46.002, 10);
    expect(result.finalScore).toBe(46);
    expect(result.weakestComponent).toBe("生活從容");
  });

  it("mind can itself be the weakest link", () => {
    const result = computeHappinessComponents({
      lifeFreedomScore: 80,
      fitnessHabitScore: 80,
      busynessScore: 20, // calmScore = 80
      mindScore: 10,
    });
    expect(result.weakestComponent).toBe("心智指標");
    expect(result.weakestScore).toBe(10);
  });

  it("busyness of 0 inverts to calmScore of exactly 100", () => {
    const result = computeHappinessComponents({
      lifeFreedomScore: 50,
      fitnessHabitScore: 50,
      busynessScore: 0,
      mindScore: null,
    });
    expect(result.components.calmScore).toBe(100);
  });

  it("renormalizes weights when one dimension is missing", () => {
    // Deliberately unequal values so the test actually distinguishes correct
    // weight-renormalization from bugs like "just average the available
    // ones equally" or "keep the original weights without renormalizing".
    // lifeFreedomScore=90 (weight .36), busynessScore=40 -> calmScore=60 (weight .20).
    // fitness and mind missing -> remaining weights 0.36+0.20=0.56.
    // baseScore = (0.36*90 + 0.20*60) / 0.56 = (32.4+12) / 0.56 = 79.285714...
    // (an equal-weight average of the two would wrongly give (90+60)/2=75;
    // keeping the un-renormalized weights would wrongly give 32.4+12=44.4)
    const result = computeHappinessComponents({
      lifeFreedomScore: 90,
      fitnessHabitScore: null,
      busynessScore: 40,
      mindScore: null,
    });
    expect(result.components.availableComponents).toEqual(["lifeFreedom", "calm"]);
    expect(result.baseScore).toBeCloseTo(79.28571428571429, 10);
  });

  it("returns null (not a fake 0) when all four dimensions are missing", () => {
    const result = computeHappinessComponents({
      lifeFreedomScore: null,
      fitnessHabitScore: null,
      busynessScore: null,
      mindScore: null,
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
      mindScore: null,
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
