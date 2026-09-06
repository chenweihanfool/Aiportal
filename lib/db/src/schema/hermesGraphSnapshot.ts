import { pgTable, text, jsonb, timestamp } from "drizzle-orm/pg-core";

// HERMES's "事人雙實體" (event-person dual-entity) knowledge structure,
// 2026-09-03 — Events/*.md frontmatter is the single source of truth
// (`participants: [{person, role}]`); People/*.md is just a derived,
// script-maintained backlink cache on HERMES's own side, so this only ever
// stores the events array. People nodes, edges, and every derived metric
// (peopleCount, orphan ratio, most-active person, ...) are computed from
// `events` at read time in routes/hermesStatus.ts's GET handler — nothing
// here is pre-aggregated, so a schema/metric change never needs a backfill.
//
// Same "single latest row, whole-payload overwrite" shape as
// hermesStatusSnapshotTable: collect.ps1 re-scans every Events/*.md file
// each run and POSTs the full current set, not a diff.
export const hermesGraphSnapshotTable = pgTable("hermes_graph_snapshot", {
  id: text("id").primaryKey().default("latest"),
  events: jsonb("events").$type<
    Array<{
      id: string;
      date: string; // YYYY-MM-DD
      title: string;
      caseNo: string | null;
      location: string | null;
      status: string | null;
      tags: string[];
      participants: Array<{ person: string; role: string }>;
    }>
  >(),
  computedAt: timestamp("computed_at", { withTimezone: true }).notNull().defaultNow(),
});

export type HermesGraphSnapshotRow = typeof hermesGraphSnapshotTable.$inferSelect;
export type HermesGraphEvent = NonNullable<HermesGraphSnapshotRow["events"]>[number];
