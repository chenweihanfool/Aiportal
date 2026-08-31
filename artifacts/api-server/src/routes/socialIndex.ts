import { Router, type Request, type Response } from "express";
import { db, socialIndexHistoryTable } from "@workspace/db";
import { desc, isNotNull } from "drizzle-orm";
import { computeSocialIndex } from "../lib/socialIndex";
import { taipeiDateString } from "../lib/summarySources";

const router = Router();

const ADMIN_PASSWORD = process.env["ADMIN_PASSWORD"] ?? "85097110";

// Unlike mind-index (two independent pushers sharing one row), social-index
// has exactly ONE pusher — collect.ps1, ~every 10 min — so every push
// carries the full row and fully overwrites it (no partial-field
// onConflictDoUpdate needed). collect.ps1 only ever sends aggregate counts
// (it can't read social_interactions.jsonl's meaning on its own); the
// breadth/intensity/connectionRate/socialScore arithmetic happens here in
// TS via computeSocialIndex, which is what makes that math unit-testable
// (see lib/socialIndex.test.ts) instead of being duplicated in PowerShell.
router.post("/admin/social-index", async (req: Request, res: Response) => {
  const authorized = req.headers["x-admin-password"] === ADMIN_PASSWORD;
  if (!authorized) {
    return res.status(403).json({ message: "需要管理員權限" });
  }

  const body = req.body as Record<string, unknown>;
  const num = (key: string): number | undefined => (typeof body[key] === "number" ? (body[key] as number) : undefined);

  const observedDayCount = num("observedDayCount");
  if (observedDayCount === undefined) {
    return res.status(400).json({ message: "observedDayCount 為必填" });
  }
  const distinctPersonCount = num("distinctPersonCount") ?? 0;
  const weightedInteractionPoints = num("weightedInteractionPoints") ?? 0;
  const daysWithInteraction = num("daysWithInteraction") ?? 0;
  // collect.ps1 送的是已經正規化過的 person_id 字串陣列（跟 distinctPersonCount
  // 同一批資料，只是把「人數」換成「是誰」）——不是必填欄位，舊版 collect.ps1
  // 沒送這個欄位時要能照舊運作，不因此整個請求 400。
  const rawPersonNames = body["personNames"];
  const personNames = Array.isArray(rawPersonNames)
    ? rawPersonNames.filter((v): v is string => typeof v === "string")
    : null;

  const derived = computeSocialIndex({
    observedDayCount,
    distinctPersonCount,
    weightedInteractionPoints,
    daysWithInteraction,
  });

  const date = taipeiDateString(new Date());
  const row = {
    date,
    observedDayCount,
    // observedDayCount === 0 時，其他原始計數欄位一律存 null（跟
    // computeSocialIndex 回傳的三個子分數/socialScore 皆為 null 一致），不是
    // 存假的 0——見 socialIndexHistory.ts schema 註解。
    distinctPersonCount: observedDayCount > 0 ? distinctPersonCount : null,
    personNames: observedDayCount > 0 ? personNames : null,
    weightedInteractionPoints: observedDayCount > 0 ? weightedInteractionPoints : null,
    daysWithInteraction: observedDayCount > 0 ? daysWithInteraction : null,
    ...derived,
  };

  await db
    .insert(socialIndexHistoryTable)
    .values(row)
    .onConflictDoUpdate({
      target: socialIndexHistoryTable.date,
      set: { ...row, computedAt: new Date() },
    });

  return res.json({ success: true, date });
});

// Trend-line chart data for the social-index card's expanded panel — same
// private-zone password gate/shape as GET /mind-index/history.
router.get("/social-index/history", async (req: Request, res: Response) => {
  const unlocked = req.headers["x-admin-password"] === ADMIN_PASSWORD;
  if (!unlocked) {
    return res.status(403).json({ message: "需要解鎖私領域才能查看" });
  }

  const daysParam = Number(req.query["days"]);
  const days = Number.isFinite(daysParam) && daysParam > 0 ? Math.min(daysParam, 365) : 30;

  // socialScore 在 observedDayCount === 0 的日子會是 null（"資料準備中"）——
  // 過濾掉，不要把 null 畫成 0 或留一個洞，跟 mind-index/history 的做法一致。
  const rows = await db
    .select({ date: socialIndexHistoryTable.date, socialScore: socialIndexHistoryTable.socialScore })
    .from(socialIndexHistoryTable)
    .where(isNotNull(socialIndexHistoryTable.socialScore))
    .orderBy(desc(socialIndexHistoryTable.date))
    .limit(days);

  return res.json({
    history: rows.reverse().map((r) => ({ date: r.date, socialScore: r.socialScore as number })),
  });
});

export default router;
