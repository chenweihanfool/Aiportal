import { describe, expect, it } from 'vitest'
import { changeType, filterVersions } from './versionHistoryView'

const e = (version: string, summary = 's', changes: string[] = []) => ({ version, date: '2026-10-09', summary, changes })

describe('versionHistoryView', () => {
  it('derives the change type from the semantic version', () => {
    expect(changeType('3.0.0')).toBe('major')
    expect(changeType('2.27.0')).toBe('minor')
    expect(changeType('2.26.1')).toBe('patch')
    expect(changeType('v1.2.0')).toBe('minor')
  })
  it('filters by type and by query across version, summary and changes', () => {
    const list = [e('3.0.0', '大改版'), e('2.27.0', '心智分數', ['想法庫並行']), e('2.26.1', '複製按鈕')]
    expect(filterVersions(list, '', 'minor').map((x) => x.version)).toEqual(['2.27.0'])
    expect(filterVersions(list, '想法庫', 'all').map((x) => x.version)).toEqual(['2.27.0'])
    expect(filterVersions(list, '2.26', 'all').map((x) => x.version)).toEqual(['2.26.1'])
    expect(filterVersions(list, '  ', 'all')).toHaveLength(3)
  })
})
