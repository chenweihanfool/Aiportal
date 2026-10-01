// 內容層顯示用的純函式（不碰 React／DOM／網路）。

import { pathBase } from './markdownLite'

export interface SourceLine { label: string; text: string }

const SOURCE_LABEL: Record<'diary' | 'attachment' | 'other', string> = { diary: '日記', attachment: '附件', other: '其他' }

/** 來源清單的顯示列：日記只顯示日期（不提供開啟日記全文，見設計 §7）、附件顯示檔名。 */
export function describeSource(s: { type: 'diary' | 'attachment' | 'other'; path: string }): SourceLine {
  const label = SOURCE_LABEL[s.type] ?? SOURCE_LABEL.other
  if (s.type === 'other') return { label, text: s.path.replace(/\/+$/, '') }
  return { label, text: pathBase(s.path) }
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

export type AttachmentKind = 'image' | 'pdf' | 'text' | 'other'

/** 附件預覽的種類（與 api-server lib/attachmentFile.ts 的白名單一致）；'other' 不提供預覽。 */
export function attachmentKind(path: string): AttachmentKind {
  const m = /\.([A-Za-z0-9]+)$/.exec(path.trim())
  const ext = m ? m[1].toLowerCase() : ''
  if (['png', 'jpg', 'jpeg', 'gif', 'webp'].includes(ext)) return 'image'
  if (ext === 'pdf') return 'pdf'
  if (ext === 'txt' || ext === 'md') return 'text'
  return 'other'
}
