import { Router, type Request, type Response } from "express";
import { db, portalSitesTable } from "@workspace/db";
import { isNotNull, asc } from "drizzle-orm";
import { isAuthorized } from "../lib/adminSession";

const router = Router();

interface SiteLink {
  label: string;
  url: string;
}

interface ApiSite {
  id: string;
  name: string;
  subtitle: string;
  links: SiteLink[];
  worldXZ: [number, number];
  isPrivate: boolean;
  subsystemId: string | null;
}

function toApiSite(row: typeof portalSitesTable.$inferSelect): ApiSite {
  return {
    id: String(row.id),
    name: row.name,
    subtitle: row.subtitle,
    links: (row.links ?? []) as SiteLink[],
    worldXZ: [row.worldX, row.worldZ],
    isPrivate: row.isPrivate,
    subsystemId: row.subsystemId,
  };
}

// 2026-10-22：手動維護的「工具連結」（公領域／私領域）拿掉，入口改由 GitHub 倉庫索引（/api/github/repos）取代。
// portal_sites 只剩一個用途：六個面向對應的子系統連結（有 subsystem_id 的列，例如人生進度、健身追蹤、任務追蹤），
// 顯示在首頁面向卡與面向頁。所以：
//   ・只回有 subsystem_id 的列；
//   ・要解鎖才給（以前不用解鎖就能讀到私領域子系統的網址）；未解鎖回空清單（不是 403，前端照常載入）；
//   ・新增／編輯／刪除端點（/sites*、/admin/sites*）與預設資料灌入都已移除，資料表與既有資料原封不動（不需 schema 同步）。
router.get("/sites", async (req: Request, res: Response) => {
  if (!isAuthorized(req.headers["x-admin-password"])) {
    res.json({ sites: [] });
    return;
  }
  const rows = await db
    .select()
    .from(portalSitesTable)
    .where(isNotNull(portalSitesTable.subsystemId))
    .orderBy(asc(portalSitesTable.sortOrder), asc(portalSitesTable.id));
  res.json({ sites: rows.map(toApiSite) });
});

export default router;
