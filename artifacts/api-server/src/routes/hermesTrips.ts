import { Router, type Request, type Response } from "express";
import { db, hermesTripsSnapshotTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { isAuthorized } from "../lib/adminSession";
import { sanitizeTripsPayload } from "../lib/hermesTrips";

const router = Router();

// 🧳 遊記：kb-pipeline 整份覆寫推上來（權威資料在 HERMES 端，規則見 docs/trips-api.md）。
router.post("/admin/hermes-trips", async (req: Request, res: Response) => {
  if (!isAuthorized(req.headers["x-admin-password"])) {
    return res.status(403).json({ message: "需要管理員權限" });
  }
  const parsed = sanitizeTripsPayload(req.body);
  if (typeof parsed === "string") {
    return res.status(400).json({ message: parsed });
  }
  const values = { trips: parsed.trips, generatedAt: parsed.generatedAt, receivedAt: new Date() };
  await db
    .insert(hermesTripsSnapshotTable)
    .values({ id: "latest", ...values })
    .onConflictDoUpdate({ target: hermesTripsSnapshotTable.id, set: values });
  return res.json({ success: true, trips: parsed.trips.length, skipped: parsed.skipped });
});

router.get("/hermes-trips", async (req: Request, res: Response) => {
  if (!isAuthorized(req.headers["x-admin-password"])) {
    return res.status(403).json({ message: "需要解鎖私領域才能查看" });
  }
  const [row] = await db.select().from(hermesTripsSnapshotTable).where(eq(hermesTripsSnapshotTable.id, "latest")).limit(1);
  if (!row) {
    return res.json({ available: false, trips: [], generatedAt: null, receivedAt: null });
  }
  return res.json({
    available: true,
    trips: row.trips,
    generatedAt: row.generatedAt,
    receivedAt: row.receivedAt.toISOString(),
  });
});

export default router;
