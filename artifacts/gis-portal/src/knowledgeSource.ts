// 知識頁「來源可追溯」的小工具（2.77.0）：型別徽章、腳註摘錄對位、命中分段、原檔開法。純函式，有測試（knowledgeSource.test.ts）。
import type { HermesTopicQuote } from './hermesDocApi'
import type { SourceType } from './knowledgeView'

export interface SourceBadge { icon: string; label: string }

const BADGES: Record<SourceType, SourceBadge> = {
  pdf: { icon: '📄', label: 'PDF' },
  word: { icon: '📝', label: 'Word' },
  excel: { icon: '📊', label: 'Excel' },
  image: { icon: '🖼', label: '圖' },
  text: { icon: '📃', label: '文字檔' },
  diary: { icon: '📓', label: '日記' },
  note: { icon: '🗒', label: '筆記' },
  event: { icon: '🤖', label: 'AI 整理' },
  other: { icon: '📎', label: '其他' },
}

export function sourceBadge(type: string | null | undefined): SourceBadge {
  return (type && BADGES[type as SourceType]) || BADGES.other
}

/**
 * 本文第 k 個 ⟦n⟧ 對應的摘錄。只在 quotes[k].ref === n 時採用——本文被截斷或改寫後序號會錯位，錯位就寧可不顯示。
 * 找不到、或 text 為 null 都回 null。
 */
export function quoteFor(quotes: readonly HermesTopicQuote[] | null | undefined, k: number, ref: number): HermesTopicQuote | null {
  const q = quotes?.[k]
  if (!q || q.ref !== ref || !q.text) return null
  return q
}

export interface TextSegment { text: string; hit: boolean }

/** 依區間（highlightRanges 的輸出，已排序不重疊）把文字切成命中／非命中段 */
export function splitByRanges(text: string, ranges: ReadonlyArray<readonly [number, number]>): TextSegment[] {
  const out: TextSegment[] = []
  let pos = 0
  for (const [a, b] of ranges) {
    if (a > pos) out.push({ text: text.slice(pos, a), hit: false })
    out.push({ text: text.slice(a, b), hit: true })
    pos = b
  }
  if (pos < text.length) out.push({ text: text.slice(pos), hit: false })
  return out
}

/** pdf 和圖片在新分頁開；其他類型下載 */
export function rawOpenMode(rawPath: string): 'open' | 'download' {
  return /\.(pdf|png|jpe?g|gif|webp)$/i.test(rawPath) ? 'open' : 'download'
}
