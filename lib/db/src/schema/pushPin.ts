import { pgTable, serial, text, timestamp, index } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

// 「📌 需要時提醒我」的釘選（2026-11-14，只新增、不修改、不刪除）。
// 使用者在閱讀面板或卷宗頁釘一個目標、選一個日子；到那天首頁推送卡出現 pinned 卡。
// due_date 是台北日期 YYYY-MM-DD；done_at 非 null 表示已完成（不再列出）。
// 未完成的 pin 依 due_date 查詢，由部分索引 push_pin_due_date_idx 支援。
export const pushPinTable = pgTable(
  "push_pin",
  {
    id: serial("id").primaryKey(),
    targetKind: text("target_kind").notNull(),
    targetId: text("target_id").notNull(),
    title: text("title").notNull(),
    href: text("href").notNull(),
    dueDate: text("due_date").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    doneAt: timestamp("done_at", { withTimezone: true }),
  },
  (t) => [
    index("push_pin_due_date_idx").on(t.dueDate).where(sql`${t.doneAt} is null`),
  ],
);
