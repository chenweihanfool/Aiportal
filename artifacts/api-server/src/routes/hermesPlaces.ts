import { Router, type Request, type Response } from "express";
import { db, hermesPlacesSnapshotTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { isAuthorized } from "../lib/adminSession";
import { sanitizePlacesPayload } from "../lib/hermesPlaces";

const router = Router();

// 🍜 美食及旅遊地圖：kb-pipeline 整份覆寫推上來（權威資料在 HERMES 端，規則見 docs/places-api.md）。
router.post("/admin/hermes-places", async (req: Request, res: Response) => {
  if (!isAuthorized(req.headers["x-admin-password"])) {
    return res.status(403).json({ message: "需要管理員權限" });
  }
  const parsed = sanitizePlacesPayload(req.body);
  if (typeof parsed === "string") {
    return res.status(400).json({ message: parsed });
  }
  const values = { places: parsed.places, generatedAt: parsed.generatedAt, receivedAt: new Date() };
  await db
    .insert(hermesPlacesSnapshotTable)
    .values({ id: "latest", ...values })
    .onConflictDoUpdate({ target: hermesPlacesSnapshotTable.id, set: values });
  return res.json({ success: true, places: parsed.places.length, skipped: parsed.skipped });
});

router.get("/hermes-places", async (req: Request, res: Response) => {
  if (!isAuthorized(req.headers["x-admin-password"])) {
    return res.status(403).json({ message: "需要解鎖私領域才能查看" });
  }
  const [row] = await db.select().from(hermesPlacesSnapshotTable).where(eq(hermesPlacesSnapshotTable.id, "latest")).limit(1);
  if (!row) {
    return res.json({ available: false, places: [], generatedAt: null, receivedAt: null });
  }
  return res.json({
    available: true,
    places: row.places,
    generatedAt: row.generatedAt,
    receivedAt: row.receivedAt.toISOString(),
  });
});

export default router;
