import { pgTable, serial, text, timestamp } from "drizzle-orm/pg-core";

// 入口網內建 HERMES 對話（見 api-server routes/hermesChat.ts）。
// 只有一列 id='current'：目前這串對話的 HERMES session 與最後一則訊息時間，手機和電腦共用同一串。
export const hermesChatStateTable = pgTable("hermes_chat_state", {
  id: text("id").primaryKey(),
  sessionId: text("session_id").notNull(),
  lastMessageAt: timestamp("last_message_at", { withTimezone: true }).notNull(),
});

// 重啟 Gateway 的請求佇列：入口網只寫一列，VPS 主機上的 hermes-restart-watcher 認領並執行，api-server 碰不到 Docker。
// 對話 API 跑在 Gateway 裡，Gateway 卡住時 API 也叫不動，所以這條路不能經過它。
// mode：graceful＝等進行中的工作收尾；force＝docker restart。
// status：pending → running → done／timeout／failed；留著當稽核紀錄。
export const hermesRestartRequestTable = pgTable("hermes_restart_request", {
  id: serial("id").primaryKey(),
  mode: text("mode").notNull(),
  status: text("status").notNull().default("pending"),
  note: text("note"),
  requestedAt: timestamp("requested_at", { withTimezone: true }).notNull().defaultNow(),
  startedAt: timestamp("started_at", { withTimezone: true }),
  finishedAt: timestamp("finished_at", { withTimezone: true }),
});

export type HermesRestartRequest = typeof hermesRestartRequestTable.$inferSelect;
