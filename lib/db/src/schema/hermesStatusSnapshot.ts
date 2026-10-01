import { pgTable, text, real, jsonb, timestamp } from "drizzle-orm/pg-core";

// Single-row "latest known state" table — a new snapshot POSTed by the
// host-side collector script (services/hermes-status/collect.ps1) always
// upserts the same `id: 'latest'` row rather than accumulating history, so
// reads never need to scan/sort. Unlike mind_index_history / happiness /
// busyness_index_history (one row per day), this data changes every few
// minutes and nobody needs to look back at yesterday's CPU load.
export const hermesStatusSnapshotTable = pgTable("hermes_status_snapshot", {
  id: text("id").primaryKey().default("latest"),
  cpuPercent: real("cpu_percent"),
  memPercent: real("mem_percent"),
  disks: jsonb("disks").$type<Array<{ drive: string; percentUsed: number; freeGb: number; totalGb: number }>>(),
  containers: jsonb("containers").$type<Array<{ name: string; project: string | null; status: string; health: string | null }>>(),
  // 磁碟佔用分項（2026-10-01）：[{label, bytes}]，由 status pusher 量測 vault／Postgres／docker／logs 等大戶；
  // 沒有就是 null（舊 pusher 不送），讀端照常顯示總量
  storage: jsonb("storage").$type<Array<{ label: string; bytes: number }>>(),
  scheduledTasks: jsonb("scheduled_tasks").$type<Array<{ name: string; lastRunTime: string | null; lastTaskResult: number | null }>>(),
  computedAt: timestamp("computed_at", { withTimezone: true }).notNull().defaultNow(),
});

export type HermesStatusSnapshotRow = typeof hermesStatusSnapshotTable.$inferSelect;
