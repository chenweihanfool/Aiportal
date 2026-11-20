import { pgTable, serial, text, timestamp } from "drizzle-orm/pg-core";

// 心得編織層（insight-weave）的使用者判斷（2026-11-20）：確認／否決／撤回。
// 判斷是原始資料：只新增、不修改、不刪除；撤回（undo）也是新增一筆。
// 入口網不主動寫回知識庫，由管線帶管理密碼 GET /api/insights/weave/verdicts 拉取。
//   verdict = 'ok'   確認（保留這一條）
//   verdict = 'no'   否決（不要這一條）
//   verdict = 'undo' 撤回先前某一筆判斷
export type InsightWeaveVerdict = "ok" | "no" | "undo";

export const insightWeaveVerdictsTable = pgTable("insight_weave_verdicts", {
  id: serial("id").primaryKey(),
  itemId: text("item_id").notNull(),
  verdict: text("verdict").$type<InsightWeaveVerdict>().notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});
