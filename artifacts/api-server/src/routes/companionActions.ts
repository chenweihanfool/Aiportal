import { Router, type Request, type Response } from "express";
import { db, companionPersonActionsTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { isAuthorized } from "../lib/adminSession";
import { parseActionBody, parsePersonName } from "../lib/companionActions";

const router = Router();

// 首頁「陪伴」的人物提醒動作（已聯絡／暫緩／不再提醒）：入口網自己的狀態，不寫回 HERMES。
router.get("/companion/person-actions", async (req: Request, res: Response) => {
  if (!isAuthorized(req.headers["x-admin-password"])) return res.status(401).json({ message: "需要解鎖私領域才能查看" });
  const rows = await db.select().from(companionPersonActionsTable);
  return res.json({
    actions: rows.map((r) => ({ name: r.name, action: r.action, until: r.until, reason: r.reason, updatedAt: r.updatedAt.toISOString() })),
  });
});

router.put("/companion/person-actions/:name", async (req: Request, res: Response) => {
  if (!isAuthorized(req.headers["x-admin-password"])) return res.status(401).json({ message: "需要管理員權限" });
  const name = parsePersonName(req.params["name"]);
  if (!name) return res.status(400).json({ message: "name 必須是 1–60 字" });
  const parsed = parseActionBody(req.body);
  if (typeof parsed === "string") return res.status(400).json({ message: parsed });
  const values = { action: parsed.action, until: parsed.until, reason: parsed.reason, updatedAt: new Date() };
  await db
    .insert(companionPersonActionsTable)
    .values({ name, ...values })
    .onConflictDoUpdate({ target: companionPersonActionsTable.name, set: values });
  return res.json({ name, action: parsed.action, until: parsed.until, reason: parsed.reason, updatedAt: values.updatedAt.toISOString() });
});

router.delete("/companion/person-actions/:name", async (req: Request, res: Response) => {
  if (!isAuthorized(req.headers["x-admin-password"])) return res.status(401).json({ message: "需要管理員權限" });
  const name = parsePersonName(req.params["name"]);
  if (!name) return res.status(400).json({ message: "name 必須是 1–60 字" });
  await db.delete(companionPersonActionsTable).where(eq(companionPersonActionsTable.name, name));
  return res.status(204).end();
});

export default router;
