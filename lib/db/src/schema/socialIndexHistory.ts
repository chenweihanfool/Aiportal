import { pgTable, date, smallint, real, timestamp } from "drizzle-orm/pg-core";

// Written by Aiportal's own api-server (routes/socialIndex.ts), fed by
// services/hermes-status/collect.ps1's raw counts (POST /admin/social-index,
// ~every 10 min, same cadence as mind-index). Unlike mind_index_history,
// there is exactly ONE pusher for this table, so it doesn't need
// mind_index_history's "two independent pushers, partial onConflictDoUpdate"
// pattern — every push carries the full row and fully overwrites it.
//
// Nullable columns represent "沒有觀測日"（observedDayCount === 0，例如近 7
// 天完全沒寫日記）——這是真實的缺資料狀態（"資料準備中"），不是 bug。
// observedDayCount >= 1 時所有欄位一定都有值，即使算出來剛好全部是 0（見
// artifacts/api-server/src/lib/socialIndex.ts 的 computeSocialIndex 說明：
// 那種 0 是真實訊號——一週完全沒社交互動——不是缺資料）。
export const socialIndexHistoryTable = pgTable("social_index_history", {
  date: date("date").primaryKey(),
  observedDayCount: smallint("observed_day_count").notNull(), // 0-7，一定有值
  distinctPersonCount: smallint("distinct_person_count"),
  weightedInteractionPoints: real("weighted_interaction_points"),
  daysWithInteraction: smallint("days_with_interaction"),
  breadthScore: real("breadth_score"),
  intensityScore: real("intensity_score"),
  connectionRateScore: real("connection_rate_score"),
  socialScore: smallint("social_score"), // null iff observedDayCount === 0
  computedAt: timestamp("computed_at", { withTimezone: true }).notNull().defaultNow(),
});

export type SocialIndexHistoryRow = typeof socialIndexHistoryTable.$inferSelect;
