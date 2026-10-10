import { Router, type Request, type Response } from "express";
import { db, happinessIndexHistoryTable, hermesIdeasSnapshotTable, hermesTimelineEntryTable } from "@workspace/db";
import { and, desc, eq, inArray } from "drizzle-orm";
import { isAuthorized } from "../lib/adminSession";
import { rankIdeas, sanitizeIdeasPayload } from "../lib/hermesIdeas";
import { computeIdeasMind } from "../lib/ideasMind";
import { combineMind } from "../lib/mindCombined";
import { parseReportScore, type ReportScore } from "../lib/reportScore";
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
  // 🧮 合成版（並行中）：每日報告分數直接從時間軸已存的日報全文解析（日報 22:00 產出、隔天 05:00 才推上來，所以最新一天常常還沒有）
  const dates = shadowRows.map((r) => String(r.date));
  const reportRows = dates.length
    ? await db
        .select({ date: hermesTimelineEntryTable.periodKey, bodyMd: hermesTimelineEntryTable.bodyMd })
        .from(hermesTimelineEntryTable)
        .where(and(eq(hermesTimelineEntryTable.level, "day"), inArray(hermesTimelineEntryTable.periodKey, dates)))
    : [];
  const reports = new Map<string, ReportScore>();
  for (const r of reportRows) {
    const s = parseReportScore(r.bodyMd);
    if (s) reports.set(r.date, s);
  }
  const mindShadow = shadowRows.reverse().map((r) => {
    const report = reports.get(String(r.date))?.total ?? null;
    return { date: r.date, ideas: r.ideas, diary: r.diary, report, combined: combineMind(r.ideas, report) };
  });
  const latest = [...mindShadow].reverse().find((d) => d.report !== null);
  const mindReport = latest ? { date: String(latest.date), ...reports.get(String(latest.date))! } : null;
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
    mindReport,
  });
});

export default router;
