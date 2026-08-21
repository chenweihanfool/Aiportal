import { describe, expect, it } from "vitest";
import { computeTravelScore, scoreFromDaysSince } from "./adventureLog";

describe("scoreFromDaysSince (recency, unchanged from v1)", () => {
  it("caps at 100 within 3 days", () => {
    expect(scoreFromDaysSince(0)).toBe(100);
    expect(scoreFromDaysSince(3)).toBe(100);
  });

  it("declines linearly past 3 days, floors at 0 around 93 days", () => {
    expect(scoreFromDaysSince(48)).toBe(50); // (48-3)*100/90 = 50 -> 100-50=50
    expect(scoreFromDaysSince(93)).toBe(0);
    expect(scoreFromDaysSince(200)).toBe(0);
  });
});

describe("computeTravelScore", () => {
  it("recency-only regression case: no trip-day frequency, no upcoming trip", () => {
    // Old v1 behavior (pre-frequency/anticipation): travelScore was purely
    // scoreFromDaysSince. With frequencyScore=0 (no trip days in window) and
    // no anticipation bonus, travelScore = round(0.5*100+0.5*0) = 50 for a
    // trip 3 days ago -- confirms recency alone no longer determines the
    // score 1:1 the way v1 did, which is the intended v2 behavior change.
    const result = computeTravelScore({ daysSinceLastTrip: 3, tripDaysLast180: 0, hasUpcomingTrip: false });
    expect(result.recencyScore).toBe(100);
    expect(result.frequencyScore).toBe(0);
    expect(result.anticipationBonus).toBe(0);
    expect(result.travelScore).toBe(50);
  });

  it("frequency score caps at 100 once trip-days-in-180 reach the 20-day target", () => {
    const atTarget = computeTravelScore({ daysSinceLastTrip: 3, tripDaysLast180: 20, hasUpcomingTrip: false });
    expect(atTarget.frequencyScore).toBe(100);
    const overTarget = computeTravelScore({ daysSinceLastTrip: 3, tripDaysLast180: 40, hasUpcomingTrip: false });
    expect(overTarget.frequencyScore).toBe(100);
  });

  it("frequency score scales linearly below the target (10/20*100=50)", () => {
    const result = computeTravelScore({ daysSinceLastTrip: 3, tripDaysLast180: 10, hasUpcomingTrip: false });
    expect(result.frequencyScore).toBe(50);
  });

  it("anticipation bonus adds +5 when a future trip exists, toggle ON (default)", () => {
    const withUpcoming = computeTravelScore({ daysSinceLastTrip: 3, tripDaysLast180: 20, hasUpcomingTrip: true });
    expect(withUpcoming.anticipationBonus).toBe(5);
    // recency=100, frequency=100 -> round(0.5*100+0.5*100)=100, +5 clamped to 100
    expect(withUpcoming.travelScore).toBe(100);

    const withoutUpcoming = computeTravelScore({ daysSinceLastTrip: 3, tripDaysLast180: 20, hasUpcomingTrip: false });
    expect(withoutUpcoming.anticipationBonus).toBe(0);
    expect(withoutUpcoming.travelScore).toBe(100);
  });

  it("anticipation bonus is visible even when it doesn't get clamped away", () => {
    // recency=100 (0 days), frequency=0 -> round(0.5*100+0.5*0)=50, +5 anticipation = 55
    const result = computeTravelScore({ daysSinceLastTrip: 0, tripDaysLast180: 0, hasUpcomingTrip: true });
    expect(result.travelScore).toBe(55);
  });

  it("rounding order: blend is rounded first, bonus added after, then clamped", () => {
    // recency=50 (48 days), frequency=50 (10 trip-days) -> blend = 0.5*50+0.5*50 = 50 exactly, +5 = 55
    const result = computeTravelScore({ daysSinceLastTrip: 48, tripDaysLast180: 10, hasUpcomingTrip: true });
    expect(result.travelScore).toBe(55);
  });

  it("worked example combining all pieces", () => {
    // recency: 20 days since last trip -> 100-(20-3)*100/90 = 100-18.888..=81.11 -> round=81
    // frequency: 15/20*100 = 75
    // blend: round(0.5*81+0.5*75) = round(78) = 78, no anticipation bonus
    const result = computeTravelScore({ daysSinceLastTrip: 20, tripDaysLast180: 15, hasUpcomingTrip: false });
    expect(result.recencyScore).toBe(81);
    expect(result.frequencyScore).toBe(75);
    expect(result.travelScore).toBe(78);
  });
});
