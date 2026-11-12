import { pgTable, serial, text, timestamp } from "drizzle-orm/pg-core";

// 使用者對知識頁某一條的更正（2026-11-12）：不對／改寫／補一句／撤回。
// 更正是原始資料：只新增、不修改、不刪除；撤回（undo）也是新增一筆。
// 入口網不主動寫回知識庫，由管線帶管理密碼 GET /api/knowledge/corrections 拉取。
//   kind = 'wrong'  這一條不對
//   kind = 'fix'    改寫（text 為新內容）
//   kind = 'add'    補一句（section 可指定放哪一節、text 為補充內容）
//   kind = 'undo'   撤回先前某一筆（claim_id 指向該條）
export type KnowledgeCorrectionKind = "wrong" | "fix" | "add" | "undo";

export const knowledgeCorrectionsTable = pgTable("knowledge_corrections", {
  id: serial("id").primaryKey(),
  topicId: text("topic_id").notNull(),
  claimId: text("claim_id"),
  kind: text("kind").$type<KnowledgeCorrectionKind>().notNull(),
  section: text("section"),
  text: text("text"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});
