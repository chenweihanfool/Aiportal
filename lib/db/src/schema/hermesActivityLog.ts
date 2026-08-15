import { pgTable, serial, text, timestamp } from "drizzle-orm/pg-core";

// Append-only event log — unlike hermes_status_snapshot (one upserted row),
// a single day can have multiple deploys/backups, so this needs one row per
// event, not one row per date. Populated by the collector script tailing
// each known repo's existing `update.log` (already written by update.ps1),
// not by asking HERMES to instrument every action — see services/hermes-status/collect.ps1.
export const hermesActivityLogTable = pgTable("hermes_activity_log", {
  id: serial("id").primaryKey(),
  occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull(),
  source: text("source").notNull(),
  message: text("message").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type HermesActivityLogRow = typeof hermesActivityLogTable.$inferSelect;
