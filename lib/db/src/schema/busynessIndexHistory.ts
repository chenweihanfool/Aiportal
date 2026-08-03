import { pgTable, date, smallint, text, timestamp } from "drizzle-orm/pg-core";

// Read-only from the TS side — this table is owned and written by the
// standalone Python service (services/busyness-index/history_db.py). Aiportal
// only ever SELECTs the latest row to surface Vikunja's busyness score on
// the dashboard; it must never INSERT/UPDATE here (that would race with the
// daily cron job and violate the "one row per date" invariant that job's
// upsert relies on).
export const busynessIndexHistoryTable = pgTable("busyness_index_history", {
  date: date("date").primaryKey(),
  score: smallint("score").notNull(),
  overdueScore: smallint("overdue_score"),
  loadScore: smallint("load_score"),
  stagnationScore: smallint("stagnation_score"),
  completionScore: smallint("completion_score"),
  approximatedCount: smallint("approximated_count").notNull().default(0),
  nullComponents: text("null_components").array().notNull().default([]),
  configVersion: text("config_version").notNull(),
  computedAt: timestamp("computed_at", { withTimezone: true }).notNull().defaultNow(),
});

export type BusynessIndexHistoryRow = typeof busynessIndexHistoryTable.$inferSelect;
