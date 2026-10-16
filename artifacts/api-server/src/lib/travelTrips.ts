// 旅遊生活：由知識庫的遊記（hermes_trips_snapshot）與美食地圖（hermes_places_snapshot）計分
// （2026-10-16 起唯一來源；原本的 AdventureLog 來源已移除）。
// 計分數學與 travelScore.ts 共用 recency／frequency／期待加分，另加「美食」一項：
// 近 90 天吃過（visitedAt 或 days 落在窗內）的美食地點數，6 間 = 100。
import type { HermesTrip, HermesPlace } from "@workspace/db";
import { clamp, roundHalfUp } from "./happinessIndex";
import { computeTravelScore, type TravelIndexData } from "./travelScore";
import { taipeiToday } from "./hermesTrips";

const DAY_MS = 24 * 60 * 60 * 1000;
const FREQUENCY_WINDOW_DAYS = 180;
const FOOD_WINDOW_DAYS = 90;
const FOOD_TARGET_VISITS = 6; // 窗內吃過這麼多間 = 美食分 100
const FOOD_WEIGHT = 0.2; // 遊記 recency／frequency 各 0.4，美食 0.2；沒有美食資料時回到各 0.5

export interface TripsTravelData extends TravelIndexData {
  foodScore: number | null;
  foodVisitsLast90: number | null;
}

function dayNumber(date: string): number {
  return Math.floor(Date.parse(`${date}T00:00:00Z`) / DAY_MS);
}

/** 近 FOOD_WINDOW_DAYS 天吃過的美食地點數（kind=food、status=visited/favorite；日期取 visitedAt，沒有就取 days 最後一天） */
export function countFoodVisits(places: HermesPlace[], today: string): number {
  const t = dayNumber(today);
  return places.filter((p) => {
    if (p.kind !== "food" || (p.status !== "visited" && p.status !== "favorite")) return false;
    const when = p.visitedAt ?? (p.days.length > 0 ? [...p.days].sort().at(-1)! : null);
    if (!when) return false;
    const age = t - dayNumber(when);
    return age >= 0 && age < FOOD_WINDOW_DAYS;
  }).length;
}

/** 純計算：遊記＋美食 → 旅遊指數（places 為 null＝沒有美食資料，美食項不計） */
export function computeTripsTravelIndex(trips: HermesTrip[], places: HermesPlace[] | null, today: string): TripsTravelData {
  const t = dayNumber(today);
  const started = trips.filter((x) => x.start <= today);
  const hasUpcomingTrip = trips.some((x) => x.start > today);
  const anticipationBonus = computeTravelScore({ daysSinceLastTrip: 0, tripDaysLast180: 0, hasUpcomingTrip }).anticipationBonus;
  const foodVisits = places ? countFoodVisits(places, today) : null;
  const foodScore = foodVisits === null ? null : Math.min(100, roundHalfUp((foodVisits / FOOD_TARGET_VISITS) * 100));
  if (started.length === 0) {
    return { travelScore: null, daysSinceLastTrip: null, lastTripEndDate: null, recencyScore: null, frequencyScore: null, tripDaysLast180: null, anticipationBonus, hasUpcomingTrip, foodScore, foodVisitsLast90: foodVisits };
  }
  // 進行中的行程（start ≤ 今天 ≤ end）距上次旅行 = 0 天
  const lastEnd = started.map((x) => (x.end > today ? today : x.end)).sort().at(-1)!;
  const daysSinceLastTrip = Math.max(0, t - dayNumber(lastEnd));
  const windowStart = t - FREQUENCY_WINDOW_DAYS + 1;
  const tripDaysLast180 = started.reduce((sum, x) => {
    const from = Math.max(dayNumber(x.start), windowStart);
    const to = Math.min(dayNumber(x.end), t);
    return sum + Math.max(0, to - from + 1);
  }, 0);
  const base = computeTravelScore({ daysSinceLastTrip, tripDaysLast180, hasUpcomingTrip });
  const mixed =
    foodScore === null
      ? 0.5 * base.recencyScore + 0.5 * base.frequencyScore
      : (1 - FOOD_WEIGHT) / 2 * base.recencyScore + (1 - FOOD_WEIGHT) / 2 * base.frequencyScore + FOOD_WEIGHT * foodScore;
  const travelScore = clamp(roundHalfUp(mixed) + base.anticipationBonus, 0, 100);
  return {
    travelScore,
    daysSinceLastTrip,
    lastTripEndDate: lastEnd,
    recencyScore: base.recencyScore,
    frequencyScore: base.frequencyScore,
    tripDaysLast180,
    anticipationBonus: base.anticipationBonus,
    hasUpcomingTrip,
    foodScore,
    foodVisitsLast90: foodVisits,
  };
}

export async function fetchTravelIndexFromTrips(): Promise<TripsTravelData> {
  // 動態載入：純計算函式的單元測試不需要資料庫連線
  const { db, hermesTripsSnapshotTable, hermesPlacesSnapshotTable } = await import("@workspace/db");
  const { eq } = await import("drizzle-orm");
  const [tripsRow] = await db.select().from(hermesTripsSnapshotTable).where(eq(hermesTripsSnapshotTable.id, "latest")).limit(1);
  if (!tripsRow) throw new Error("遊記尚未同步（hermes_trips_snapshot 沒有資料）");
  const [placesRow] = await db.select().from(hermesPlacesSnapshotTable).where(eq(hermesPlacesSnapshotTable.id, "latest")).limit(1);
  return computeTripsTravelIndex(tripsRow.trips, placesRow?.places ?? null, taipeiToday(new Date()));
}
