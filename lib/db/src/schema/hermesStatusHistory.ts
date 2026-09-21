import { pgTable, date, real, integer, timestamp } from "drizzle-orm/pg-core";

// 每日一筆的「今天最後一次快照」趨勢紀錄——跟 mind_index_history／
// social_index_history 同一種模式：collect.ps1 每 ~10 分鐘 POST 一次
// hermes-status，每次都 upsert 這張表的「今天」那一列（onConflictDoUpdate
// on date），所以這張表天然就是「當天最新狀態」而不需要額外的每日快照排程
// ——跟 hermes_status_snapshot（只留一列 latest、完全不留歷史）不一樣，這
// 張表留歷史但只留「粒度=天」，不逐筆存每次 push（10 分鐘一筆存一整年會
// 是五萬多列，戰情室的操作型監控用不到那個粒度，能看出「這禮拜容器是不是
// 越來越常掛」就夠了）。
export const hermesStatusHistoryTable = pgTable("hermes_status_history", {
  date: date("date").primaryKey(),
  cpuPercent: real("cpu_percent"),
  memPercent: real("mem_percent"),
  worstDiskPercent: real("worst_disk_percent"),
  containersHealthy: integer("containers_healthy"),
  containersTotal: integer("containers_total"),
  tasksFailed: integer("tasks_failed"),
  tasksTotal: integer("tasks_total"),
  computedAt: timestamp("computed_at", { withTimezone: true }).notNull().defaultNow(),
});

export type HermesStatusHistoryRow = typeof hermesStatusHistoryTable.$inferSelect;
