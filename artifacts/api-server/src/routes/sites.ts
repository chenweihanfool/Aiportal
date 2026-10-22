import { Router, type Request, type Response, type NextFunction } from "express";
import { db, portalSitesTable } from "@workspace/db";
import { isNotNull, asc } from "drizzle-orm";
import { ADMIN_PASSWORD } from "../lib/adminPassword";
import { createSession, isAuthorized } from "../lib/adminSession";

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

// 缺 body（沒帶 Content-Type: application/json，Express 會給 undefined）或 body 不是物件時回 400，
// 而不是在解構時丟 TypeError 變成 500。
function requireJsonObjectBody(req: Request, res: Response, next: NextFunction): void {
  const b: unknown = req.body;
  if (typeof b !== "object" || b === null || Array.isArray(b)) {
    res.status(400).json({ error: "Invalid body" });
    return;
  }
  next();
}

// 這支是「憑密碼換 token」的唯一入口——body 裡的 password 必須是真正的
// ADMIN_PASSWORD，不接受 isAuthorized()（那會連既有 token 都放行，失去
// 「憑證換發」這一步本身要驗證的意義）。前端的 apiVerifyPassword 現在打
// 這支（原本沒被用到，長期是死路由——真正在用的解鎖流程繞去打
// /api/dashboard 探測 unlocked 欄位），換回一個有效期的 session token 存
// 進 localStorage，不再是密碼原文。
router.post("/auth/verify", requireJsonObjectBody, (req: Request, res: Response) => {
  const { password } = req.body as { password?: string };
  if (password === ADMIN_PASSWORD) {
    const { token, expiresAt } = createSession();
    res.json({ ok: true, token, expiresAt });
  } else {
    res.status(401).json({ ok: false, error: "Wrong password" });
  }
});

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
