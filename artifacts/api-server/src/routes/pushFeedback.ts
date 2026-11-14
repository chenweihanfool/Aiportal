import { Router, type Request, type Response } from "express";
import { db, pushFeedbackTable } from "@workspace/db";
import { and, eq, gte, sql } from "drizzle-orm";
import { isAuthorized } from "../lib/adminSession";
import {
  PUSH_FEEDBACK_DEFAULT_DAYS, PUSH_STATS_DEFAULT_DAYS, addDaysTpe, buildPushFeedback, buildPushStats,
  parsePushDays, parsePushFeedbackBody, todayTpe,
} from "../lib/pushFeedback";

// 首頁「現在用得上」卡片回饋。契約見 docs/push-feedback-api.md。
// 全部走私領域閘（isAuthorized），沒過回 403；驗證與統計在 lib/pushFeedback.ts。
const router = Router();
const FORBIDDEN = { message: "需要解鎖私領域才能查看" };

// 記錄卡片被看到／點開／標有用、晚點、沒用。shown 同一 (cardKey, forDate) 只留一筆，
// 由部分唯一索引 push_feedback_shown_uniq 保證：插入衝突就回 200 既有 id；
// 其他 action 一律新增回 201。
router.post("/push/feedback", async (req: Request, res: Response) => {
  if (!isAuthorized(req.headers["x-admin-password"])) return res.status(403).json(FORBIDDEN);
  const parsed = parsePushFeedbackBody(req.body);
  if (typeof parsed === "string") return res.status(400).json({ message: parsed });
  if (parsed.action === "shown") {
    const [inserted] = await db
      .insert(pushFeedbackTable)
      .values({ cardKey: parsed.cardKey, cardKind: parsed.cardKind, action: parsed.action, forDate: parsed.forDate })
      .onConflictDoNothing({
        target: [pushFeedbackTable.cardKey, pushFeedbackTable.forDate],
        where: sql`action = 'shown'`,
      })
      .returning({ id: pushFeedbackTable.id });
    if (inserted) return res.status(201).json({ id: inserted.id });
    const [existing] = await db
      .select({ id: pushFeedbackTable.id })
      .from(pushFeedbackTable)
      .where(and(
        eq(pushFeedbackTable.cardKey, parsed.cardKey),
        eq(pushFeedbackTable.forDate, parsed.forDate),
        eq(pushFeedbackTable.action, "shown"),
      ))
      .limit(1);
    return res.json({ id: existing!.id });
  }
  const [row] = await db
    .insert(pushFeedbackTable)
    .values({ cardKey: parsed.cardKey, cardKind: parsed.cardKind, action: parsed.action, forDate: parsed.forDate })
    .returning({ id: pushFeedbackTable.id });
  return res.status(201).json({ id: row!.id });
});

// 「沒用」的卡片永久濾掉（不受 days 限制）；今天標「晚點」的卡片收到台北 20:00。
// days 目前只驗證範圍，先不影響查詢（見文件）。
router.get("/push/feedback", async (req: Request, res: Response) => {
  if (!isAuthorized(req.headers["x-admin-password"])) return res.status(403).json(FORBIDDEN);
  const days = parsePushDays(req.query["days"], PUSH_FEEDBACK_DEFAULT_DAYS);
  if (days === null) return res.status(400).json({ message: "days 必須是 1～90 的整數" });
  const today = todayTpe(new Date());
  const [suppressedRows, laterRows] = await Promise.all([
    db
      .selectDistinct({ cardKey: pushFeedbackTable.cardKey })
      .from(pushFeedbackTable)
      .where(eq(pushFeedbackTable.action, "useless")),
    db
      .selectDistinct({ cardKey: pushFeedbackTable.cardKey })
      .from(pushFeedbackTable)
      .where(and(eq(pushFeedbackTable.action, "later"), eq(pushFeedbackTable.forDate, today))),
  ]);
  return res.json(buildPushFeedback(suppressedRows.map((r) => r.cardKey), laterRows.map((r) => r.cardKey), today));
});

// 成效統計：範圍＝for_date ≥ 今天（台北）−(days−1)。
router.get("/push/stats", async (req: Request, res: Response) => {
  if (!isAuthorized(req.headers["x-admin-password"])) return res.status(403).json(FORBIDDEN);
  const days = parsePushDays(req.query["days"], PUSH_STATS_DEFAULT_DAYS);
  if (days === null) return res.status(400).json({ message: "days 必須是 1～90 的整數" });
  const since = addDaysTpe(todayTpe(new Date()), -(days - 1));
  const inRange = gte(pushFeedbackTable.forDate, since);
  const [actionRows, kindRows, dayRows] = await Promise.all([
    db
      .select({ action: pushFeedbackTable.action, n: sql<number>`count(*)::int` })
      .from(pushFeedbackTable)
      .where(inRange)
      .groupBy(pushFeedbackTable.action),
    db
      .select({ kind: pushFeedbackTable.cardKind, action: pushFeedbackTable.action, n: sql<number>`count(*)::int` })
      .from(pushFeedbackTable)
      .where(inRange)
      .groupBy(pushFeedbackTable.cardKind, pushFeedbackTable.action),
    db
      .select({ n: sql<number>`count(distinct ${pushFeedbackTable.forDate})::int` })
      .from(pushFeedbackTable)
      .where(and(inRange, eq(pushFeedbackTable.action, "shown"))),
  ]);
  return res.json(buildPushStats(days, actionRows, kindRows, dayRows[0]?.n ?? 0));
});

export default router;
