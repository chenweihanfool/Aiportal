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
  // HHI v3 (2026-09-01) 百分位正規化——六個維度各自的公式尺度差很大（有些
  // 公式正常使用下很難超過 60-70，有些輕鬆就上 90），直接把原始 0-100 分數
  // 加權平均，「80 分」在六個維度代表完全不同的意義。這六欄存的是「正規化
  // 之前」的原始分數，只有這支 23:55 快照 job 會寫——用來讓之後的日子可以
  // 對照「自己過去 90 天的原始分數」排百分位，見 lib/happinessIndex.ts 的
  // percentileRank()。calmRaw 存的已經是 100-忙碌指數（跟其他五個維度一樣
  // 「越高越好」的方向），不是原始忙碌指數本身。都是 nullable——那天那個維度
  // 沒有資料就是 null，不是假的 0。
  lifeFreedomRaw: real("life_freedom_raw"),
  fitnessHabitRaw: real("fitness_habit_raw"),
  calmRaw: real("calm_raw"),
  mindRaw: real("mind_raw"),
  travelRaw: real("travel_raw"),
  socialRaw: real("social_raw"),
  computedAt: timestamp("computed_at", { withTimezone: true }).notNull().defaultNow(),
});

export type HappinessIndexHistoryRow = typeof happinessIndexHistoryTable.$inferSelect;
