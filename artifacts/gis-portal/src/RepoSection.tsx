import { useMemo, useState } from 'react'
import type { ReposData } from './repoApi'
import { DEFAULT_FILTER, filterRepos, languageCounts, pushedLabel, repoStats, sortRepos, type RepoFilter } from './repoView'
import { Skeleton, StateFrame } from './StateFrame'
import type { BlockStatus } from './homeView'

// ⑤ 倉庫索引（2026-10-22 使用者要求）：伺服器抓 GitHub，這裡只負責搜尋、篩選與顯示。私有倉庫名稱屬個資，整區要解鎖才看得到。
const PAGE = 12

export function ReposSection({ st, data, now, onRequestUnlock, onRetry }: {
  st: BlockStatus
  data: ReposData | null
  now: Date
  onRequestUnlock: () => void
  onRetry: () => void
}) {
  const [filter, setFilter] = useState<RepoFilter>(DEFAULT_FILTER)
  const [shown, setShown] = useState(PAGE)
  const set = (patch: Partial<RepoFilter>) => { setFilter((f) => ({ ...f, ...patch })); setShown(PAGE) }

  const repos = data?.repos ?? []
  const stats = useMemo(() => repoStats(repos), [repos])
  const list = useMemo(() => sortRepos(filterRepos(repos, filter)), [repos, filter])
  const langs = useMemo(() => languageCounts(repos, filter), [repos, filter])

  return (
    <section id="sec-repos" className="hm-card hm-repos" aria-label="倉庫索引">
      <h2 className="hm-h">倉庫索引
        <span className="hm-h-right">
          {data && <span>{data.owner}・{stats.total} 個{stats.private > 0 ? `（私有 ${stats.private}）` : ''}</span>}
          <a className="hm-link" href={`https://github.com/${data?.owner ?? ''}?tab=repositories`} target="_blank" rel="noreferrer">GitHub →</a>
        </span>
      </h2>
      <StateFrame status={st} source="GitHub 倉庫" onRequestUnlock={onRequestUnlock} onRetry={onRetry} skeleton={<Skeleton lines={3} />}
        empty="帳號下還沒有倉庫。">
        <div className="hm-repos-body">
          {data && !data.privateIncluded && (
            <p className="hm-note hm-note--bad" role="status">目前只顯示公開倉庫：伺服器還沒設定 GITHUB_TOKEN，私有倉庫抓不到。</p>
          )}
          <div className="hm-repos-tools">
            <input type="search" className="hm-repos-q" placeholder="搜尋名稱、描述、主題…" value={filter.query} aria-label="搜尋倉庫"
              onChange={(e) => set({ query: e.target.value })} />
            <label className="hm-check"><input type="checkbox" checked={filter.privateOnly} onChange={(e) => set({ privateOnly: e.target.checked })} />只看私有</label>
            <label className="hm-check"><input type="checkbox" checked={filter.showArchived} onChange={(e) => set({ showArchived: e.target.checked })} />含封存{stats.archived ? `（${stats.archived}）` : ''}</label>
            <label className="hm-check"><input type="checkbox" checked={filter.showForks} onChange={(e) => set({ showForks: e.target.checked })} />含 fork{stats.forks ? `（${stats.forks}）` : ''}</label>
          </div>
          {langs.length > 1 && (
            <div className="hm-repos-langs" role="group" aria-label="語言篩選">
              <button type="button" className="hm-pill" data-on={filter.language === null ? 'true' : undefined} onClick={() => set({ language: null })}>全部</button>
              {langs.map((l) => (
                <button key={l.language} type="button" className="hm-pill" data-on={filter.language === l.language ? 'true' : undefined}
                  onClick={() => set({ language: filter.language === l.language ? null : l.language })}>{l.language} <i>{l.count}</i></button>
              ))}
            </div>
          )}
          {list.length === 0 ? (
            <p className="hm-note">沒有符合的倉庫。</p>
          ) : (
            <ul className="hm-repo-grid">
              {list.slice(0, shown).map((r) => (
                <li key={r.fullName}>
                  <a className="hm-repo" href={r.url} target="_blank" rel="noreferrer" title={r.description ?? r.name}>
                    <span className="hm-repo-name">{r.private && <span aria-label="私有">🔒 </span>}{r.name}{r.archived && <span className="hm-chip"> 封存</span>}{r.fork && <span className="hm-chip"> fork</span>}</span>
                    <span className="hm-repo-desc">{r.description ?? '（沒有描述）'}</span>
                    <span className="hm-repo-meta">
                      {r.language && <span>{r.language}</span>}
                      <span>推送 {pushedLabel(r.pushedAt, now)}</span>
                      {r.openIssues > 0 && <span>Issue {r.openIssues}</span>}
                    </span>
                  </a>
                </li>
              ))}
            </ul>
          )}
          {list.length > shown && (
            <button type="button" className="hm-link hm-repos-more" onClick={() => setShown((n) => n + PAGE)}>再顯示 {Math.min(PAGE, list.length - shown)} 個（共 {list.length}）</button>
          )}
        </div>
      </StateFrame>
    </section>
  )
}
