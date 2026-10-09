// 版本歷程（時間軸）用的純函式。版面照 pf-cwh 的「更新歷程」：左＝版號與日期、中＝時間軸節點、右＝標題（點開看內容）。
// 使用者 2026-10-09：「跟pf-cwh一樣 時間軸元件 日期版號左側 內容右側 可折疊」。
export interface VersionEntry { version: string; date: string; summary: string; changes: string[] }
export type ChangeType = 'major' | 'minor' | 'patch'

/** Aiportal 的版本紀錄沒有 type 欄位，依語意化版號推：x.0.0＝重大、x.y.0＝新功能、其餘＝修正 */
export function changeType(version: string): ChangeType {
  const [, minor = '0', patch = '0'] = version.replace(/^v/, '').split('.')
  if (minor === '0' && patch === '0') return 'major'
  return patch === '0' ? 'minor' : 'patch'
}

export const CHANGE_TYPE_LABEL: Record<ChangeType, string> = { major: '重大', minor: '新功能', patch: '修正' }

export function filterVersions(entries: VersionEntry[], query: string, type: ChangeType | 'all'): VersionEntry[] {
  const q = query.trim().toLowerCase()
  return entries.filter(
    (e) =>
      (type === 'all' || changeType(e.version) === type) &&
      (!q || e.version.toLowerCase().includes(q) || e.date.includes(q) || e.summary.toLowerCase().includes(q) || e.changes.some((c) => c.toLowerCase().includes(q))),
  )
}
