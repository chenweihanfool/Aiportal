import { describe, expect, it } from "vitest";
import {
  HAPPINESS_CONFIG,
  computeDisplayedScore,
  computeHappinessComponents,
  getHappinessConfigVersion,
  roundHalfUp,
} from "./happinessIndex";

describe("computeHappinessComponents", () => {
  it("matches the spec's worked example: 79 / 32 / 100 (mind and travel absent)", () => {
    // mind and travel absent -> renormalize over the remaining three
    // (weights .31/.20/.17, sum .68). Note this is NOT exactly the original
    // 45/30/25 ratio anymore -- that property held after the first
    // proportional shrink (45/30/25 -> 36/24/20 is an exact *0.8), but the
    // second shrink to fit travel (36/24/20 -> 31/20/17) only holds
    // approximately once each weight gets rounded to a whole percent
    // (36*0.85=30.6->31, 24*0.85=20.4->20), which nudges the ratio slightly.
    // calmScore = clamp(100-100,0,100) = 0
    // baseScore = (0.31*79 + 0.20*32 + 0.17*0) / 0.68 = (24.49+6.4+0) / 0.68 = 45.426470588...
    // weakestScore = min(79,32,0) = 0 (calm)
    // finalRaw = 0.85*45.426470588... + 0.15*0 = 38.6125
    // finalScore = roundHalfUp(38.6125) = 39
    const result = computeHappinessComponents({
      lifeFreedomScore: 79,
      fitnessHabitScore: 32,
      busynessScore: 100,
      mindScore: null,
      travelScore: null,
    });
    expect(result.components.calmScore).toBe(0);
    expect(result.baseScore).toBeCloseTo(45.42647058823529, 10);
    expect(result.finalRaw).toBeCloseTo(38.6125, 10);
    expect(result.finalScore).toBe(39);
    expect(result.weakestComponent).toBe("生活從容");
  });

  it("matches a worked example with four of five dimensions present (travel absent): 79 / 32 / 100 / 90", () => {
    // calmScore = 0 (as above). mindScore = 90 directly (already 0-100, higher better).
    // travel absent -> renormalize over the remaining four (.31/.20/.17/.17, sum .85).
    // baseScore = (0.31*79 + 0.20*32 + 0.17*0 + 0.17*90) / 0.85
    //           = (24.49 + 6.4 + 0 + 15.3) / 0.85 = 46.19 / 0.85 = 54.34117647...
    // weakestScore = min(79,32,0,90) = 0 (calm)
    // finalRaw = 0.85*54.34117647... + 0.15*0 = 46.19
    // finalScore = roundHalfUp(46.19) = 46
    const result = computeHappinessComponents({
      lifeFreedomScore: 79,
      fitnessHabitScore: 32,
      busynessScore: 100,
      mindScore: 90,
      travelScore: null,
    });
    expect(result.components.mindScore).toBe(90);
    expect(result.baseScore).toBeCloseTo(54.34117647058823, 10);
    expect(result.finalRaw).toBeCloseTo(46.19, 10);
    expect(result.finalScore).toBe(46);
    expect(result.weakestComponent).toBe("生活從容");
  });

  it("matches a worked example with all five dimensions present: 79 / 32 / 100 / 90 / 70", () => {
    // calmScore = 0. All five weights (.31/.20/.17/.17/.15) apply directly, no renormalization needed.
    // baseScore = 0.31*79 + 0.20*32 + 0.17*0 + 0.17*90 + 0.15*70
    //           = 24.49 + 6.4 + 0 + 15.3 + 10.5 = 56.69
    // weakestScore = min(79,32,0,90,70) = 0 (calm)
    // finalRaw = 0.85*56.69 + 0.15*0 = 48.1865
    // finalScore = roundHalfUp(48.1865) = 48
    const result = computeHappinessComponents({
      lifeFreedomScore: 79,
      fitnessHabitScore: 32,
      busynessScore: 100,
      mindScore: 90,
      travelScore: 70,
    });
    expect(result.components.travelScore).toBe(70);
    expect(result.components.availableComponents).toEqual(["lifeFreedom", "fitness", "calm", "mind", "travel"]);
    expect(result.baseScore).toBeCloseTo(56.69, 10);
    expect(result.finalRaw).toBeCloseTo(48.1865, 10);
    expect(result.finalScore).toBe(48);
    expect(result.weakestComponent).toBe("生活從容");
  });

  it("mind can itself be the weakest link", () => {
    const result = computeHappinessComponents({
      lifeFreedomScore: 80,
      fitnessHabitScore: 80,
      busynessScore: 20, // calmScore = 80
      mindScore: 10,
      travelScore: null,
    });
    expect(result.weakestComponent).toBe("心智指標");
    expect(result.weakestScore).toBe(10);
  });

  it("travel can itself be the weakest link", () => {
    const result = computeHappinessComponents({
      lifeFreedomScore: 80,
      fitnessHabitScore: 80,
      busynessScore: 20, // calmScore = 80
      mindScore: 80,
      travelScore: 5,
    });
    expect(result.weakestComponent).toBe("旅遊生活");
    expect(result.weakestScore).toBe(5);
  });

  it("busyness of 0 inverts to calmScore of exactly 100", () => {
    const result = computeHappinessComponents({
      lifeFreedomScore: 50,
      fitnessHabitScore: 50,
      busynessScore: 0,
      mindScore: null,
      travelScore: null,
    });
    expect(result.components.calmScore).toBe(100);
  });

  it("renormalizes weights when one dimension is missing", () => {
    // Deliberately unequal values so the test actually distinguishes correct
    // weight-renormalization from bugs like "just average the available
    // ones equally" or "keep the original weights without renormalizing".
    // lifeFreedomScore=90 (weight .31), busynessScore=40 -> calmScore=60 (weight .17).
    // fitness, mind, travel missing -> remaining weights 0.31+0.17=0.48.
    // baseScore = (0.31*90 + 0.17*60) / 0.48 = (27.9+10.2) / 0.48 = 79.375
    // (an equal-weight average of the two would wrongly give (90+60)/2=75;
    // keeping the un-renormalized weights would wrongly give 27.9+10.2=38.1)
    const result = computeHappinessComponents({
      lifeFreedomScore: 90,
      fitnessHabitScore: null,
      busynessScore: 40,
      mindScore: null,
      travelScore: null,
    });
    expect(result.components.availableComponents).toEqual(["lifeFreedom", "calm"]);
    expect(result.baseScore).toBeCloseTo(79.375, 10);
  });

  it("returns null (not a fake 0) when all five dimensions are missing", () => {
    const result = computeHappinessComponents({
      lifeFreedomScore: null,
      fitnessHabitScore: null,
      busynessScore: null,
      mindScore: null,
      travelScore: null,
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
      travelScore: null,
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
