import { pgTable, text, jsonb, timestamp } from "drizzle-orm/pg-core";

// One JSON blob per L1~L5 layer — mirrors the shape HERMES's own wrapper
// scripts (l{N}-agent-wrapper.py) already write to their local heartbeat
// file (F:/SynologyDrive/AI/state/heartbeat.json) on every run. collect.ps1
// reads that file directly (same host) and passes these fields through
// as-is; health (ok/crit/unknown) is derived at read time in the API route
// from lastRun + the per-layer expected cadence, not stored here — same
// "raw source of truth, derive on read" principle as hermes_graph_snapshot.
export interface HermesPipelineLayerStatus {
  status: string | null;
  lastRun: string | null;
  // Epoch milliseconds, from heartbeat.json's `last_run_ts` (seconds) ×
  // 1000 — staleness math uses this, never the `lastRun` display string.
  // heartbeat.json writes `last_run` as a bare "yyyy-MM-dd HH:mm:ss" local
  // timestamp with no timezone marker; parsing that string here would mean
  // guessing whether it's Taipei local time or the container's own tz, the
  // same class of bug `collect.ps1`'s own \uXXXX-escaping comment already
  // warns about elsewhere in this codebase. The numeric epoch sidesteps it.
  lastRunTs: number | null;
  processed: number | null;
  committed: number | null;
  failed: number | null;
  backlog: number | null;
  errorSummary: string | null;
  durationSeconds: number | null;
}

// Single-row "latest known state" table, same shape as hermes_status_snapshot
// — a new heartbeat read always upserts id: 'latest', no history retained
// here (HERMES's own heartbeat.json already keeps an L{n}_history array on
// its side; this panel only needs the current state per layer).
export const hermesPipelineSnapshotTable = pgTable("hermes_pipeline_snapshot", {
  id: text("id").primaryKey().default("latest"),
  l1: jsonb("l1").$type<HermesPipelineLayerStatus>(),
  l2: jsonb("l2").$type<HermesPipelineLayerStatus>(),
  l3: jsonb("l3").$type<HermesPipelineLayerStatus>(),
  l4: jsonb("l4").$type<HermesPipelineLayerStatus>(),
  l5: jsonb("l5").$type<HermesPipelineLayerStatus>(),
  computedAt: timestamp("computed_at", { withTimezone: true }).notNull().defaultNow(),
});

export type HermesPipelineSnapshotRow = typeof hermesPipelineSnapshotTable.$inferSelect;
