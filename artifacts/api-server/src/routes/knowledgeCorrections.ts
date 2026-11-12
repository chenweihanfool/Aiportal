import { Router, type Request, type Response } from "express";
import { db, knowledgeCorrectionsTable } from "@workspace/db";
import { asc, gt } from "drizzle-orm";
import { isAuthorized } from "../lib/adminSession";
import { parseAfter, parseCorrectionBody } from "../lib/knowledgeCorrections";

const router = Router();
const LIST_LIMIT = 500;

// 使用者對知識頁某一條的更正（不對／改寫／補一句／撤回）：只新增、不修改、不刪除；
// 撤回也是新增一筆 undo。入口網不主動寫回知識庫，管線帶管理密碼來 GET。
type CorrectionRow = typeof knowledgeCorrectionsTable.$inferSelect;

function toJson(r: CorrectionRow) {
  return { id: r.id, topicId: r.topicId, claimId: r.claimId, kind: r.kind, section: r.section, text: r.text, createdAt: r.createdAt.toISOString() };
}

router.get("/knowledge/corrections", async (req: Request, res: Response) => {
  if (!isAuthorized(req.headers["x-admin-password"])) return res.status(401).json({ message: "需要管理員權限" });
  const after = parseAfter(req.query["after"]);
  if (typeof after === "string") return res.status(400).json({ message: after });
  const rows = await db
    .select()
    .from(knowledgeCorrectionsTable)
    .where(gt(knowledgeCorrectionsTable.id, after))
    .orderBy(asc(knowledgeCorrectionsTable.id))
    .limit(LIST_LIMIT);
  return res.json({ corrections: rows.map(toJson) });
});

router.post("/knowledge/corrections", async (req: Request, res: Response) => {
  if (!isAuthorized(req.headers["x-admin-password"])) return res.status(401).json({ message: "需要管理員權限" });
  const parsed = parseCorrectionBody(req.body);
  if (typeof parsed === "string") return res.status(400).json({ message: parsed });
  const [row] = await db.insert(knowledgeCorrectionsTable).values(parsed).returning();
  return res.status(201).json(toJson(row!));
});

export default router;
