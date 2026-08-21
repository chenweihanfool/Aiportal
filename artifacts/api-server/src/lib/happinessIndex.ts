// 翰翰仔幸福指數 (Hanhan Happiness Index / HHI) — a reflective dashboard-navigation
// metric, not a medical, psychological, or scientific diagnosis. Combines six
// composite indices (人生自由/運動習慣/忙碌→從容/心智指標/社交指標/旅遊生活)
// into one number via a weighted average with a "weakest link" correction and
// day-over-day smoothing.
//
// WARNING — changing any weight below breaks longitudinal comparability
// (today's "62" is no longer comparable to last week's "62" once the
// formula changes). Any change must bump CONFIG_VERSION_OVERRIDE or update
// the changelog with the date/reason; getHappinessConfigVersion() hashes
// every value here so happiness_index_history rows can be tied to the exact
// config that produced them.

import { createHash } from "node:crypto";

export interface HappinessConfig {
  lifeFreedomWeight: number;
  fitnessWeight: number;
  calmWeight: number;
  mindWeight: number;
  travelWeight: number;
  socialWeight: number;
  weakestLinkWeight: number;
  smoothingTodayWeight: number;
  smoothingYesterdayWeight: number;
}

// 2026-08-09: added mindWeight (心智指標). Existing three weights scaled down
// proportionally to make room (45/30/25 -> 36/24/20) rather than picked
// fresh, so their relative balance to each other is unchanged — only "how
// much of the pie" shrank to fit the new dimension.
//
// 2026-08-20: added travelWeight (旅遊生活), same proportional-scaling
// approach (36/24/20/20 -> 31/20/17/17 + 15 for travel). Also swapped what
// mindWeight's input actually measures — it now reads dailyEngagementScore
// (diary + completed tasks that day) instead of HERMES's knowledge-base
// score, which is more "did HERMES's vault stay healthy" than "how is
// 翰翰仔 doing today". The knowledge-base score is still computed and
// displayed (MindIndexCard), just no longer part of this composite.
//
// 2026-08-21 (HHI v2): added socialWeight (社交指標，全被動日記萃取，見
// lib/socialIndex.ts). Weights rebalanced to make room: lifeFreedom
// 31->27, fitness 20->18, calm 17->15, mind 17->15, travel 15->12, social
// new at 13. Also switched mindWeight's input from a single-day count to a
// rolling 3-day sum (still reads dailyEngagementScore, see
// mind_index_history's diaryEntryCount3Day) — a daily reset-to-zero was
// letting the weakest-link correction's effective weight balloon toward
// ~30% on any low-writing day, over-dominating the composite.
export const HAPPINESS_CONFIG: HappinessConfig = {
  lifeFreedomWeight: 0.27,
  fitnessWeight: 0.18,
  calmWeight: 0.15,
  mindWeight: 0.15,
  travelWeight: 0.12,
  socialWeight: 0.13,
  weakestLinkWeight: 0.15,
  smoothingTodayWeight: 0.70,
  smoothingYesterdayWeight: 0.30,
};

if (
  Math.abs(
    HAPPINESS_CONFIG.lifeFreedomWeight +
      HAPPINESS_CONFIG.fitnessWeight +
      HAPPINESS_CONFIG.calmWeight +
      HAPPINESS_CONFIG.mindWeight +
      HAPPINESS_CONFIG.travelWeight +
      HAPPINESS_CONFIG.socialWeight -
      1
  ) > 1e-9
) {
  throw new Error(
    "HAPPINESS_CONFIG base weights (lifeFreedom+fitness+calm+mind+travel+social) must sum to 1.0"
  );
}
if (
  Math.abs(HAPPINESS_CONFIG.smoothingTodayWeight + HAPPINESS_CONFIG.smoothingYesterdayWeight - 1) > 1e-9
) {
  throw new Error("HAPPINESS_CONFIG smoothing weights must sum to 1.0");
}

export function getHappinessConfigVersion(config: HappinessConfig = HAPPINESS_CONFIG): string {
  const serialized = JSON.stringify(config, Object.keys(config).sort());
  return createHash("sha256").update(serialized).digest("hex").slice(0, 12);
}

// JavaScript's Math.round() already rounds half-up for non-negative inputs
// (Math.round(2.5) === 3, unlike Python's banker's-rounded round(2.5) === 2),
// so this would behave identically to Math.round for the 0-100 score range
// used everywhere in this module. Written explicitly anyway per spec, so
// the rounding rule is documented and auditable rather than relying on
// engine-specific Math.round behavior at the boundary.
export function roundHalfUp(x: number): number {
  return Math.floor(x + 0.5);
}

