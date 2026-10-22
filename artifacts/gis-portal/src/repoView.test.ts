import { describe, expect, it } from 'vitest'
import type { RepoItem } from './repoApi'
import { DEFAULT_FILTER, NO_LANGUAGE, filterRepos, languageCounts, pushedLabel, repoStats, sortRepos } from './repoView'

const repo = (name: string, over: Partial<RepoItem> = {}): RepoItem => ({
  name, fullName: `chenweihanfool/${name}`, description: null, url: `https://github.com/chenweihanfool/${name}`, private: false, fork: false, archived: false,
  language: null, topics: [], pushedAt: null, stars: 0, openIssues: 0, defaultBranch: 'main', ...over,
})

describe('filterRepos', () => {
  const repos = [
    repo('Aiportal', { language: 'TypeScript', description: '入口網', topics: ['dashboard'] }),
    repo('kb-pipeline', { language: 'Python', private: true }),
    repo('old', { archived: true, language: 'Python' }),
    repo('forked', { fork: true }),
  ]
  it('hides archived and forks by default', () => {
    expect(filterRepos(repos, DEFAULT_FILTER).map((r) => r.name)).toEqual(['Aiportal', 'kb-pipeline'])
  })
  it('shows them when asked', () => {
    expect(filterRepos(repos, { ...DEFAULT_FILTER, showArchived: true, showForks: true })).toHaveLength(4)
  })
  it('matches every term across name, description, topics and language, ignoring case', () => {
    expect(filterRepos(repos, { ...DEFAULT_FILTER, query: 'AIPORTAL 入口' }).map((r) => r.name)).toEqual(['Aiportal'])
    expect(filterRepos(repos, { ...DEFAULT_FILTER, query: 'dashboard' })).toHaveLength(1)
    expect(filterRepos(repos, { ...DEFAULT_FILTER, query: 'python' }).map((r) => r.name)).toEqual(['kb-pipeline'])
    expect(filterRepos(repos, { ...DEFAULT_FILTER, query: 'aiportal python' })).toHaveLength(0)
  })
  it('filters by language, including repos without one', () => {
    expect(filterRepos(repos, { ...DEFAULT_FILTER, language: 'Python' }).map((r) => r.name)).toEqual(['kb-pipeline'])
    expect(filterRepos(repos, { ...DEFAULT_FILTER, language: NO_LANGUAGE, showForks: true }).map((r) => r.name)).toEqual(['forked'])
  })
  it('filters private only', () => {
    expect(filterRepos(repos, { ...DEFAULT_FILTER, privateOnly: true }).map((r) => r.name)).toEqual(['kb-pipeline'])
  })
})

describe('sortRepos', () => {
  it('puts the most recent push first, no-push last, ties by name', () => {
    const out = sortRepos([repo('b'), repo('a'), repo('new', { pushedAt: '2026-10-20T00:00:00Z' }), repo('old', { pushedAt: '2026-01-01T00:00:00Z' })])
    expect(out.map((r) => r.name)).toEqual(['new', 'old', 'a', 'b'])
  })
  it('does not mutate the input', () => {
    const input = [repo('b'), repo('a')]
    sortRepos(input)
    expect(input.map((r) => r.name)).toEqual(['b', 'a'])
  })
})

describe('languageCounts', () => {
  it('counts under the other filters but ignores the language filter itself', () => {
    const repos = [repo('a', { language: 'Python' }), repo('b', { language: 'Python' }), repo('c', { language: 'TypeScript' }), repo('d'), repo('x', { language: 'Go', archived: true })]
    expect(languageCounts(repos, { ...DEFAULT_FILTER, language: 'TypeScript' })).toEqual([
      { language: 'Python', count: 2 }, { language: NO_LANGUAGE, count: 1 }, { language: 'TypeScript', count: 1 },
    ])
  })
})

describe('repoStats', () => {
  it('counts totals', () => {
    expect(repoStats([repo('a', { private: true }), repo('b', { archived: true }), repo('c', { fork: true })])).toEqual({ total: 3, private: 1, archived: 1, forks: 1 })
  })
})

describe('pushedLabel', () => {
  const now = new Date('2026-10-22T00:00:00Z')
  it('formats days, months and years', () => {
    expect(pushedLabel('2026-10-22T00:00:00Z', now)).toBe('今天')
    expect(pushedLabel('2026-10-19T00:00:00Z', now)).toBe('3 天前')
    expect(pushedLabel('2026-08-01T00:00:00Z', now)).toBe('2 個月前')
    expect(pushedLabel('2024-10-01T00:00:00Z', now)).toBe('2 年前')
  })
  it('handles missing, invalid and future times', () => {
    expect(pushedLabel(null, now)).toBe('—')
    expect(pushedLabel('nope', now)).toBe('—')
    expect(pushedLabel('2026-12-01T00:00:00Z', now)).toBe('今天')
  })
})
