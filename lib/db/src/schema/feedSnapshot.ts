import { pgTable, text, integer, jsonb, timestamp } from "drizzle-orm/pg-core";

// 泛用 feed（P1-7，2026-10-16）：新資料不再各開一張表＋一支端點，先走 POST /api/admin/feed/:name。
// 每種 feed 一列（name 為主鍵），整份覆寫，只留最新一份；payload 在寫入前已依 schemas/feeds/<name> 的 JSON Schema 驗證。
// 既有的專用 feed（hermes-places、hermes-trips…）不搬，維持原樣。
export const feedSnapshotTable = pgTable("feed_snapshot", {
  name: text("name").primaryKey(),
  version: integer("version").notNull(), // 寫入時的 schemaVersion
  payload: jsonb("payload").$type<unknown>().notNull(),
  generatedAt: text("generated_at"), // 推送端產生資料的日期 YYYY-MM-DD
  receivedAt: timestamp("received_at", { withTimezone: true }).notNull().defaultNow(),
});

export type FeedSnapshotRow = typeof feedSnapshotTable.$inferSelect;
