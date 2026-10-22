import { Router, type Request, type Response } from "express";
import { isAuthorized } from "../lib/adminSession";
import { fetchRepos, type ReposResult } from "../lib/githubRepos";
import { createStaleWhileRevalidate } from "../lib/dashboardCache";

const router = Router();

const OWNER = process.env["GITHUB_REPO_OWNER"] || "chenweihanfool";

// 30 分鐘內共用同一份（GitHub 未驗證請求每小時只有 60 次）。抓取失敗時，快取會保留舊資料（見 createStaleWhileRevalidate）。
const cache = createStaleWhileRevalidate(
  async (): Promise<ReposResult & { fetchedAt: string }> => {
    const r = await fetchRepos({ token: process.env["GITHUB_TOKEN"], owner: OWNER });
    if (r.status === "error") throw new Error(r.message);
    return { ...r, fetchedAt: new Date().toISOString() };
  },
  { freshMs: 30 * 60_000, maxStaleMs: 6 * 60 * 60_000 },
);

// 私有倉庫名稱本身是個資：整個端點要解鎖才能讀（與 paid-services 一致）。
router.get("/github/repos", async (req: Request, res: Response) => {
  if (!isAuthorized(req.headers["x-admin-password"])) {
    return res.status(403).json({ message: "需要解鎖私領域才能查看" });
  }
  try {
    const { value, ageSec, stale } = await cache.get();
    return res.json({ ...value, owner: OWNER, ageSec, stale });
  } catch (e) {
    return res.status(502).json({ status: "error", message: e instanceof Error ? e.message : "GitHub 無法連線" });
  }
});

export default router;
