// GitHub 倉庫快取：/api/github/repos 與 /api/search（kind=repo）共用同一份。
// 30 分鐘內共用同一份（GitHub 未驗證請求每小時只有 60 次）。抓取失敗時，快取會保留舊資料（見 createStaleWhileRevalidate）。
// 模組層只建立快取物件，不觸發抓取；第一次呼叫 get() 才抓。
import { createStaleWhileRevalidate } from "./dashboardCache";
import { fetchRepos, type ReposResult } from "./githubRepos";

export const GITHUB_REPO_OWNER = process.env["GITHUB_REPO_OWNER"] || "chenweihanfool";

export const githubReposCache = createStaleWhileRevalidate(
  async (): Promise<ReposResult & { fetchedAt: string }> => {
    const r = await fetchRepos({ token: process.env["GITHUB_TOKEN"], owner: GITHUB_REPO_OWNER });
    if (r.status === "error") throw new Error(r.message);
    return { ...r, fetchedAt: new Date().toISOString() };
  },
  { freshMs: 30 * 60_000, maxStaleMs: 6 * 60 * 60_000 },
);
