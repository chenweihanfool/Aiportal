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
import { desc, isNotNull } from "drizzle-orm";

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
  // 兩個獨立 pusher 各自的「最新」不同（見 routes/mindIndex.ts 的 two
  // independent pushers 註解），這裡分兩次讀，兩邊的消費者都拿最新值：
  //   - 最新 row 整體：collect.ps1 每 ~10 分鐘 partial push 擁有
  //     dailyEngagementScore/diaryEntryCount*（HHI 心智維度實際在用的）。
  //   - 最新 score 非 NULL 的 row：daily-life-score.py 每天 22:30 擁有
  //     score/conversion/...（戰情室知識庫健康度面板在用的）。
  // 2026-09-01 前這裡只取最新 row——00:00~22:30 之間讀到的永遠是「今日
  // row 但 score 還是 null」，知識庫健康度面板每天上午都顯示「資料準備
  // 中」直到晚上計分腳本跑完（讀取層的 partial pusher 掩蔽，跟
  // references 裡 DB 端那次的掩蔽同型）。
  const [latest] = await db
    .select()
    .from(mindIndexHistoryTable)
    .orderBy(desc(mindIndexHistoryTable.date))
    .limit(1);

  if (!latest) {
    throw new Error(
      "mind_index_history has no rows yet — has daily-life-score.py POSTed to /api/admin/mind-index at least once?"
    );
  }

  const [scored] = await db
    .select()
    .from(mindIndexHistoryTable)
    .where(isNotNull(mindIndexHistoryTable.score))
    .orderBy(desc(mindIndexHistoryTable.date))
    .limit(1);

  // 知識庫健康度欄位取「最新有分數」那筆；從來沒有任何 row 有過分數時
  // fallback 回最新 row（欄位自然是 null，前端照舊顯示「資料準備中」，
  // 不會為了湊數字犧牲 null 語意）。
  const kb = scored ?? latest;

  // stale 語意回歸原設計：「計分腳本（daily-life-score.py）超過 36 小時
  // 沒跑」。先前用最新 row 的 computedAt，會被 collect.ps1 每 10 分鐘的
  // partial push 不斷刷新，36h 閾值永遠不觸發——partial pusher 掩蔽。
  // kb 那筆 row 的 computedAt 是該分數日最後一次被 push 的時間，分數
  // 斷流超過一天半才會亮 stale，跟 daily cadence 對得上。
  const stale = Date.now() - kb.computedAt.getTime() > STALE_THRESHOLD_MS;

  return {
    score: kb.score,
    conversion: kb.conversion,
    linkHealth: kb.linkHealth,
    vitality: kb.vitality,
    rhythm: kb.rhythm,
    rhythmTrendPct: kb.rhythmTrendPct,
    partial: kb.partial,
    dailyEngagementScore: latest.dailyEngagementScore,
    diaryEntryCount: latest.diaryEntryCount,
    diaryEntryCount3Day: latest.diaryEntryCount3Day,
    tasksCompletedCount: latest.tasksCompletedCount,
    updatedAt: latest.computedAt.toISOString(),
    stale,
  };
}
