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
  score: number | null;
  conversion: number | null;
  linkHealth: number | null;
  vitality: number | null;
  rhythm: number | null;
  rhythmTrendPct: number | null;
  partial: boolean;
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
    updatedAt: row.computedAt.toISOString(),
    stale,
  };
}
