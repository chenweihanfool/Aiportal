import { Router, type Request, type Response } from "express";
import { isAuthorized } from "../lib/adminSession";
import { fetchDeepSeek, fetchTavily } from "../lib/paidServices";
import { createStaleWhileRevalidate } from "../lib/dashboardCache";

const router = Router();

// 額度端點不需要即時：5 分鐘內共用同一份，避免每次開首頁都打第三方（也避免被限流）。
const cache = createStaleWhileRevalidate(
  async () => {
    const [deepseek, tavily] = await Promise.all([fetchDeepSeek(process.env["DEEPSEEK_API_KEY"]), fetchTavily(process.env["TAVILY_API_KEY"])]);
    return { deepseek, tavily, fetchedAt: new Date().toISOString() };
  },
  { freshMs: 5 * 60_000, maxStaleMs: 30 * 60_000 },
);

router.get("/paid-services", async (req: Request, res: Response) => {
  if (!isAuthorized(req.headers["x-admin-password"])) {
    return res.status(403).json({ message: "需要解鎖私領域才能查看" });
  }
  const { value } = await cache.get();
  return res.json(value);
});

export default router;
