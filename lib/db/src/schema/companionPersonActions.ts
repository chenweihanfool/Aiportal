import { pgTable, text, timestamp } from "drizzle-orm/pg-core";

// 首頁「陪伴」的人物提醒動作（2026-11-07）：很久沒聯絡的人，使用者按「已聯絡／暫緩 30 天／不再提醒」。
// 這是入口網自己的狀態，不寫回 HERMES；name 對應 feed companion 的 quietPeople[].name。
//   action = 'contacted'  只記時間（updated_at 當動作日）
//   action = 'snooze'     until = 暫緩到哪一天（YYYY-MM-DD，台北）
//   action = 'never'      reason = 原因（可空，例如「已故」）
export type CompanionPersonAction = "contacted" | "snooze" | "never";

export const companionPersonActionsTable = pgTable("companion_person_actions", {
  name: text("name").primaryKey(),
  action: text("action").$type<CompanionPersonAction>().notNull(),
  until: text("until"),
  reason: text("reason"),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});
