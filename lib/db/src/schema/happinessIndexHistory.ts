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
  computedAt: timestamp("computed_at", { withTimezone: true }).notNull().defaultNow(),
});

export type HappinessIndexHistoryRow = typeof happinessIndexHistoryTable.$inferSelect;
