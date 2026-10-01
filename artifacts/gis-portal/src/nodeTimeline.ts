// 節點詳情的「時間軸」分頁與「敘事」分頁用的純函式（不碰 React／DOM／網路）。

export interface TimelineRow {
  id: string
  date: string
  title: string
  status: string | null
  /** 事件所屬案件名（案件節點自己的時間軸不需要顯示） */
  case: string | null
}

export interface MonthGroup { month: string; rows: TimelineRow[] }

/** 事件列依「由新到舊」排序（同日依標題，結果穩定）。 */
export function sortNewestFirst(rows: readonly TimelineRow[]): TimelineRow[] {
  return [...rows].sort((a, b) => b.date.localeCompare(a.date) || a.title.localeCompare(b.title))
}

/** 依月份分組（輸入須已由新到舊排序）；日期不是 YYYY-MM-DD 的歸到「未註明日期」。 */
export function groupByMonth(rows: readonly TimelineRow[]): MonthGroup[] {
  const groups: MonthGroup[] = []
  for (const r of rows) {
    const month = /^\d{4}-\d{2}/.test(r.date) ? r.date.slice(0, 7) : '未註明日期'
    const last = groups[groups.length - 1]
    if (last && last.month === month) last.rows.push(r)
    else groups.push({ month, rows: [r] })
  }
  return groups
}

// ── L5 敘事：把一整坨文字拆成有結構的內容 ──────────────────────────────────────

export interface NarrativeItem { label: string | null; text: string }
export interface ParsedNarrative { headline: string; items: NarrativeItem[] }

const LABEL_RE = /^([^：:，,；;（）()\u0000]{2,14})[：:]\s*(.+)$/s

/** 敘事文字（L5 編織／警報）拆成「標題句＋條列」：
 *  - 以「。」「；」與換行切句，句內的 [[wikilink]] 先保護起來（連結名稱裡的標點不會被切開）；
 *  - 第一句沒有「標籤：」就當標題；
 *  - 形如「履約期品質管控：……」的句子，標籤獨立出來（標籤不得以數字開頭，避免把「10:30」當標籤）。
 *  純前端的啟發式整理——不改 L5 的輸出；L5 若之後改成固定格式，這裡自然更準。 */
export function parseNarrative(text: string): ParsedNarrative {
  const links: string[] = []
  const protectedText = text.replace(/\[\[[^\]]+\]\]/g, m => { links.push(m); return `\u0000${links.length - 1}\u0000` })
  const restore = (s: string) => s.replace(/\u0000(\d+)\u0000/g, (_m, i: string) => links[Number(i)] ?? '')
  const sentences = protectedText
    .split(/[。；;]\s*|\n+/)
    .map(s => s.trim())
    .filter(Boolean)
  const items: NarrativeItem[] = sentences.map(s => {
    const m = LABEL_RE.exec(s)
    if (m && !/^\d/.test(m[1].trim()) && !/^[\d\s:.-]+$/.test(m[1])) return { label: restore(m[1].trim()), text: restore(m[2].trim()) }
    return { label: null, text: restore(s) }
  })
  if (items.length > 0 && items[0].label === null) return { headline: items[0].text, items: items.slice(1) }
  return { headline: '', items }
}
