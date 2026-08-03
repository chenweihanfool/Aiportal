import { pgTable, text, timestamp, boolean, jsonb } from "drizzle-orm/pg-core";

export const subsystemSummariesTable = pgTable("subsystem_summaries", {
  subsystemId: text("subsystem_id").primaryKey(),
  data: jsonb("data").notNull(),
  status: text("status").notNull(), // 'ok' | 'error'
  errorMessage: text("error_message"),
  isPrivate: boolean("is_private").notNull().default(true),
  fetchedAt: timestamp("fetched_at").notNull().defaultNow(),
});

export type SubsystemSummary = typeof subsystemSummariesTable.$inferSelect;
