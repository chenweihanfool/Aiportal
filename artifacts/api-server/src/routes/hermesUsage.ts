import { Router, type Request, type Response } from "express";
import { db, hermesUsageDailyTable, ollamaBalanceEntryTable } from "@workspace/db";
import { desc } from "drizzle-orm";
import { isAuthorized } from "../lib/adminSession";
import { taipeiDateString } from "../lib/summarySources";
import { forecastOllama, sanitizeBalance, sanitizeUsageDays, shouldSkipAutoBalance } from "../lib/usageForecast";

const router = Router();

// HERMES 的 pusher 每 10 分鐘推「最近幾十天的每日聚合」，整列覆寫（任何一天漏推下一輪會補上）。
router.post("/admin/hermes-usage", async (req: Request, res: Response) => {
  if (!isAuthorized(req.headers["x-admin-password"])) {
    return res.status(403).json({ message: "需要管理員權限" });
  }
  const days = sanitizeUsageDays((req.body as Record<string, unknown> | undefined)?.["days"]);
  if (days.length === 0) {
    return res.status(400).json({ message: "days 為空或格式不符，未寫入" });
  }
  for (const d of days) {
    await db
      .insert(hermesUsageDailyTable)
      .values({ date: d.date, models: d.models })
      .onConflictDoUpdate({ target: hermesUsageDailyTable.date, set: { models: d.models, computedAt: new Date() } });
  }
  return res.json({ success: true, days: days.length });
});

// Ollama 餘額快照：HERMES 的 pusher 讀 ollama.com GET /api/balance 後推來（note＝"auto"），
// 使用者手動輸入當備援。auto 且沒變化的推送不寫入（見 shouldSkipAutoBalance）。
router.post("/admin/ollama-balance", async (req: Request, res: Response) => {
  if (!isAuthorized(req.headers["x-admin-password"])) {
    return res.status(403).json({ message: "需要管理員權限" });
  }
  const parsed = sanitizeBalance(req.body);
  if (typeof parsed === "string") {
    return res.status(400).json({ message: parsed });
  }
  const [prev] = await db.select().from(ollamaBalanceEntryTable).orderBy(desc(ollamaBalanceEntryTable.enteredAt)).limit(1)
  if (shouldSkipAutoBalance(parsed, prev ? { ...prev, enteredAt: prev.enteredAt.toISOString() } : null, new Date())) {
    return res.json({ success: true, skipped: true })
  }
  const [row] = await db
    .insert(ollamaBalanceEntryTable)
    .values({ balanceUsd: parsed.balanceUsd, capUsd: parsed.capUsd, refillAt: parsed.refillAt, monthUsedUsd: parsed.monthUsedUsd, note: parsed.note })
    .returning();
  return res.json({ success: true, id: row?.id ?? null });
});

router.get("/hermes-usage", async (req: Request, res: Response) => {
  if (!isAuthorized(req.headers["x-admin-password"])) {
    return res.status(403).json({ message: "需要解鎖私領域才能查看" });
  }

  const dayRows = await db.select().from(hermesUsageDailyTable).orderBy(desc(hermesUsageDailyTable.date)).limit(31);
  const entryRows = await db.select().from(ollamaBalanceEntryTable).orderBy(desc(ollamaBalanceEntryTable.enteredAt)).limit(20);

  const days = dayRows.reverse().map((r) => {
    const models = r.models ?? {};
    const calls = Object.values(models).reduce((s, m) => s + (m?.calls ?? 0), 0);
    return { date: r.date, calls, models };
  });
  const entries = entryRows.reverse(); // 舊→新
  const latest = entries.length ? entries[entries.length - 1]! : null;

  // 近 7 個已結束日的各模型請求數（圖表用）；今天另外標出來讓前端知道還沒過完
  const today = taipeiDateString(new Date());
  const perModel: Record<string, number> = {};
  for (const d of days.filter((x) => x.date < today).slice(-7)) {
    for (const [name, m] of Object.entries(d.models)) perModel[name] = (perModel[name] ?? 0) + (m?.calls ?? 0);
  }

  const forecast = forecastOllama({
    days: days.map((d) => ({ date: d.date, calls: d.calls })),
    entries: entries.map((e) => ({ enteredAt: e.enteredAt.toISOString(), balanceUsd: e.balanceUsd })),
    refillAt: latest?.refillAt ?? null,
    today,
  });

  return res.json({
    available: days.length > 0 || entries.length > 0,
    today,
    days: days.map((d) => ({ date: d.date, calls: d.calls })),
    last7Days: perModel,
    balance: latest
      ? { enteredAt: latest.enteredAt.toISOString(), balanceUsd: latest.balanceUsd, capUsd: latest.capUsd, refillAt: latest.refillAt, monthUsedUsd: latest.monthUsedUsd, note: latest.note }
      : null,
    entries: entries.map((e) => ({ enteredAt: e.enteredAt.toISOString(), balanceUsd: e.balanceUsd })),
    forecast,
    // 前端要誠實標示：請求數只含 HERMES 這台 VPS，金額與餘額來自帳號快照（自動抓取或手動輸入，看 balance.note）
    scope: "請求數只含 HERMES 這台 VPS 發出的；Ollama 帳號的餘額與金額來自 ollama.com 餘額快照（note＝auto 為自動抓取，否則為手動輸入）",
  });
});

export default router;
