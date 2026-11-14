import { Router, type Request, type Response } from "express";
import { db, hermesDocTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { isAuthorized } from "../lib/adminSession";
import { logger } from "../lib/logger";
import { buildInsightDetail, buildInsightList } from "../lib/insights";

// 心得（insight）：全部存在 hermes_doc（kind='insight'），不另開表。
// GET /api/insights 一次拿全部畫成樹；GET /api/insights/:id 單筆＋同脈絡時間線。契約見 docs/search-api.md。
// 內容含個人日記衍生資料 → 走跟搜尋一樣的私領域閘（isAuthorized）。
const router = Router();
const FORBIDDEN = { message: "需要解鎖私領域才能查看" };
const INSIGHT_ID_RE = /^INS-\d{4}-\d{2}-\d{2}-[0-9a-f]{8}$/;

router.get("/insights", async (req: Request, res: Response) => {
  if (!isAuthorized(req.headers["x-admin-password"])) return res.status(403).json(FORBIDDEN);
  try {
    const rows = await db
      .select({ docKey: hermesDocTable.docKey, title: hermesDocTable.title, meta: hermesDocTable.meta })
      .from(hermesDocTable)
      .where(eq(hermesDocTable.kind, "insight"));
    return res.json(buildInsightList(rows, new Date()));
  } catch (err) {
    logger.error({ err }, "insights list query failed");
    return res.status(500).json({ message: "讀取心得失敗" });
  }
});

router.get("/insights/:id", async (req: Request, res: Response) => {
  if (!isAuthorized(req.headers["x-admin-password"])) return res.status(403).json(FORBIDDEN);
  const id = String(req.params["id"] ?? "");
  if (!INSIGHT_ID_RE.test(id)) return res.status(400).json({ message: "id 必須符合 INS-YYYY-MM-DD-xxxxxxxx" });
  try {
    const rows = await db
      .select({ docKey: hermesDocTable.docKey, title: hermesDocTable.title, meta: hermesDocTable.meta, bodyMd: hermesDocTable.bodyMd })
      .from(hermesDocTable)
      .where(eq(hermesDocTable.kind, "insight"));
    const detail = buildInsightDetail(rows, id);
    if (!detail) return res.status(404).json({ message: "找不到" });
    return res.json(detail);
  } catch (err) {
    logger.error({ err }, "insight detail query failed");
    return res.status(500).json({ message: "讀取心得失敗" });
  }
});

export default router;
