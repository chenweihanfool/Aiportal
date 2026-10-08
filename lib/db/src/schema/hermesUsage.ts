import { pgTable, date, jsonb, timestamp, serial, doublePrecision, text } from "drizzle-orm/pg-core";

// HERMES 端（state.db 的 session_model_usage）每天聚合出來的 Ollama 雲端用量。
// 每天一列、整列覆寫；HERMES 的 pusher 每次推最近幾十天，所以任何一天漏推都會在下一輪補上。
// 只存「HERMES 這台 VPS 發出的請求」——Ollama 帳號還有別的用量來源（截圖裡 gemma4／kimi／minimax 本機都查不到），
// 所以金額與餘額不能由這張表推得，見下面的 ollama_balance_entry。
export interface HermesUsageModelDay {
  calls: number;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
}

export const hermesUsageDailyTable = pgTable("hermes_usage_daily", {
  date: date("date").primaryKey(),
  models: jsonb("models").$type<Record<string, HermesUsageModelDay>>().notNull(),
  computedAt: timestamp("computed_at", { withTimezone: true }).notNull().defaultNow(),
});

// 使用者手動輸入的 Ollama 帳戶餘額快照（ollama.com 沒有可從本機取得的額度端點）。
// 每次輸入一列、只增不改：相鄰兩筆的餘額差就是「實際每天花多少」（含所有用量來源），比用請求數乘單價準。
export const ollamaBalanceEntryTable = pgTable("ollama_balance_entry", {
  id: serial("id").primaryKey(),
  enteredAt: timestamp("entered_at", { withTimezone: true }).notNull().defaultNow(),
  balanceUsd: doublePrecision("balance_usd").notNull(),
  // 方案補點後的上限（Pro 為 $60）與下次補點日；沒填就沿用上一筆
  capUsd: doublePrecision("cap_usd").notNull().default(60),
  refillAt: date("refill_at"),
  // 頁面上「Monthly credits used」的數字，只作校準與顯示
  monthUsedUsd: doublePrecision("month_used_usd"),
  note: text("note"),
});

export type HermesUsageDailyRow = typeof hermesUsageDailyTable.$inferSelect;
export type OllamaBalanceEntryRow = typeof ollamaBalanceEntryTable.$inferSelect;
