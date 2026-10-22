// 倉庫索引的純函式（篩選、排序、語言統計、時間標籤）；元件只負責畫。
import type { RepoItem } from './repoApi'

export interface RepoFilter {
  query: string
  /** null＝全部語言；NO_LANGUAGE＝沒有偵測到語言的倉庫 */
  language: string | null
  showArchived: boolean
  showForks: boolean
  privateOnly: boolean
}

export const NO_LANGUAGE = '(無語言)'
export const DEFAULT_FILTER: RepoFilter = { query: '', language: null, showArchived: false, showForks: false, privateOnly: false }

const lang = (r: RepoItem) => r.language ?? NO_LANGUAGE

/** 搜尋比對名稱、描述、主題、語言；多個詞用空白分開，全部要命中（不分大小寫）。 */
function matchesQuery(r: RepoItem, query: string): boolean {
  const terms = query.toLowerCase().split(/\s+/).filter(Boolean)
  if (terms.length === 0) return true
  const hay = [r.name, r.description ?? '', r.language ?? '', ...r.topics].join('\n').toLowerCase()
  return terms.every((t) => hay.includes(t))
}

export function filterRepos(repos: readonly RepoItem[], f: RepoFilter): RepoItem[] {
  return repos.filter((r) =>
    (f.showArchived || !r.archived) &&
    (f.showForks || !r.fork) &&
    (!f.privateOnly || r.private) &&
    (f.language === null || lang(r) === f.language) &&
    matchesQuery(r, f.query),
  )
}

/** 最近推送在前；沒有推送時間的排最後；同時間依名稱，結果穩定。 */
export function sortRepos(repos: readonly RepoItem[]): RepoItem[] {
  const t = (r: RepoItem) => (r.pushedAt ? Date.parse(r.pushedAt) : -Infinity)
  return [...repos].sort((a, b) => t(b) - t(a) || a.name.localeCompare(b.name))
}

/** 語言膠囊：依倉庫數由多到少；語言篩選的數字跟著其他篩選（封存、fork、私有）走，但不受語言本身影響。 */
export function languageCounts(repos: readonly RepoItem[], f: RepoFilter): Array<{ language: string; count: number }> {
  const m = new Map<string, number>()
  for (const r of filterRepos(repos, { ...f, language: null })) m.set(lang(r), (m.get(lang(r)) ?? 0) + 1)
  return [...m.entries()].map(([language, count]) => ({ language, count })).sort((a, b) => b.count - a.count || a.language.localeCompare(b.language))
}

export function repoStats(repos: readonly RepoItem[]): { total: number; private: number; archived: number; forks: number } {
  return {
    total: repos.length,
    private: repos.filter((r) => r.private).length,
    archived: repos.filter((r) => r.archived).length,
    forks: repos.filter((r) => r.fork).length,
  }
}

/** 「今天」「3 天前」「2 個月前」「1 年前」；沒有時間或時間在未來（時鐘誤差）回「—」／「今天」。 */
export function pushedLabel(iso: string | null, now: Date): string {
  if (!iso) return '—'
  const ms = Date.parse(iso)
  if (!Number.isFinite(ms)) return '—'
  const days = Math.floor((now.getTime() - ms) / 86_400_000)
  if (days < 1) return '今天'
  if (days < 30) return `${days} 天前`
  if (days < 365) return `${Math.floor(days / 30)} 個月前`
  return `${Math.floor(days / 365)} 年前`
}
