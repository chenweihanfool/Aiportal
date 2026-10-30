// 每日評分的生活面向：見家人朋友、去新店、旅行、運動。純函式，資料庫讀取在 dailyScoreSource.ts。
// 使用者 2026-10-30 選點數「見人 2、新店 1、旅行 2、運動 2」；旅行或陪家人的日子沒有任務與想法，只算工作成果會偏低。
// 逐日資料只在這裡算一次：日分修正直接用，前端（時間軸、日報）讀 GET /api/daily-life，點數才各自換算。
import type { HermesPlace, HermesTrip } from "@workspace/db";

/** 往回算幾天；社交紀錄只有近 120 天（feed companion），更早的日子見人算 0 */
export const LIFE_WINDOW_DAYS = 400;

const DATE = /^\d{4}-\d{2}-\d{2}$/;

export interface LifeDay {
  date: string;
  /** 當天互動的家人朋友人數（同事不算，推送端已排除） */
  socialPeople: number;
  newPlaces: string[];
  trip: string | null;
  workouts: string[];
}

export interface LifeSources {
  /** feed companion 的 payload */
  companion: unknown;
  places: readonly HermesPlace[];
  trips: readonly HermesTrip[];
  /** FitnessForge /api/public/summary 的 workoutDays */
  workoutDays: unknown;
}

const shiftDate = (date: string, days: number): string => {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
};

/** 日期對當天的生活項目；只列視窗內、不晚於今天、有東西的日子。來源缺或格式不對就略過那一項（前後天一樣缺，修正不會偏） */
export function lifeDaysOf(src: LifeSources, today: string): Map<string, LifeDay> {
  const from = shiftDate(today, -LIFE_WINDOW_DAYS);
  const out = new Map<string, LifeDay>();
  const dayOf = (date: string): LifeDay | null => {
    if (!DATE.test(date) || date < from || date > today) return null;
    let d = out.get(date);
    if (!d) out.set(date, (d = { date, socialPeople: 0, newPlaces: [], trip: null, workouts: [] }));
    return d;
  };

  const social = (src.companion as { socialDays?: unknown } | null)?.socialDays;
  if (Array.isArray(social)) {
    for (const s of social as Array<{ date?: unknown; people?: unknown }>) {
      if (typeof s?.date !== "string" || typeof s.people !== "number" || s.people <= 0) continue;
      const d = dayOf(s.date);
      if (d) d.socialPeople = s.people;
    }
  }

  for (const p of src.places) {
    if (p.kind !== "food" || (p.status !== "visited" && p.status !== "favorite") || !p.visitedAt) continue;
    dayOf(p.visitedAt)?.newPlaces.push(p.name);
  }

  for (const t of src.trips) {
    if (t.status === "planned") continue;
    const end = t.end < today ? t.end : today;
    for (let date = t.start < from ? from : t.start; date <= end; date = shiftDate(date, 1)) {
      const d = dayOf(date);
      if (d) d.trip ??= t.name;
    }
  }

  if (Array.isArray(src.workoutDays)) {
    for (const w of src.workoutDays as Array<{ date?: unknown; exercises?: unknown }>) {
      if (typeof w?.date !== "string" || !Array.isArray(w.exercises) || w.exercises.length === 0) continue;
      const d = dayOf(w.date);
      if (d) d.workouts = w.exercises.filter((x): x is string => typeof x === "string");
    }
  }
  return out;
}
