import { db, feedSnapshotTable, hermesIdeasSnapshotTable, hermesPlacesSnapshotTable, hermesTimelineEntryTable, hermesTripsSnapshotTable } from "@workspace/db";
import { and, eq, inArray } from "drizzle-orm";
import { HAPPINESS_CONFIG } from "./happinessIndex";
import { dayAdjustOf, dayCounter, dayScoreOf, tasksByDateOf, type DayLink } from "./dailyScore";
import { lifeDaysOf, type LifeDay } from "./dailyLife";
import { parseReportScore } from "./reportScore";

const shiftDate = (date: string, days: number): string => {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
};

/** 逐日的生活項目（見 dailyLife.ts）。workoutDays 來自已抓回的 FitnessForge 摘要，不在這裡再打一次 */
export async function loadLifeDays(today: string, workoutDays: unknown): Promise<Map<string, LifeDay>> {
  const [[companionRow], [placesRow], [tripsRow]] = await Promise.all([
    db.select({ payload: feedSnapshotTable.payload }).from(feedSnapshotTable).where(eq(feedSnapshotTable.name, "companion")).limit(1),
    db.select({ places: hermesPlacesSnapshotTable.places }).from(hermesPlacesSnapshotTable).where(eq(hermesPlacesSnapshotTable.id, "latest")).limit(1),
    db.select({ trips: hermesTripsSnapshotTable.trips }).from(hermesTripsSnapshotTable).where(eq(hermesTripsSnapshotTable.id, "latest")).limit(1),
  ]);
  return lifeDaysOf({ companion: companionRow?.payload ?? null, places: placesRow?.places ?? [], trips: tripsRow?.trips ?? [], workoutDays }, today);
}

// 今天的每日評分與日分修正。基準線由想法庫、完成任務、日報現算，不依賴已存的列，上線第一天就有近 28 天可比。
// 想法庫或完成任務讀不到＝null（不修正），不把讀不到當成「今天什麼都沒做」。
export async function loadDayLink(today: string, final: boolean, workoutDays: unknown = null): Promise<DayLink | null> {
  const dates = Array.from({ length: HAPPINESS_CONFIG.dayBaselineDays + 1 }, (_, i) => shiftDate(today, -i));
  const [[ideasRow], [tasksRow], reportRows, life] = await Promise.all([
    db.select({ ideas: hermesIdeasSnapshotTable.ideas }).from(hermesIdeasSnapshotTable).where(eq(hermesIdeasSnapshotTable.id, "latest")).limit(1),
    db.select({ payload: feedSnapshotTable.payload }).from(feedSnapshotTable).where(eq(feedSnapshotTable.name, "tasks-done")).limit(1),
    db
      .select({ date: hermesTimelineEntryTable.periodKey, bodyMd: hermesTimelineEntryTable.bodyMd })
      .from(hermesTimelineEntryTable)
      .where(and(eq(hermesTimelineEntryTable.level, "day"), inArray(hermesTimelineEntryTable.periodKey, dates))),
    loadLifeDays(today, workoutDays),
  ]);
  const tasks = tasksByDateOf(tasksRow?.payload);
  if (!ideasRow || !tasks) return null;

  const reports = new Map<string, number>();
  for (const r of reportRows) {
    const s = parseReportScore(r.bodyMd);
    if (s) reports.set(r.date, s.total);
  }
  const count = dayCounter(ideasRow.ideas, tasks, life);
  const scoreOf = (d: string) => dayScoreOf(count(d), reports.get(d) ?? null);
  const score = scoreOf(today);
  const baseline = dates.slice(1).map((d) => scoreOf(d).total);
  return { ...score, ...dayAdjustOf(score.total, baseline, final) };
}
