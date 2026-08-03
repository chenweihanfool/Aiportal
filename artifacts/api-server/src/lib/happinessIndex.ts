// 翰翰仔幸福指數 (Hanhan Happiness Index / HHI) — a reflective dashboard-navigation
// metric, not a medical, psychological, or scientific diagnosis. Combines the
// three existing composite indices (人生自由/運動習慣/忙碌→從容) into one
// number via a weighted average with a "weakest link" correction and
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
  weakestLinkWeight: number;
  smoothingTodayWeight: number;
  smoothingYesterdayWeight: number;
}

export const HAPPINESS_CONFIG: HappinessConfig = {
  lifeFreedomWeight: 0.45,
  fitnessWeight: 0.30,
  calmWeight: 0.25,
  weakestLinkWeight: 0.15,
  smoothingTodayWeight: 0.70,
  smoothingYesterdayWeight: 0.30,
};

if (
  Math.abs(
    HAPPINESS_CONFIG.lifeFreedomWeight + HAPPINESS_CONFIG.fitnessWeight + HAPPINESS_CONFIG.calmWeight - 1
  ) > 1e-9
) {
  throw new Error("HAPPINESS_CONFIG base weights (lifeFreedom+fitness+calm) must sum to 1.0");
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
}

interface Dimension {
  key: "lifeFreedom" | "fitness" | "calm";
  label: string;
  value: number;
  weight: number;
}

export interface HappinessComponents {
  lifeFreedomScore: number | null;
  fitnessHabitScore: number | null;
  calmScore: number | null; // clamp(100 - busynessScore, 0, 100)
  availableComponents: Array<"lifeFreedom" | "fitness" | "calm">;
}

export interface HappinessResult {
  finalScore: number | null; // null when all three inputs are missing — "資料準備中", never a fake score
  finalRaw: number | null;
  baseScore: number | null;
  weakestScore: number | null;
  weakestComponent: string | null; // human label, e.g. "生活從容"
  components: HappinessComponents;
}

const DIMENSION_LABELS = { lifeFreedom: "人生自由", fitness: "健身習慣", calm: "生活從容" } as const;

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
  ];
  const available: Dimension[] = allDimensions
    .filter((d): d is { key: Dimension["key"]; value: number; weight: number } => d.value !== null)
    .map((d) => ({ ...d, label: DIMENSION_LABELS[d.key] }));

  const components: HappinessComponents = {
    lifeFreedomScore: inputs.lifeFreedomScore,
    fitnessHabitScore: inputs.fitnessHabitScore,
    calmScore,
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
