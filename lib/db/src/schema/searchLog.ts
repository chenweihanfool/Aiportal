import { pgTable, serial, text, integer, timestamp } from "drizzle-orm/pg-core";

// 入口網「一個框搜全部」的搜尋紀錄（2026-11-13，只新增、不修改、不刪除）。
// 用途：看哪些查詢找不到（total=0）、找到之後有沒有點開，之後據此調整索引與推送。
//   clicked_kind／clicked_id：使用者最後點開的結果；沒點開為 null。
export const searchLogTable = pgTable("search_log", {
  id: serial("id").primaryKey(),
  q: text("q").notNull(),
  kind: text("kind"),
  total: integer("total").notNull(),
  clickedKind: text("clicked_kind"),
  clickedId: text("clicked_id"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});
