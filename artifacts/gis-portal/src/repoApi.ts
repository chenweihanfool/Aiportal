// 倉庫索引 API（api-server 的 /api/github/repos；token 只在伺服器端，這裡拿到的是整理好的清單）。
const API_BASE = import.meta.env.BASE_URL ?? '/'

export interface RepoItem {
  name: string
  fullName: string
  description: string | null
  url: string
  /** 倉庫 About 欄位的網站（部署出來的工具網址）；沒填是 null */
  homepage: string | null
  private: boolean
  fork: boolean
  archived: boolean
  language: string | null
  topics: string[]
  pushedAt: string | null
  stars: number
  openIssues: number
  defaultBranch: string | null
}

export interface ReposData {
  status: 'ok'
  repos: RepoItem[]
  /** 有設 GITHUB_TOKEN 才抓得到私有倉庫；false＝只有公開的 */
  privateIncluded: boolean
  fetchedAt: string
  owner: string
  ageSec: number
  stale: boolean
}

export async function apiFetchRepos(pw: string): Promise<ReposData> {
  const r = await fetch(`${API_BASE}api/github/repos`, { headers: { 'x-admin-password': pw } })
  if (!r.ok) throw new Error('Failed to fetch repos')
  return r.json() as Promise<ReposData>
}
