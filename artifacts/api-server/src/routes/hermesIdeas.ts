import { Router, type Request, type Response } from "express";
import { db, happinessIndexHistoryTable, hermesIdeasSnapshotTable } from "@workspace/db";
import { desc, eq } from "drizzle-orm";
import { isAuthorized } from "../lib/adminSession";
import { rankIdeas, sanitizeIdeasPayload } from "../lib/hermesIdeas";
import { computeIdeasMind } from "../lib/ideasMind";
import { taipeiDateString } from "../lib/summarySources";

const router = Router();

// 💡 想法庫：kb-pipeline 的 ideas-pusher 每個 L1 班次整份覆寫推上來（權威資料在 HERMES 端）。
router.post("/admin/hermes-ideas", async (req: Request, res: Response) => {
  if (!isAuthorized(req.headers["x-admin-password"])) {
    return res.status(403).json({ message: "需要管理員權限" });
  }
  const parsed = sanitizeIdeasPayload(req.body);
  if (typeof parsed === "string") {
    return res.status(400).json({ message: parsed });
  }
  const values = { ideas: parsed.ideas, weeks: parsed.weeks, generatedAt: parsed.generatedAt, receivedAt: new Date() };
  await db
    .insert(hermesIdeasSnapshotTable)
    .values({ id: "latest", ...values })
    .onConflictDoUpdate({ target: hermesIdeasSnapshotTable.id, set: values });
  return res.json({ success: true, ideas: parsed.ideas.length });
});

router.get("/hermes-ideas", async (req: Request, res: Response) => {
  if (!isAuthorized(req.headers["x-admin-password"])) {
    return res.status(403).json({ message: "需要解鎖私領域才能查看" });
  }
  const [row] = await db.select().from(hermesIdeasSnapshotTable).where(eq(hermesIdeasSnapshotTable.id, "latest")).limit(1);
  if (!row) {
    return res.json({ available: false, ideas: [], top: [], weeks: [], weakest: null, generatedAt: null, receivedAt: null, mind: null, mindShadow: [] });
  }
  // 補短板：幸福指數最近一天的最弱維度（入口網自己算的，HERMES 不知道）
  const [hhi] = await db
    .select({ weakest: happinessIndexHistoryTable.weakestComponent })
    .from(happinessIndexHistoryTable)
    .orderBy(desc(happinessIndexHistoryTable.date))
    .limit(1);
  const weakest = hhi?.weakest ?? null;
  const { ideas, top } = rankIdeas(row.ideas, weakest);
  // 💡 心智分數（想法版，第四期並行中）：今天現算＋近 30 天每晚 23:55 存下的值，旁邊附舊版（日記篇數）原始分數對照
  const mind = computeIdeasMind(row.ideas, taipeiDateString(new Date()));
  const shadowRows = await db
    .select({ date: happinessIndexHistoryTable.date, ideas: happinessIndexHistoryTable.mindIdeasRaw, diary: happinessIndexHistoryTable.mindRaw })
    .from(happinessIndexHistoryTable)
    .orderBy(desc(happinessIndexHistoryTable.date))
    .limit(30);
  const mindShadow = shadowRows.reverse().map((r) => ({ date: r.date, ideas: r.ideas, diary: r.diary }));
  return res.json({
    available: true,
    generatedAt: row.generatedAt,
    receivedAt: row.receivedAt.toISOString(),
    weakest,
    ideas,
    top,
    weeks: row.weeks,
    mind,
    mindShadow,
  });
});

export default router;
