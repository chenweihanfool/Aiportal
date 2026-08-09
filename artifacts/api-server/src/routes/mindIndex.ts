import { Router, type Request, type Response } from "express";
import { db, mindIndexHistoryTable } from "@workspace/db";
import { desc } from "drizzle-orm";
import { taipeiDateString } from "../lib/summarySources";

const router = Router();

const ADMIN_PASSWORD = process.env["ADMIN_PASSWORD"] ?? "85097110";

// HERMES's daily-life-score.py POSTs here after each run — this replaced an
// earlier design where api-server read 心智指標.md directly off a NAS share
// mounted into the container. Abandoned because Docker Desktop's WSL2
// backend doesn't reliably bind-mount UNC paths (the mount "succeeds" but
// the container sees an empty directory), and the fallback of baking the
// file into the image at build time meant the score only updated on the
// next Aiportal deploy, defeating the point of a daily score. Pushing here
// instead sidesteps the whole filesystem/mount question, matching how the
// Python busyness-index service already writes straight to Postgres rather
// than api-server reading a file it produces.
router.post("/admin/mind-index", async (req: Request, res: Response) => {
  const authorized = req.headers["x-admin-password"] === ADMIN_PASSWORD;
  if (!authorized) {
    return res.status(403).json({ message: "需要管理員權限" });
  }

  const body = req.body as Record<string, unknown>;
  const score = typeof body["score"] === "number" ? body["score"] : null;
  if (score === null) {
    return res.status(400).json({ message: "score 為必填數值" });
  }
  const num = (key: string): number | null => (typeof body[key] === "number" ? (body[key] as number) : null);

  const row = {
    date: taipeiDateString(new Date()),
    score,
    conversion: num("conversion"),
    linkHealth: num("link_health"),
    vitality: num("vitality"),
    rhythm: num("rhythm"),
    rhythmTrendPct: num("rhythm_trend_pct"),
    partial: body["partial"] === true,
  };

  await db
    .insert(mindIndexHistoryTable)
    .values(row)
    .onConflictDoUpdate({
      target: mindIndexHistoryTable.date,
      set: { ...row, computedAt: new Date() },
    });

  return res.json({ success: true, date: row.date });
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

  const rows = await db
    .select({ date: mindIndexHistoryTable.date, score: mindIndexHistoryTable.score })
    .from(mindIndexHistoryTable)
    .orderBy(desc(mindIndexHistoryTable.date))
    .limit(days);

  return res.json({ history: rows.reverse() });
});

export default router;
