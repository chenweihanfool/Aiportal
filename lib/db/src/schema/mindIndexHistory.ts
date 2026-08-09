import { pgTable, date, real, boolean, timestamp } from "drizzle-orm/pg-core";

// Written by Aiportal's own api-server, but the VALUES come entirely from
// HERMES's daily-life-score.py — it POSTs to /api/admin/mind-index after
// each run (admin-password authenticated, same as other admin writes) and
// this table just upserts what it's given, keyed by date. Scores here are
// real (not smallint) because HERMES's own scoring keeps a decimal (e.g.
// 55.2), unlike the other three dashboard sources which round to integers.
//
// This replaced an earlier design that read a file (心智指標.md) directly
// off a NAS share mounted into the container — abandoned because Docker
// Desktop's WSL2 backend doesn't reliably bind-mount UNC paths (mounts
// "succeed" but the container sees an empty directory), and the fallback of
// baking the file into the image at build time meant the score only ever
// updated on the next Aiportal deploy, defeating the point of a daily score.
export const mindIndexHistoryTable = pgTable("mind_index_history", {
  date: date("date").primaryKey(),
  score: real("score").notNull(),
  conversion: real("conversion"),
  linkHealth: real("link_health"),
  vitality: real("vitality"),
  rhythm: real("rhythm"),
  rhythmTrendPct: real("rhythm_trend_pct"),
  partial: boolean("partial").notNull().default(false),
  computedAt: timestamp("computed_at", { withTimezone: true }).notNull().defaultNow(),
});

export type MindIndexHistoryRow = typeof mindIndexHistoryTable.$inferSelect;
