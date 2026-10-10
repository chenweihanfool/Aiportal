import { Router, type Request, type Response } from "express";
import { db, happinessIndexHistoryTable, hermesIdeasSnapshotTable, hermesTimelineEntryTable } from "@workspace/db";
import { and, desc, eq, inArray } from "drizzle-orm";
import { isAuthorized } from "../lib/adminSession";
import { rankIdeas, sanitizeIdeasPayload } from "../lib/hermesIdeas";
import { computeIdeasMind } from "../lib/ideasMind";
import { MIND_COMBINED_SINCE } from "../lib/mindCombined";
import { loadCombinedMind } from "../lib/mindCombinedSource";
import { parseReportScore } from "../lib/reportScore";
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
  // 🧮 心智分數（幸福指數的心智維度，2026-10-10 起）＝0.8 × 想法分數 ＋ 0.2 × 最新一份日報分數。
  // mind＝想法分數的組成（今天現算）；mindCombined＝今天的合成分數（與幸福指數同一個來源）；
  // mindShadow＝近 30 天每晚 23:55 存下的想法分數與合成分數（合成分數只從 MIND_COMBINED_SINCE 起有），附當天日報分數。
  const today = taipeiDateString(new Date());
  const mind = computeIdeasMind(row.ideas, today);
  const mindCombined = await loadCombinedMind(today).catch(() => null);
  const shadowRows = await db
    .select({ date: happinessIndexHistoryTable.date, ideas: happinessIndexHistoryTable.mindIdeasRaw, mindRaw: happinessIndexHistoryTable.mindRaw })
    .from(happinessIndexHistoryTable)
    .orderBy(desc(happinessIndexHistoryTable.date))
    .limit(30);
  const dates = shadowRows.map((r) => String(r.date));
  const reportRows = dates.length
    ? await db
        .select({ date: hermesTimelineEntryTable.periodKey, bodyMd: hermesTimelineEntryTable.bodyMd })
        .from(hermesTimelineEntryTable)
        .where(and(eq(hermesTimelineEntryTable.level, "day"), inArray(hermesTimelineEntryTable.periodKey, dates)))
    : [];
  const reports = new Map<string, number>();
  for (const r of reportRows) {
    const sc = parseReportScore(r.bodyMd);
    if (sc) reports.set(r.date, sc.total);
  }
  const mindShadow = shadowRows.reverse().map((r) => ({
    date: r.date,
    ideas: r.ideas,
    report: reports.get(String(r.date)) ?? null,
    combined: String(r.date) >= MIND_COMBINED_SINCE ? r.mindRaw : null,
  }));
  return res.json({
    available: true,
    generatedAt: row.generatedAt,
    receivedAt: row.receivedAt.toISOString(),
    weakest,
    ideas,
    top,
    weeks: row.weeks,
    mind,
    mindCombined,
    mindShadow,
  });
});

export default router;
