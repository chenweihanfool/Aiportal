// GitHub 倉庫索引：伺服器端用 GITHUB_TOKEN（fine-grained，只給 Metadata: Read）讀 /user/repos，
// 前端只拿整理後的清單；token 不進 repo、不送前端。沒設 token＝只抓公開倉庫（status "no-key" 表示降級，仍有資料）。
// 範圍只算 owner 指定的帳號（預設 chenweihanfool），不含組織倉庫與別人的倉庫。

export interface RepoInfo {
  name: string;
  fullName: string;
  description: string | null;
  url: string;
  private: boolean;
  fork: boolean;
  archived: boolean;
  language: string | null;
  topics: string[];
  pushedAt: string | null;
  stars: number;
  openIssues: number;
  defaultBranch: string | null;
}

export type ReposResult =
  | { status: "ok"; repos: RepoInfo[]; privateIncluded: boolean }
  | { status: "error"; message: string };

const str = (v: unknown): string | null => (typeof v === "string" && v.length > 0 ? v : null);
const int = (v: unknown): number => (typeof v === "number" && Number.isFinite(v) ? v : 0);

export function parseRepo(raw: unknown): RepoInfo | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const name = str(r["name"]);
  const fullName = str(r["full_name"]);
  const url = str(r["html_url"]);
  if (!name || !fullName || !url) return null;
  return {
    name,
    fullName,
    description: str(r["description"]),
    url,
    private: r["private"] === true,
    fork: r["fork"] === true,
    archived: r["archived"] === true,
    language: str(r["language"]),
    topics: Array.isArray(r["topics"]) ? r["topics"].filter((t): t is string => typeof t === "string") : [],
    pushedAt: str(r["pushed_at"]),
    stars: int(r["stargazers_count"]),
    openIssues: int(r["open_issues_count"]),
    defaultBranch: str(r["default_branch"]),
  };
}

const PER_PAGE = 100;
const MAX_PAGES = 10; // 上限 1000 個，個人帳號綽綽有餘；避免異常分頁無窮迴圈

/** 有 token：/user/repos?affiliation=owner（含私有）；沒 token：/users/<owner>/repos（只有公開）。最後一律只留 owner 自己的倉庫。 */
export async function fetchRepos(opts: { token?: string; owner: string }, fetchImpl: typeof fetch = fetch): Promise<ReposResult> {
  const token = opts.token?.trim();
  const headers: Record<string, string> = {
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
    "User-Agent": "aiportal-repo-index",
  };
  if (token) headers["Authorization"] = `Bearer ${token}`;
  const base = token
    ? `https://api.github.com/user/repos?affiliation=owner&sort=pushed&per_page=${PER_PAGE}`
    : `https://api.github.com/users/${encodeURIComponent(opts.owner)}/repos?sort=pushed&per_page=${PER_PAGE}`;
  const repos: RepoInfo[] = [];
  try {
    for (let page = 1; page <= MAX_PAGES; page++) {
      const res = await fetchImpl(`${base}&page=${page}`, { headers, signal: AbortSignal.timeout(10_000) });
      if (!res.ok) return { status: "error", message: `HTTP ${res.status}` };
      const body: unknown = await res.json();
      if (!Array.isArray(body)) return { status: "error", message: "回應格式不符" };
      for (const item of body) {
        const repo = parseRepo(item);
        if (repo) repos.push(repo);
      }
      if (body.length < PER_PAGE) break;
    }
  } catch (e) {
    return { status: "error", message: e instanceof Error ? e.message : String(e) };
  }
  const prefix = `${opts.owner.toLowerCase()}/`;
  const mine = repos.filter((r) => r.fullName.toLowerCase().startsWith(prefix));
  return { status: "ok", repos: mine, privateIncluded: !!token };
}
