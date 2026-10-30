import { pgTable, date, smallint, real, text, timestamp } from "drizzle-orm/pg-core";

// Owned and written by Aiportal's own api-server (summaryFetchJob), unlike
// busynessIndexHistoryTable which the Python service owns. One row per
// date, upserted on every fetch cycle (~20 min) — see
// lib/happinessIndex.ts for why "today" keeps being recomputed intraday
// while "yesterday" stays fixed once the date rolls over.
export const happinessIndexHistoryTable = pgTable("happiness_index_history", {
  date: date("date").primaryKey(),
  finalScore: smallint("final_score").notNull(),
  displayedScore: smallint("displayed_score").notNull(),
  baseScore: real("base_score").notNull(),
  weakestScore: real("weakest_score").notNull(),
  weakestComponent: text("weakest_component").notNull(),
  availableComponents: text("available_components").array().notNull(),
  configVersion: text("config_version").notNull(),
  // 六個面向的公式分，只有 23:55 快照 job 會寫。2026-10-30 起這就是面向分數
  // （之前用它排滾動 90 天百分位，見 lib/happinessDimensionHistory.ts）。
  // calmRaw 存的已經是 100-忙碌指數（跟其他五個維度一樣「越高越好」的方向），
  // 不是原始忙碌指數本身。都是 nullable——那天那個維度沒有資料就是 null，不是假的 0。
  lifeFreedomRaw: real("life_freedom_raw"),
  fitnessHabitRaw: real("fitness_habit_raw"),
  calmRaw: real("calm_raw"),
  mindRaw: real("mind_raw"),
  travelRaw: real("travel_raw"),
  socialRaw: real("social_raw"),
  // 💡 心智分數（想法版，2026-10-09 第四期）：並行記錄期間只寫不讀，不影響上面任何分數。
  // 23:55 快照時由 hermes_ideas_snapshot 現算（lib/ideasMind.ts）。並行兩週後若切換，
  // 心智維度的百分位會改用這一欄的歷史，所以從現在起就每天存。
  mindIdeasRaw: real("mind_ideas_raw"),
  // 每日評分與日分修正（2026-10-30 起，見 api-server lib/dailyScore.ts）；想法庫或完成任務讀不到＝null
  dayScore: smallint("day_score"),
  dayAchievement: smallint("day_achievement"),
  dayAi: smallint("day_ai"),
  dayAdjust: real("day_adjust"),
  computedAt: timestamp("computed_at", { withTimezone: true }).notNull().defaultNow(),
});

export type HappinessIndexHistoryRow = typeof happinessIndexHistoryTable.$inferSelect;