export function clamp(x: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, x));
}

export interface HappinessInputs {
  lifeFreedomScore: number | null;
  fitnessHabitScore: number | null;
  busynessScore: number | null; // lower is better; converted to calmScore below
  mindScore: number | null; // dailyEngagementScore（近 3 天滾動窗口日記篇數），0-100，higher is better
  travelScore: number | null; // AdventureLog recency+頻率+期待加分換算，0-100，higher is better
  socialScore: number | null; // 近 7 天廣度/互動強度/連結率換算，0-100，higher is better
}

interface Dimension {
  key: "lifeFreedom" | "fitness" | "calm" | "mind" | "travel" | "social";
  label: string;
  value: number;
  weight: number;
}

export interface HappinessComponents {
  lifeFreedomScore: number | null;
  fitnessHabitScore: number | null;
  calmScore: number | null; // clamp(100 - busynessScore, 0, 100)
  mindScore: number | null;
  travelScore: number | null;
  socialScore: number | null;
  availableComponents: Array<"lifeFreedom" | "fitness" | "calm" | "mind" | "travel" | "social">;
}

export interface HappinessResult {
  finalScore: number | null; // null when all inputs are missing — "資料準備中", never a fake score
  finalRaw: number | null;
  baseScore: number | null;
  weakestScore: number | null;
  weakestComponent: string | null; // human label, e.g. "生活從容"
  components: HappinessComponents;
}

const DIMENSION_LABELS = {
  lifeFreedom: "人生自由",
  fitness: "健身習慣",
  calm: "生活從容",
  mind: "心智指標",
  travel: "旅遊生活",
  social: "社交指標",
} as const;

/** Pure calculation — no DB/network access, so it's directly unit-testable
 * against the spec's worked examples without mocking anything. */
export function computeHappinessComponents(
  inputs: HappinessInputs,
  config: HappinessConfig = HAPPINESS_CONFIG
): HappinessResult {
  const calmScore = inputs.busynessScore === null ? null : clamp(100 - inputs.busynessScore, 0, 100);

  const allDimensions: Array<{ key: Dimension["key"]; value: number | null; weight: number }> = [
    { key: "lifeFreedom", value: inputs.lifeFreedomScore, weight: config.lifeFreedomWeight },
    { key: "fitness", value: inputs.fitnessHabitScore, weight: config.fitnessWeight },
    { key: "calm", value: calmScore, weight: config.calmWeight },
    { key: "mind", value: inputs.mindScore, weight: config.mindWeight },
    { key: "travel", value: inputs.travelScore, weight: config.travelWeight },
    { key: "social", value: inputs.socialScore, weight: config.socialWeight },
  ];
  const available: Dimension[] = allDimensions
    .filter((d): d is { key: Dimension["key"]; value: number; weight: number } => d.value !== null)
    .map((d) => ({ ...d, label: DIMENSION_LABELS[d.key] }));

  const components: HappinessComponents = {
    lifeFreedomScore: inputs.lifeFreedomScore,
    fitnessHabitScore: inputs.fitnessHabitScore,
    calmScore,
    mindScore: inputs.mindScore,
    travelScore: inputs.travelScore,
    socialScore: inputs.socialScore,
    availableComponents: available.map((d) => d.key),
  };

  if (available.length === 0) {
    return {
      finalScore: null,
      finalRaw: null,
      baseScore: null,
      weakestScore: null,
      weakestComponent: null,
      components,
    };
  }

  const totalWeight = available.reduce((sum, d) => sum + d.weight, 0);
  const baseScore = available.reduce((sum, d) => sum + d.value * d.weight, 0) / totalWeight;

  const weakest = available.reduce((min, d) => (d.value < min.value ? d : min));

  const finalRaw = (1 - config.weakestLinkWeight) * baseScore + config.weakestLinkWeight * weakest.value;
  const finalScore = roundHalfUp(clamp(finalRaw, 0, 100));

  return {
    finalScore,
    finalRaw,
    baseScore,
    weakestScore: weakest.value,
    weakestComponent: weakest.label,
    components,
  };
}

/** displayedScore smooths finalScore against yesterday's *displayed* value
 * (not yesterday's finalScore) — see this module's header comment for why
 * that damps day-to-day noise without needing yesterday's raw inputs. */
export function computeDisplayedScore(
  finalScore: number,
  yesterdayDisplayedScore: number | null,
  config: HappinessConfig = HAPPINESS_CONFIG
): number {
  if (yesterdayDisplayedScore === null) return finalScore;
  return roundHalfUp(
    config.smoothingTodayWeight * finalScore + config.smoothingYesterdayWeight * yesterdayDisplayedScore
  );
}
