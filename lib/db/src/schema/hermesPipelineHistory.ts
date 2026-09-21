import { pgTable, date, text, timestamp } from "drizzle-orm/pg-core";

// 跟 hermesStatusHistory 同一種模式（每天一列、collect.ps1 每次 push 就
// upsert 今天那列），存的是 L1~L5 每層當下算出來的健康狀態（ok/crit/
// unknown），不是原始 heartbeat 欄位——健康狀態本身就是跟「當下時間」有關
// 的判定（lastRun 距今 vs 預期班距），歷史紀錄要存的是「那天最後一次 push
// 當下判定出來的健康狀態」，不能等之後讀取歷史時才用「現在」重新算一次
// （那樣舊資料只會全部變成 crit，因為早就超過任何班距的 2 倍）。
export const hermesPipelineHistoryTable = pgTable("hermes_pipeline_history", {
  date: date("date").primaryKey(),
  l1Health: text("l1_health"),
  l2Health: text("l2_health"),
  l3Health: text("l3_health"),
  l4Health: text("l4_health"),
  l5Health: text("l5_health"),
  computedAt: timestamp("computed_at", { withTimezone: true }).notNull().defaultNow(),
});

export type HermesPipelineHistoryRow = typeof hermesPipelineHistoryTable.$inferSelect;
