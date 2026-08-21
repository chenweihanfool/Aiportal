import { Router, type Request, type Response } from "express";
import { db, mindIndexHistoryTable } from "@workspace/db";
import { desc, isNotNull } from "drizzle-orm";
import { taipeiDateString } from "../lib/summarySources";

const router = Router();

const ADMIN_PASSWORD = process.env["ADMIN_PASSWORD"] ?? "85097110";

// Two independent pushers share this one endpoint, each owning a disjoint
// set of fields, neither required to send the other's:
//   - HERMES's daily-life-score.py, once a day: score/conversion/linkHealth/
//     vitality/rhythm/rhythmTrendPct/partial (知識庫健康度，顯示用，不計入 HHI)
//   - services/hermes-status/collect.ps1, every ~10 min: dailyEngagementScore/
//     diaryEntryCount (HHI 心智維度實際在用的分數)
// Whichever pushes first for a given date creates the row (score nullable
// specifically so collect.ps1's frequent partial push doesn't need to wait
// for daily-life-score.py to have run first); whichever pushes second only
// touches its own fields via onConflictDoUpdate's partial `set`, never
// clobbering the other's already-written values back to null.
//
// This replaced an earlier design where api-server read 心智指標.md directly
// off a NAS share mounted into the container. Abandoned because Docker
// Desktop's WSL2 backend doesn't reliably bind-mount UNC paths (the mount
// "succeeds" but the container sees an empty directory), and the fallback of
// baking the file into the image at build time meant the score only updated
// on the next Aiportal deploy, defeating the point of a daily score. Pushing
// here instead sidesteps the whole filesystem/mount question, matching how
// the Python busyness-index service already writes straight to Postgres
// rather than api-server reading a file it produces.
router.post("/admin/mind-index", async (req: Request, res: Response) => {
  const authorized = req.headers["x-admin-password"] === ADMIN_PASSWORD;
  if (!authorized) {
    return res.status(403).json({ message: "需要管理員權限" });
  }

  const body = req.body as Record<string, unknown>;
  const num = (key: string): number | undefined => (typeof body[key] === "number" ? (body[key] as number) : undefined);

  const fields: Partial<typeof mindIndexHistoryTable.$inferInsert> = {};
  const score = num("score");
  if (score !== undefined) fields.score = score;
  const conversion = num("conversion");
  if (conversion !== undefined) fields.conversion = conversion;
  const linkHealth = num("link_health");
  if (linkHealth !== undefined) fields.linkHealth = linkHealth;
  const vitality = num("vitality");
  if (vitality !== undefined) fields.vitality = vitality;
  const rhythm = num("rhythm");
  if (rhythm !== undefined) fields.rhythm = rhythm;
  const rhythmTrendPct = num("rhythm_trend_pct");
  if (rhythmTrendPct !== undefined) fields.rhythmTrendPct = rhythmTrendPct;
  if (typeof body["partial"] === "boolean") fields.partial = body["partial"];
  const dailyEngagementScore = num("dailyEngagementScore");
  if (dailyEngagementScore !== undefined) fields.dailyEngagementScore = dailyEngagementScore;
  const diaryEntryCount = num("diaryEntryCount");
  if (diaryEntryCount !== undefined) fields.diaryEntryCount = diaryEntryCount;
  const diaryEntryCount3Day = num("diaryEntryCount3Day");
  if (diaryEntryCount3Day !== undefined) fields.diaryEntryCount3Day = diaryEntryCount3Day;
  const tasksCompletedCount = num("tasksCompletedCount");
  if (tasksCompletedCount !== undefined) fields.tasksCompletedCount = tasksCompletedCount;

  if (Object.keys(fields).length === 0) {
    return res.status(400).json({ message: "至少要提供一個欄位" });
  }

  const date = taipeiDateString(new Date());

  await db
    .insert(mindIndexHistoryTable)
    .values({ date, ...fields })
    .onConflictDoUpdate({
      target: mindIndexHistoryTable.date,
      set: { ...fields, computedAt: new Date() },
    });

  return res.json({ success: true, date });
});

// Trend-line chart data for the mind-index card's expanded panel — same
// private-zone password gate and shape as /api/happiness/history.
router.get("/mind-index/history", async (req: Request, res: Response) => {
  const unlocked = req.headers["x-admin-password"] === ADMIN_PASSWORD;
  if (!unlocked) {
    return res.status(403).json({ message: "需要解鎖私領域才能查看" });
  }

  const daysParam = Number(req.query["days"]);
  const days = Number.isFinite(daysParam) && daysParam > 0 ? Math.min(daysParam, 365) : 30;

  // score 現在 nullable（collect.ps1 每 10 分鐘的 partial push 可能先建立
  // 一筆還沒有知識庫分數的當天 row）——這條趨勢線是知識庫健康度専用的，過濾
  // 掉還沒有分數的天數，不要把 null 畫成 0 或留一個洞。
  const rows = await db
    .select({ date: mindIndexHistoryTable.date, score: mindIndexHistoryTable.score })
    .from(mindIndexHistoryTable)
    .where(isNotNull(mindIndexHistoryTable.score))
    .orderBy(desc(mindIndexHistoryTable.date))
    .limit(days);

  return res.json({ history: rows.reverse().map((r) => ({ date: r.date, score: r.score as number })) });
});

export default router;
