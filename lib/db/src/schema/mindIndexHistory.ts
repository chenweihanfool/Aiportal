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
  // score 從 notNull 改 nullable（2026-08-21）：/api/admin/mind-index 現在
  // 支援「只 push 部分欄位」（見 routes/mindIndex.ts），collect.ps1 每 10
  // 分鐘只 push dailyEngagementScore/diaryEntryCount，如果那次剛好是當天
  // 第一筆寫入（daily-life-score.py 還沒跑過），score 欄位就會先是 null，
  // 等 daily-life-score.py 當天跑完才會補上，不能再要求 notNull。
  score: real("score"),
  conversion: real("conversion"),
  linkHealth: real("link_health"),
  vitality: real("vitality"),
  rhythm: real("rhythm"),
  rhythmTrendPct: real("rhythm_trend_pct"),
  partial: boolean("partial").notNull().default(false),
  // HHI 心智維度改用的新分數：純看當天日記篇數，取代上面知識庫分數在幸福指數
  // 裡的角色。2026-08-20 起不再把 tasksCompletedCount 算進 dailyEngagementScore
  // ——任務完成度已經是從容指數（busynessScore）在算的東西，兩個維度算同一件
  // 事會重複；這個欄位保留只是因為刪掉要動 daily-life-score.py 跟 migration，
  // 沒必要，單純不再被讀取而已。三個都 nullable——HERMES 的 daily-life-score.py
  // 還沒實作這段公式之前會是 null，HHI 那邊會照既有的缺資料重新正規化邏輯
  // 處理，不會顯示假分數。
  dailyEngagementScore: real("daily_engagement_score"),
  diaryEntryCount: integer("diary_entry_count"),
  tasksCompletedCount: integer("tasks_completed_count"), // 不再影響 dailyEngagementScore，見上方說明
  computedAt: timestamp("computed_at", { withTimezone: true }).notNull().defaultNow(),
});

export type MindIndexHistoryRow = typeof mindIndexHistoryTable.$inferSelect;
