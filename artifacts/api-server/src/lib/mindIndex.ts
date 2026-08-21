// 心智指標 (HERMES's daily-computed knowledge-base vitality score). Read-only
// here — HERMES's daily-life-score.py POSTs the actual values to
// POST /api/admin/mind-index (routes/mindIndex.ts), which owns the writes to
// mind_index_history. This just reads the latest row, same pattern as
// fetchVikunjaBusynessFromHistory().
//
// An earlier version of this file read 心智指標.md directly off a NAS share
// mounted into the container. Abandoned because Docker Desktop's WSL2
// backend doesn't reliably bind-mount UNC paths (the mount "succeeds" but
// the container sees an empty directory).
import { db, mindIndexHistoryTable } from "@workspace/db";
import { desc } from "drizzle-orm";

// HERMES's own scoring script not having run in a while is a different
// concept from Aiportal's own fetch succeeding — a successful read of the
// latest row can still hold a stale score if daily-life-score.py stopped
// posting. Compared against computedAt, when Aiportal last received a push.
const STALE_THRESHOLD_MS = 36 * 60 * 60 * 1000;

export interface MindIndexData {
  // 知識庫健康分數 — 保留顯示用，2026-08-20 起不再計入翰翰仔幸福指數。
  score: number | null;
  conversion: number | null;
  linkHealth: number | null;
  vitality: number | null;
  rhythm: number | null;
  rhythmTrendPct: number | null;
  partial: boolean;
  // HHI 心智維度改讀 dailyEngagementScore——2026-08-21 起（HHI v2）是近 3 天
  // 滾動窗口（diaryEntryCount3Day）算出來的，不再是單看當天。diaryEntryCount
  // 保留只算今天，給卡片「日記篇數」顯示統計用；tasksCompletedCount 已不影
  // 響 dailyEngagementScore（跟從容指數重複，見 mind_index_history schema）。
  dailyEngagementScore: number | null;
  diaryEntryCount: number | null;
  diaryEntryCount3Day: number | null;
  tasksCompletedCount: number | null;
  updatedAt: string | null;
  stale: boolean;
}

export async function fetchMindIndex(): Promise<MindIndexData> {
  const [row] = await db
    .select()
    .from(mindIndexHistoryTable)
    .orderBy(desc(mindIndexHistoryTable.date))
    .limit(1);

  if (!row) {
    throw new Error(
      "mind_index_history has no rows yet — has daily-life-score.py POSTed to /api/admin/mind-index at least once?"
    );
  }

  const stale = Date.now() - row.computedAt.getTime() > STALE_THRESHOLD_MS;

  return {
    score: row.score,
    conversion: row.conversion,
    linkHealth: row.linkHealth,
    vitality: row.vitality,
    rhythm: row.rhythm,
    rhythmTrendPct: row.rhythmTrendPct,
    partial: row.partial,
    dailyEngagementScore: row.dailyEngagementScore,
    diaryEntryCount: row.diaryEntryCount,
    diaryEntryCount3Day: row.diaryEntryCount3Day,
    tasksCompletedCount: row.tasksCompletedCount,
    updatedAt: row.computedAt.toISOString(),
    stale,
  };
}
