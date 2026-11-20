import { Router, type Request, type Response } from "express";
import { db, insightWeaveVerdictsTable } from "@workspace/db";
import { asc, gt } from "drizzle-orm";
import { isAuthorized } from "../lib/adminSession";
import { parseAfter, parseVerdictBody } from "../lib/insightWeave";

// 心得編織層（insight-weave）的使用者判斷：只新增、不修改、不刪除；撤回也是新增一筆 undo。
// 入口網不主動寫回知識庫，管線帶管理密碼來 GET／POST。契約見 docs/insight-weave-api.md。
// 路由掛在 /insights/weave/verdicts（兩段），不會被 /insights/:id 吃掉。
const router = Router();
const LIST_LIMIT = 500;

type VerdictRow = typeof insightWeaveVerdictsTable.$inferSelect;

function toJson(r: VerdictRow) {
  return { id: r.id, itemId: r.itemId, verdict: r.verdict, createdAt: r.createdAt.toISOString() };
}

router.get("/insights/weave/verdicts", async (req: Request, res: Response) => {
  if (!isAuthorized(req.headers["x-admin-password"])) return res.status(401).json({ message: "需要管理員權限" });
  const after = parseAfter(req.query["after"]);
  if (typeof after === "string") return res.status(400).json({ message: after });
  const rows = await db
    .select()
    .from(insightWeaveVerdictsTable)
    .where(gt(insightWeaveVerdictsTable.id, after))
    .orderBy(asc(insightWeaveVerdictsTable.id))
    .limit(LIST_LIMIT);
  return res.json({ verdicts: rows.map(toJson) });
});

router.post("/insights/weave/verdicts", async (req: Request, res: Response) => {
  if (!isAuthorized(req.headers["x-admin-password"])) return res.status(401).json({ message: "需要管理員權限" });
  const parsed = parseVerdictBody(req.body);
  if (typeof parsed === "string") return res.status(400).json({ message: parsed });
  const [row] = await db.insert(insightWeaveVerdictsTable).values(parsed).returning();
  return res.status(201).json(toJson(row!));
});

export default router;
