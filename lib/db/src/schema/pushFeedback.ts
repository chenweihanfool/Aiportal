import { pgTable, serial, text, timestamp, index } from "drizzle-orm/pg-core";

// 首頁「現在用得上」卡片的回饋（2026-11-13，只新增、不修改、不刪除）。
// 用途：記錄卡片被看到／點開／標有用、晚點、沒用。前端把「沒用」的卡片永久濾掉，
// 「晚點」的卡片收到當天 20:00；for_date 是卡片代表的日期（台北時區 YYYY-MM-DD）。
// shown 同一 (card_key, for_date) 只留一筆（由路由先查再決定是否新增）。
export const pushFeedbackTable = pgTable(
  "push_feedback",
  {
    id: serial("id").primaryKey(),
    cardKey: text("card_key").notNull(),
    cardKind: text("card_kind").notNull(),
    action: text("action").notNull(),
    forDate: text("for_date").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("push_feedback_card_key_for_date_idx").on(t.cardKey, t.forDate),
  ],
);
