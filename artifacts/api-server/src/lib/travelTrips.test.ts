import { describe, expect, it } from "vitest";
import type { HermesPlace, HermesTrip } from "@workspace/db";
import { computeTripsTravelIndex, countFoodVisits } from "./travelTrips";

const trip = (start: string, end: string): HermesTrip =>
  ({ id: start, name: "t", start, end, status: "done", area: null, summary: null, cover: null, placeIds: [], days: [] }) as HermesTrip;
const food = (visitedAt: string | null, status: HermesPlace["status"] = "visited", kind: HermesPlace["kind"] = "food", days: string[] = []): HermesPlace =>
  ({ id: "F", name: "x", kind, status, visitedAt, days }) as unknown as HermesPlace;
const TODAY = "2026-10-15";

describe("countFoodVisits", () => {
  it("只算窗內、吃過的美食", () => {
    const places = [food("2026-10-10"), food("2026-10-01", "favorite"), food("2026-05-01"), food("2026-10-10", "want"), food("2026-10-10", "visited", "sight"), food(null, "visited", "food", ["2026-09-20", "2026-10-02"])];
    expect(countFoodVisits(places, TODAY)).toBe(3);
  });
});

describe("computeTripsTravelIndex", () => {
  it("沒有已開始的行程 → 分數 null，期待加分仍回傳", () => {
    const r = computeTripsTravelIndex([trip("2026-11-01", "2026-11-03")], null, TODAY);
    expect(r.travelScore).toBeNull();
    expect(r.hasUpcomingTrip).toBe(true);
    expect(r.anticipationBonus).toBe(5);
  });
  it("沒有美食資料：recency／frequency 各 0.5", () => {
    // 結束於 3 天前（recency 100）；窗內 3 天（frequency 15）→ round(57.5)=58
    const r = computeTripsTravelIndex([trip("2026-10-10", "2026-10-12")], null, TODAY);
    expect(r.daysSinceLastTrip).toBe(3);
    expect(r.tripDaysLast180).toBe(3);
    expect(r.travelScore).toBe(58);
    expect(r.foodScore).toBeNull();
  });
  it("有美食：0.4／0.4／0.2，並加期待加分", () => {
    const places = Array.from({ length: 6 }, () => food("2026-10-12"));
    const r = computeTripsTravelIndex([trip("2026-10-10", "2026-10-12"), trip("2026-12-01", "2026-12-03")], places, TODAY);
    expect(r.foodScore).toBe(100);
    // 0.4*100 + 0.4*15 + 0.2*100 = 66 → +5
    expect(r.travelScore).toBe(71);
  });
  it("進行中的行程＝距上次 0 天；跨出窗口的天數只算窗內", () => {
    const r = computeTripsTravelIndex([trip("2026-10-14", "2026-10-20"), trip("2026-04-10", "2026-04-25")], [], TODAY);
    expect(r.daysSinceLastTrip).toBe(0);
    expect(r.tripDaysLast180).toBe(2 + 7); // 10/14–15 兩天；4/10–25 只算窗內 4/19–25 七天
  });
});
