// 內容層顯示用的純函式（不碰 React／DOM／網路）。

/** 事件正文裡的 Obsidian wikilink 在入口網站點不了，先降級成可讀的純文字：
 *    ![[附件/圖 1.jpg]]        → 📎 圖 1.jpg
 *    [[日記/2026-09-04.md]]    → 日記 2026-09-04
 *    [[X/事件名.md|別名]]       → 別名
 *    [[事件名]]                → 事件名
 *  （附件預覽之後的版本才會開放；此版先顯示檔名，不假裝能點。） */
export function softenWikilinks(md: string): string {
  return md
    .replace(/!\[\[([^\]]+)\]\]/g, (_m, inner: string) => `📎 ${base(inner.split('|')[0])}`)
    .replace(/\[\[([^\]]+)\]\]/g, (_m, inner: string) => {
      const [target, alias] = inner.split('|')
      if (alias && alias.trim()) return alias.trim()
      if (target.startsWith('日記/')) return `日記 ${base(target)}`
      return base(target)
    })
}

function base(path: string): string {
  const name = path.trim().split('/').filter(Boolean).pop() ?? path.trim()
  return name.replace(/\.md$/i, '')
}

export interface SourceLine { label: string; text: string }

const SOURCE_LABEL: Record<'diary' | 'attachment' | 'other', string> = { diary: '日記', attachment: '附件', other: '其他' }

/** 來源清單的顯示列：日記只顯示日期（不提供開啟日記全文，見設計 §7）、附件顯示檔名。 */
export function describeSource(s: { type: 'diary' | 'attachment' | 'other'; path: string }): SourceLine {
  const label = SOURCE_LABEL[s.type] ?? SOURCE_LABEL.other
  if (s.type === 'other') return { label, text: s.path.replace(/\/+$/, '') }
  return { label, text: base(s.path) }
}

/** 事件正文常有「## 來源」段（L3 規定的 wikilink 清單）；內容分頁底下已有結構化的來源列，
 *  這段重複，就從正文拿掉。只拿掉標題為「來源」的二級標題段，其他段落原樣保留。 */
export function stripSourceSection(md: string): string {
  const out: string[] = []
  let skipping = false
  for (const line of md.split('\n')) {
    if (/^##\s*來源\s*$/.test(line)) { skipping = true; continue }
    if (skipping && /^##\s/.test(line)) skipping = false
    if (!skipping) out.push(line)
  }
  return out.join('\n').replace(/\n{3,}/g, '\n\n').trim()
}
