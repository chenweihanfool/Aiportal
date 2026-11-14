import { Router, type Request, type Response } from "express";
import { isAuthorized } from "../lib/adminSession";
import { GITHUB_REPO_OWNER, githubReposCache } from "../lib/githubReposCache";

const router = Router();

// 私有倉庫名稱本身是個資：整個端點要解鎖才能讀（與 paid-services 一致）。
router.get("/github/repos", async (req: Request, res: Response) => {
  if (!isAuthorized(req.headers["x-admin-password"])) {
    return res.status(403).json({ message: "需要解鎖私領域才能查看" });
  }
  try {
    const { value, ageSec, stale } = await githubReposCache.get();
    return res.json({ ...value, owner: GITHUB_REPO_OWNER, ageSec, stale });
  } catch (e) {
    return res.status(502).json({ status: "error", message: e instanceof Error ? e.message : "GitHub 無法連線" });
  }
});

export default router;
