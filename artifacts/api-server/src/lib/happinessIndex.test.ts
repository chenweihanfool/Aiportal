import { describe, expect, it } from "vitest";
import {
  HAPPINESS_CONFIG,
  computeDisplayedScore,
  computeHappinessComponents,
  getHappinessConfigVersion,
  roundHalfUp,
  type HappinessConfig,
} from "./happinessIndex";

// HHI v2 weights (2026-08-21): lifeFreedom .27 / fitness .18 / calm .15 /
// mind .15 / travel .12 / social .13 (sum 1.00). Every worked example below
// is hand-computed against these exact weights — see happinessIndex.ts's
// own changelog comment for why they changed from v1's 31/20/17/17/15.

describe("computeHappinessComponents", () => {
  it("matches a worked example with all six dimensions present: 79/32/100(calm=0)/90/70/60", () => {
    // calmScore = clamp(100-100,0,100) = 0
    // baseScore = 0.27*79 + 0.18*32 + 0.15*0 + 0.15*90 + 0.12*70 + 0.13*60
    //           = 21.33 + 5.76 + 0 + 13.5 + 8.4 + 7.8 = 56.79
    // weakestScore = min(79,32,0,90,70,60) = 0 (calm)
    // finalRaw = 0.85*56.79 + 0.15*0 = 48.2715
    // finalScore = roundHalfUp(48.2715) = 48
    const result = computeHappinessComponents({
      lifeFreedomScore: 79,
      fitnessHabitScore: 32,
      busynessScore: 100,
      mindScore: 90,
      travelScore: 70,
      socialScore: 60,
    });
    expect(result.components.calmScore).toBe(0);
    expect(result.components.availableComponents).toEqual([
      "lifeFreedom",
      "fitness",
      "calm",
      "mind",
      "travel",
      "social",
    ]);
    expect(result.baseScore).toBeCloseTo(56.79, 10);
    expect(result.finalRaw).toBeCloseTo(48.2715, 10);
    expect(result.finalScore).toBe(48);
    expect(result.weakestComponent).toBe("生活從容");
  });

  it("mind and travel absent -> renormalizes over the remaining four (lifeFreedom/fitness/calm/social, weights sum .73)", () => {
    // baseScore = (0.27*79 + 0.18*32 + 0.15*0 + 0.13*60) / 0.73
    //           = (21.33+5.76+0+7.8) / 0.73 = 34.89 / 0.73 = 47.79452054794521
    // weakestScore = min(79,32,0,60) = 0 (calm)
    // finalRaw = 0.85*47.79452054794521 = 40.62534246575343
    // finalScore = roundHalfUp(40.62534246575343) = 41
    const result = computeHappinessComponents({
      lifeFreedomScore: 79,
      fitnessHabitScore: 32,
      busynessScore: 100,
      mindScore: null,
      travelScore: null,
      socialScore: 60,
    });
    expect(result.components.availableComponents).toEqual(["lifeFreedom", "fitness", "calm", "social"]);
    expect(result.baseScore).toBeCloseTo(47.79452054794521, 10);
    expect(result.finalRaw).toBeCloseTo(40.62534246575343, 10);
    expect(result.finalScore).toBe(41);
    expect(result.weakestComponent).toBe("生活從容");
  });

  it("social missing (e.g. zero observed days in the last 7) -> 13% weight renormalizes across the other five", () => {
    // remaining weights: .27+.18+.15+.15+.12 = 0.87
    // baseScore = (0.27*79 + 0.18*32 + 0.15*0 + 0.15*90 + 0.12*70) / 0.87
    //           = (21.33+5.76+0+13.5+8.4) / 0.87 = 48.99 / 0.87 = 56.31034482758621
    // weakestScore = min(79,32,0,90,70) = 0 (calm)
    // finalRaw = 0.85*56.31034482758621 = 47.863793103448276
    // finalScore = roundHalfUp(47.863793103448276) = 48
    const result = computeHappinessComponents({
      lifeFreedomScore: 79,
      fitnessHabitScore: 32,
      busynessScore: 100,
      mindScore: 90,
      travelScore: 70,
      socialScore: null,
    });
    expect(result.components.socialScore).toBeNull();
    expect(result.components.availableComponents).toEqual(["lifeFreedom", "fitness", "calm", "mind", "travel"]);
    expect(result.baseScore).toBeCloseTo(56.31034482758621, 10);
    expect(result.finalRaw).toBeCloseTo(47.863793103448276, 10);
    expect(result.finalScore).toBe(48);
  });

  it("social can itself be the weakest link, dragging finalRaw down via the 15% correction", () => {
    // all six present, social is deliberately the lowest.
    // baseScore = 80*(.27+.18+.15+.15+.12) + 10*.13 = 80*0.87 + 1.3 = 69.6+1.3 = 70.9
    // finalRaw = 0.85*70.9 + 0.15*10 = 60.265 + 1.5 = 61.765
    // finalScore = roundHalfUp(61.765) = 62
    const result = computeHappinessComponents({
      lifeFreedomScore: 80,
      fitnessHabitScore: 80,
      busynessScore: 20, // calmScore = 80
      mindScore: 80,
      travelScore: 80,
      socialScore: 10,
    });
    expect(result.weakestComponent).toBe("社交指標");
    expect(result.weakestScore).toBe(10);
    expect(result.baseScore).toBeCloseTo(70.9, 10);
    expect(result.finalRaw).toBeCloseTo(61.765, 10);
    expect(result.finalScore).toBe(62);
  });

  it("mind can itself be the weakest link", () => {
    // baseScore = 80*(.27+.18+.15+.12+.13) + 10*.15 = 80*0.85 + 1.5 = 68+1.5 = 69.5
    // finalRaw = 0.85*69.5 + 0.15*10 = 59.075+1.5 = 60.575 -> roundHalfUp = 61
    const result = computeHappinessComponents({
      lifeFreedomScore: 80,
      fitnessHabitScore: 80,
      busynessScore: 20, // calmScore = 80
      mindScore: 10,
      travelScore: 80,
      socialScore: 80,
    });
    expect(result.weakestComponent).toBe("心智指標");
    expect(result.weakestScore).toBe(10);
    expect(result.finalScore).toBe(61);
  });

  it("travel can itself be the weakest link", () => {
    // baseScore = 80*(.27+.18+.15+.15+.13) + 5*.12 = 80*0.88 + 0.6 = 70.4+0.6 = 71.0
    // finalRaw = 0.85*71.0 + 0.15*5 = 60.35+0.75 = 61.10 -> roundHalfUp = 61
    const result = computeHappinessComponents({
      lifeFreedomScore: 80,
      fitnessHabitScore: 80,
      busynessScore: 20, // calmScore = 80
      mindScore: 80,
      travelScore: 5,
      socialScore: 80,
    });
    expect(result.weakestComponent).toBe("旅遊生活");
    expect(result.weakestScore).toBe(5);
    expect(result.finalScore).toBe(61);
  });

  it("busyness of 0 inverts to calmScore of exactly 100", () => {
    const result = computeHappinessComponents({
      lifeFreedomScore: 50,
      fitnessHabitScore: 50,
      busynessScore: 0,
      mindScore: null,
      travelScore: null,
      socialScore: null,
    });
    expect(result.components.calmScore).toBe(100);
  });

  it("renormalizes weights when only two of six dimensions are available", () => {
    // Deliberately unequal values so the test actually distinguishes correct
    // weight-renormalization from bugs like "just average the available
    // ones equally" or "keep the original weights without renormalizing".
    // lifeFreedomScore=90 (weight .27), busynessScore=40 -> calmScore=60 (weight .15).
    // fitness, mind, travel, social all missing -> remaining weights 0.27+0.15=0.42.
    // baseScore = (0.27*90 + 0.15*60) / 0.42 = (24.3+9) / 0.42 = 33.3/0.42 = 79.28571428571429
    // (an equal-weight average of the two would wrongly give (90+60)/2=75;
    // keeping the un-renormalized weights would wrongly give 24.3+9=33.3)
    const result = computeHappinessComponents({
      lifeFreedomScore: 90,
      fitnessHabitScore: null,
      busynessScore: 40,
      mindScore: null,
      travelScore: null,
      socialScore: null,
    });
    expect(result.components.availableComponents).toEqual(["lifeFreedom", "calm"]);
    expect(result.baseScore).toBeCloseTo(79.28571428571429, 10);
  });

  it("returns null (not a fake 0) when all six dimensions are missing", () => {
    const result = computeHappinessComponents({
      lifeFreedomScore: null,
      fitnessHabitScore: null,
      busynessScore: null,
      mindScore: null,
      travelScore: null,
      socialScore: null,
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
      socialScore: null,
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
    // 0.7*45+0.3*50=31.5+15=46.5.
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
      lifeFreedomWeight: 0.5,
      fitnessWeight: 0.25,
    });
    expect(changed).not.toBe(baseline);
  });

  it("is unchanged when nothing changes (fresh object, same values)", () => {
    const identical = getHappinessConfigVersion({ ...HAPPINESS_CONFIG });
    expect(identical).toBe(getHappinessConfigVersion());
  });

  it("HHI v2's six-dimension config hashes differently than the pre-v2 five-dimension config did", () => {
    // Reconstructs the exact pre-v2 (2026-08-20) config object -- no
    // socialWeight key at all, old weight values -- to directly demonstrate
    // that today's baseline config produces a different configVersion than
    // what shipped before this upgrade, so old happiness_index_history rows
    // stay distinguishable from rows produced by the new formula.
    const preV2Config = {
      lifeFreedomWeight: 0.31,
      fitnessWeight: 0.2,
      calmWeight: 0.17,
      mindWeight: 0.17,
      travelWeight: 0.15,
      weakestLinkWeight: 0.15,
      smoothingTodayWeight: 0.7,
      smoothingYesterdayWeight: 0.3,
    } as unknown as HappinessConfig;
    expect(getHappinessConfigVersion(preV2Config)).not.toBe(getHappinessConfigVersion());
  });
});
