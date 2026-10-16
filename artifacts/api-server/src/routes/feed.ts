import { Router, type Request, type Response } from "express";
import { db, feedSnapshotTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { isAuthorized } from "../lib/adminSession";
import { validateFeedRequest } from "../lib/feedValidate";
import { FEED_NAME, FEED_REGISTRY } from "../feeds/registry";

const router = Router();

// 泛用 feed（P1-7）：新資料先走這裡。整份覆寫；格式與登記方式見 feeds/registry.ts、docs/feed-api.md。
router.post("/admin/feed/:name", async (req: Request, res: Response) => {
  if (!isAuthorized(req.headers["x-admin-password"])) {
    return res.status(403).json({ message: "需要管理員權限" });
  }
  const check = validateFeedRequest(req.params["name"], req.body);
  if (!check.ok) return res.status(check.status).json({ message: check.message });
  const name = req.params["name"] as string;
  const values = { version: check.version, payload: check.payload, generatedAt: check.generatedAt, receivedAt: new Date() };
  await db.insert(feedSnapshotTable).values({ name, ...values }).onConflictDoUpdate({ target: feedSnapshotTable.name, set: values });
  return res.json({ success: true, name, version: check.version });
});

router.get("/feed/:name", async (req: Request, res: Response) => {
  if (!isAuthorized(req.headers["x-admin-password"])) {
    return res.status(403).json({ message: "需要解鎖私領域才能查看" });
  }
  const name = req.params["name"];
  if (typeof name !== "string" || !FEED_NAME.test(name)) return res.status(400).json({ message: "feed 名稱不合法" });
  if (!Object.prototype.hasOwnProperty.call(FEED_REGISTRY, name)) return res.status(404).json({ message: `沒有登記這種 feed：${name}` });
  const [row] = await db.select().from(feedSnapshotTable).where(eq(feedSnapshotTable.name, name)).limit(1);
  if (!row) return res.json({ available: false, name, schemaVersion: FEED_REGISTRY[name]!.version, payload: null, generatedAt: null, receivedAt: null });
  return res.json({
    available: true, name, schemaVersion: row.version, payload: row.payload,
    generatedAt: row.generatedAt, receivedAt: row.receivedAt.toISOString(),
  });
});

export default router;
