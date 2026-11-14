import { Router, type Request, type Response } from "express";
import { db, pushPinTable } from "@workspace/db";
import { and, asc, eq, isNull, lte } from "drizzle-orm";
import { isAuthorized } from "../lib/adminSession";
import { todayTpe } from "../lib/pushFeedback";
import { parseDue, parsePinBody } from "../lib/pushPin";

// 「📌 需要時提醒我」的釘選。契約見 docs/push-feedback-api.md。
// 全部走私領域閘（isAuthorized），沒過回 403；驗證在 lib/pushPin.ts。
const router = Router();
const FORBIDDEN = { message: "需要解鎖私領域才能查看" };

// 建立釘選。同一 (target_kind, target_id, due_date) 已有未完成的 pin 就回 200 既有 id，
// 不重複建；否則新增回 201。查詢判斷即可，不另加唯一索引。
router.post("/push/pins", async (req: Request, res: Response) => {
  if (!isAuthorized(req.headers["x-admin-password"])) return res.status(403).json(FORBIDDEN);
  const parsed = parsePinBody(req.body);
  if (typeof parsed === "string") return res.status(400).json({ message: parsed });
  const [existing] = await db
    .select({ id: pushPinTable.id })
    .from(pushPinTable)
    .where(and(
      eq(pushPinTable.targetKind, parsed.targetKind),
      eq(pushPinTable.targetId, parsed.targetId),
      eq(pushPinTable.dueDate, parsed.dueDate),
      isNull(pushPinTable.doneAt),
    ))
    .limit(1);
  if (existing) return res.json({ id: existing.id });
  const [row] = await db
    .insert(pushPinTable)
    .values({
      targetKind: parsed.targetKind,
      targetId: parsed.targetId,
      title: parsed.title,
      href: parsed.href,
      dueDate: parsed.dueDate,
    })
    .returning({ id: pushPinTable.id });
  return res.status(201).json({ id: row!.id });
});

// 未完成的釘選。due=today 只回 due_date <= 今天（台北），最多 50 筆；
// 不帶 due 回全部，最多 200 筆。都依 due_date 舊到新、id 小到大。
router.get("/push/pins", async (req: Request, res: Response) => {
  if (!isAuthorized(req.headers["x-admin-password"])) return res.status(403).json(FORBIDDEN);
  const due = parseDue(req.query["due"]);
  if (due === null) return res.status(400).json({ message: "due 只能是 today" });
  const conditions = [isNull(pushPinTable.doneAt)];
  if (due === "today") conditions.push(lte(pushPinTable.dueDate, todayTpe(new Date())));
  const pins = await db
    .select({
      id: pushPinTable.id,
      targetKind: pushPinTable.targetKind,
      targetId: pushPinTable.targetId,
      title: pushPinTable.title,
      href: pushPinTable.href,
      dueDate: pushPinTable.dueDate,
      createdAt: pushPinTable.createdAt,
    })
    .from(pushPinTable)
    .where(and(...conditions))
    .orderBy(asc(pushPinTable.dueDate), asc(pushPinTable.id))
    .limit(due === "today" ? 50 : 200);
  return res.json({ pins });
});

// 標記完成。id 必須是正整數；不存在或已完成回 404。
router.post("/push/pins/:id/done", async (req: Request, res: Response) => {
  if (!isAuthorized(req.headers["x-admin-password"])) return res.status(403).json(FORBIDDEN);
  const raw = req.params["id"];
  // 上限＝Postgres integer 最大值；超過的 id 不可能存在，直接 400（否則查詢會丟 500 並洩出 SQL）
  if (typeof raw !== "string" || !/^[1-9]\d{0,9}$/.test(raw) || Number(raw) > 2147483647) return res.status(400).json({ message: "id 必須是正整數" });
  const [row] = await db
    .update(pushPinTable)
    .set({ doneAt: new Date() })
    .where(and(eq(pushPinTable.id, Number(raw)), isNull(pushPinTable.doneAt)))
    .returning({ id: pushPinTable.id, doneAt: pushPinTable.doneAt });
  if (!row) return res.status(404).json({ message: "找不到未完成的 pin" });
  return res.json(row);
});

export default router;
