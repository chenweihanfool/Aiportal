import { pgTable, text, boolean, integer, timestamp, primaryKey, index } from "drizzle-orm/pg-core";

// 2026-09-29 — 時間軸（日／週／月／季／年摘要）。資料來源是 HERMES 端 Vault 的
// pipeline/報表/{日報,週報,月報,季報,年報}，由 hermes-timeline-pusher.py 增量 upsert
// 進來（POST /api/admin/hermes-timeline，admin-password 驗證，跟其他 HERMES 推送一致）。
//
// 為什麼獨立一張表、不併進 hermes_graph_snapshot：報表全文會逐年累積，圖譜快照
// 是「latest 整包覆蓋」的單列 jsonb，塞進去會跟現有 payload（nginx 預設 1 MiB 上限）
// 互相擠壓；獨立表可分頁、可增量，也不會因為報表變多而拖慢關係圖載入。
//
// 主鍵 (level, period_key)：period_key 取自「檔名」——HERMES 實測週／月／季／年報沒有
// frontmatter、mtime 不可信，檔名是唯一穩定鍵：
//   day     2026-09-28        month  2026-08
//   week    2026-第40週       quarter 2026-Q2       year 2026
// start_date / end_date 是該期間涵蓋的日期（YYYY-MM-DD 字串，可直接字串比較排序）；
// 週報的區間由 pusher 解析檔案首行，取不到才推算並標 range_inferred=true。
// body_md 是報表原文（單檔 ≤ ~10 KiB），列表 API 不回傳，只在開單筆時才讀。
export const hermesTimelineEntryTable = pgTable(
  "hermes_timeline_entry",
  {
    level: text("level").notNull(), // 'day' | 'week' | 'month' | 'quarter' | 'year'
    periodKey: text("period_key").notNull(),
    startDate: text("start_date").notNull(),
    endDate: text("end_date").notNull(),
    title: text("title").notNull(),
    summary: text("summary").notNull().default(""), // 一句話（≤120 字，pusher 抽取；抽不到為空字串）
    bodyMd: text("body_md").notNull(),
    generation: integer("generation").notNull().default(3), // 格式世代（診斷用）
    rangeInferred: boolean("range_inferred").notNull().default(false),
    periodNote: text("period_note"), // 例：季報自述「涵蓋順延為 5–7 月」
    sourcePath: text("source_path"),
    contentHash: text("content_hash").notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.level, t.periodKey] }),
    index("hermes_timeline_entry_level_start_idx").on(t.level, t.startDate),
  ],
);

export type HermesTimelineEntryRow = typeof hermesTimelineEntryTable.$inferSelect;
export type HermesTimelineEntryInsert = typeof hermesTimelineEntryTable.$inferInsert;
