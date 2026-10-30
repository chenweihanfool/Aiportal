import { describe, expect, it } from "vitest";
import type { HermesPlace, HermesTrip } from "@workspace/db";
import { LIFE_WINDOW_DAYS, lifeDaysOf, type LifeSources } from "./dailyLife";

const TODAY = "2026-10-30";
const src = (over: Partial<LifeSources> = {}): LifeSources => ({ companion: null, places: [], trips: [], workoutDays: null, ...over });
const place = (name: string, over: Partial<HermesPlace> = {}) => ({ name, kind: "food", status: "visited", visitedAt: "2026-10-20", ...over }) as unknown as HermesPlace;
const trip = (over: Partial<HermesTrip> = {}) => ({ name: "花蓮", start: "2026-10-10", end: "2026-10-12", status: "done", ...over }) as unknown as HermesTrip;

describe("lifeDaysOf", () => {
  it("見人：feed companion 的 socialDays；人數 0 或壞列不算", () => {
    const m = lifeDaysOf(src({ companion: { socialDays: [{ date: "2026-10-01", people: 2 }, { date: "2026-10-02", people: 0 }, { date: "10/3", people: 1 }] } }), TODAY);
    expect([...m.keys()]).toEqual(["2026-10-01"]);
    expect(m.get("2026-10-01")?.socialPeople).toBe(2);
  });
  it("新店：吃過的美食才算；想吃、景點、沒有 visitedAt 不算", () => {
    const m = lifeDaysOf(src({ places: [place("甲"), place("乙", { status: "favorite" }), place("丙", { status: "want" }), place("丁", { kind: "sight" }), place("戊", { visitedAt: null })] }), TODAY);
    expect(m.get("2026-10-20")?.newPlaces).toEqual(["甲", "乙"]);
    expect(m.size).toBe(1);
  });
  it("旅行：趟次每一天都算；還在規劃的不算；進行中只算到今天", () => {
    const m = lifeDaysOf(src({ trips: [trip(), trip({ name: "未來", start: "2026-10-01", end: "2026-10-01", status: "planned" }), trip({ name: "進行中", start: "2026-10-29", end: "2026-11-02", status: "ongoing" })] }), TODAY);
    expect([...m.keys()].sort()).toEqual(["2026-10-10", "2026-10-11", "2026-10-12", "2026-10-29", "2026-10-30"]);
    expect(m.get("2026-10-11")?.trip).toBe("花蓮");
  });
  it("運動：FitnessForge 的 workoutDays；格式不對略過", () => {
    const m = lifeDaysOf(src({ workoutDays: [{ date: "2026-10-05", entries: 2, exercises: ["深蹲", "臥推"] }, { date: "2026-10-06", entries: 0, exercises: [] }, "x"] }), TODAY);
    expect(m.get("2026-10-05")?.workouts).toEqual(["深蹲", "臥推"]);
    expect(m.size).toBe(1);
    expect(lifeDaysOf(src({ workoutDays: { bad: true } }), TODAY).size).toBe(0);
  });
  it("未來與視窗外的日子不列", () => {
    const m = lifeDaysOf(src({ workoutDays: [{ date: "2026-10-31", exercises: ["深蹲"] }, { date: "2020-01-01", exercises: ["深蹲"] }] }), TODAY);
    expect(m.size).toBe(0);
    const long = lifeDaysOf(src({ trips: [trip({ start: "2020-01-01", end: "2026-10-30" })] }), TODAY);
    expect(long.size).toBe(LIFE_WINDOW_DAYS + 1);
  });
  it("同一天多項併在一起", () => {
    const m = lifeDaysOf(src({ companion: { socialDays: [{ date: "2026-10-11", people: 1 }] }, places: [place("甲", { visitedAt: "2026-10-11" })], trips: [trip()], workoutDays: [{ date: "2026-10-11", exercises: ["跑步"] }] }), TODAY);
    expect(m.get("2026-10-11")).toEqual({ date: "2026-10-11", socialPeople: 1, newPlaces: ["甲"], trip: "花蓮", workouts: ["跑步"] });
  });
});
