import { pgTable, date, real, integer, boolean, timestamp } from "drizzle-orm/pg-core";

// Written by Aiportal's own api-server, but the VALUES come entirely from
// HERMES's daily-life-score.py — it POSTs to /api/admin/mind-index after
// each run (admin-password authenticated, same as other admin writes) and
// this table just upserts what it's given, keyed by date. Scores here are
// real (not smallint) because HERMES's own scoring keeps a decimal (e.g.
// 55.2), unlike the other three dashboard sources which round to integers.
//
// This replaced an earlier design that read a file (心智指標.md) directly
// off a NAS share mounted into the container — abandoned because Docker
// Desktop's WSL2 backend doesn't reliably bind-mount UNC paths (mounts
// "succeed" but the container sees an empty directory), and the fallback of
// baking the file into the image at build time meant the score only ever
// updated on the next Aiportal deploy, defeating the point of a daily score.
export const mindIndexHistoryTable = pgTable("mind_index_history", {
  date: date("date").primaryKey(),
  // 這四個是 HERMES 知識庫健康分數（原本唯一的心智指標）——2026-08-20 起改成
  // 只留著顯示用，不再計入翰翰仔幸福指數（見 dailyEngagementScore 的說明）。
  score: real("score").notNull(),
  conversion: real("conversion"),
  linkHealth: real("link_health"),
  vitality: real("vitality"),
  rhythm: real("rhythm"),
  rhythmTrendPct: real("rhythm_trend_pct"),
  partial: boolean("partial").notNull().default(false),
  // HHI 心智維度改用的新分數：當天日記篇數 + 當天完成任務數，取代上面知識庫
  // 分數在幸福指數裡的角色。三個都 nullable——HERMES 的 daily-life-score.py
  // 還沒實作這段公式之前會是 null，HHI 那邊會照既有的缺資料重新正規化邏輯
  // 處理，不會顯示假分數。
  dailyEngagementScore: real("daily_engagement_score"),
  diaryEntryCount: integer("diary_entry_count"),
  tasksCompletedCount: integer("tasks_completed_count"),
  computedAt: timestamp("computed_at", { withTimezone: true }).notNull().defaultNow(),
});

export type MindIndexHistoryRow = typeof mindIndexHistoryTable.$inferSelect;
