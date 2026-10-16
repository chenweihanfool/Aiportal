// 節點詳情的「時間軸」分頁與「敘事」分頁用的純函式（不碰 React／DOM／網路）。

export interface TimelineRow {
  id: string
  /** YYYY-MM-DD；空字串＝日期不明（伺服端補不出來，不拿假日期冒充） */
  date: string
  title: string
  status: string | null
  /** 事件所屬案件名（案件節點自己的時間軸不需要顯示） */
  case: string | null
  /** HH:mm（台北，與 date 同一天才有）；舊版 API 沒帶＝null */
  time?: string | null
  /** 日期是補出來的（寫進日記那天或被萃取那天），不是 Events 檔頭寫的：畫面加「~」 */
  dateApprox?: boolean
  /** 時間是萃取時刻（日記那行沒有時戳）：畫面加「~」 */
  timeApprox?: boolean
}

export const UNDATED = '未註明日期'
export interface MonthGroup { month: string; rows: TimelineRow[] }

/** 圖譜事件節點 → 時間軸列。日期不是 YYYY-MM-DD（例如舊資料的字串 "null"）一律當作日期不明，畫面不會印出 "null"。 */
export function toTimelineRow(ev: {
  id: string; date: string; title: string; status: string | null; case: string | null
  dateSource?: 'frontmatter' | 'diary' | 'extracted' | 'none'; time?: string | null; timeSource?: 'diary' | 'extracted' | null
}): TimelineRow {
  const ok = /^\d{4}-\d{2}-\d{2}$/.test(ev.date)
  return {
    id: ev.id, date: ok ? ev.date : '', title: ev.title, status: ev.status, case: ev.case,
    time: ok && ev.time ? ev.time : null,
    dateApprox: ok && (ev.dateSource === 'diary' || ev.dateSource === 'extracted'),
    timeApprox: ok && !!ev.time && ev.timeSource === 'extracted',
  }
}

/** 事件列依「由新到舊」排序（同日先比時間，再依標題，結果穩定）。日期不明的排最後。 */
export function sortNewestFirst(rows: readonly TimelineRow[]): TimelineRow[] {
  return [...rows].sort((a, b) =>
    b.date.localeCompare(a.date) || (b.time ?? '').localeCompare(a.time ?? '') || a.title.localeCompare(b.title))
}

/** 日期欄的兩行文字：上＝日期（補出來的加「~」；日期不明＝「—」），下＝時間（萃取時刻加「~」；沒有就不顯示）。 */
export function rowDateLabel(r: TimelineRow): { date: string; time: string | null; title: string } {
  const date = r.date ? `${r.dateApprox ? '~' : ''}${r.date}` : '—'
  const time = r.time ? `${r.timeApprox ? '~' : ''}${r.time}` : null
  const why = !r.date ? '日期不明：檔頭沒有日期，也沒有日記時戳或萃取時間可以補'
    : r.dateApprox ? '日期是補的（事件原文沒有明確日期），取自寫進日記或被萃取的那天'
    : r.timeApprox ? '時間是被萃取的時刻（日記那行沒有時戳）' : '寫進日記的時間'
  return { date, time, title: why }
}

// ── 月份分組的折疊（比照遊記：先展開最新的、其餘收起來，要看再點）────────────────────────────

/** 預設展開哪幾組：最新有日期的那個月；全都沒有日期時展開第一組。「未註明日期」預設收起，除非它是唯一一組。 */
export function defaultOpenMonths(groups: readonly MonthGroup[]): string[] {
  const dated = groups.find(g => g.month !== UNDATED)
  if (dated) return [dated.month]
  return groups.length > 0 ? [groups[0]!.month] : []
}

/** 收起來的那一組給一行預覽：前 n 個標題（不用展開就知道大概是什麼）。 */
export function monthDigest(g: MonthGroup, n = 2): string {
  const titles = g.rows.slice(0, n).map(r => r.title.trim()).filter(Boolean)
  const more = g.rows.length - titles.length
  return titles.join(' · ') + (more > 0 && titles.length > 0 ? ` …等 ${g.rows.length} 筆` : '')
}

/** 依月份分組（輸入須已由新到舊排序）；日期不是 YYYY-MM-DD 的歸到「未註明日期」。 */
export function groupByMonth(rows: readonly TimelineRow[]): MonthGroup[] {
  const groups: MonthGroup[] = []
  for (const r of rows) {
    const month = /^\d{4}-\d{2}/.test(r.date) ? r.date.slice(0, 7) : UNDATED
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
 *  舊敘事（單行長段）靠啟發式整理；L5 新格式（標題行＋縮排子 bullet，pusher 以換行傳送）逐行對應，不再猜。 */
export function parseNarrative(text: string): ParsedNarrative {
  const links: string[] = []
  const protectedText = text.replace(/\[\[[^\]]+\]\]/g, m => { links.push(m); return `\u0000${links.length - 1}\u0000` })
  const restore = (s: string) => s.replace(/\u0000(\d+)\u0000/g, (_m, i: string) => links[Number(i)] ?? '')
  // L5 結構化格式（標題行＋子 bullet，以換行分隔）：一行就是一條，不再依句號切；舊格式（單行長段）才用標點切
  const structured = protectedText.includes('\n')
  const sentences = protectedText
    .split(structured ? /\n+/ : /[。；;]\s*|\n+/)
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
