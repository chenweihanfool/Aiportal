import { Router, type Request, type Response } from "express";
import {
  db,
  happinessIndexHistoryTable,
  mindIndexHistoryTable,
  socialIndexHistoryTable,
  busynessIndexHistoryTable,
  portalSitesTable,
} from "@workspace/db";
import { asc } from "drizzle-orm";
import { isAuthorized } from "../lib/adminSession";

const router = Router();

// 個人資料備份——自架 DB 之外留一份可攜的複本。只匯出「使用者自己的歷史
// 資料」：四個每日歷史表（幸福指數/心智/社交/生活從容）+ 工具連結清單。
// 不含 HERMES 戰情室那幾張「latest 整包覆蓋、不留歷史」的操作型監控表
// （hermes_status_snapshot 等）——那些是即時運維快照，不是要長期保存的個
// 人資料，備份的意義不大；也不含任何第三方 API 憑證（.env 裡的
// VIKUNJA_API_TOKEN 等從來不在 DB 裡，不會被這支路由碰到）。
router.get("/export", async (req: Request, res: Response) => {
  const unlocked = isAuthorized(req.headers["x-admin-password"]);
  if (!unlocked) {
    return res.status(403).json({ message: "需要解鎖私領域才能匯出" });
  }

  const [happinessHistory, mindIndexHistory, socialIndexHistory, busynessIndexHistory, sites] = await Promise.all([
    db.select().from(happinessIndexHistoryTable).orderBy(asc(happinessIndexHistoryTable.date)),
    db.select().from(mindIndexHistoryTable).orderBy(asc(mindIndexHistoryTable.date)),
    db.select().from(socialIndexHistoryTable).orderBy(asc(socialIndexHistoryTable.date)),
    db.select().from(busynessIndexHistoryTable).orderBy(asc(busynessIndexHistoryTable.date)),
    db.select().from(portalSitesTable).orderBy(asc(portalSitesTable.sortOrder), asc(portalSitesTable.id)),
  ]);

  return res.json({
    exportedAt: new Date().toISOString(),
    happinessHistory,
    mindIndexHistory,
    socialIndexHistory,
    busynessIndexHistory,
    sites,
  });
});

export default router;
