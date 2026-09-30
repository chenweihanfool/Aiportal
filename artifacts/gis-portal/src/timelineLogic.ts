// 時間軸的純邏輯（分組標題、列日期、一句話顯示、分頁合併、鄰近期間、分數徽章）。可單元測試，不碰 React／網路。
import type { TimelineItem, TimelineLevel } from './timelineApi'

export const LEVELS: Array<{ level: TimelineLevel; label: string }> = [
  { level: 'day', label: '日' }, { level: 'week', label: '週' }, { level: 'month', label: '月' },
  { level: 'quarter', label: '季' }, { level: 'year', label: '年' },
]
export const LEVEL_LABEL: Record<TimelineLevel, string> = { day: '日報', week: '週報', month: '月報', quarter: '季報', year: '年報' }

const WEEKDAYS = ['日', '一', '二', '三', '四', '五', '六']

export const itemKey = (it: { level: TimelineLevel; periodKey: string }) => `${it.level}/${it.periodKey}`

function parts(date: string) {
  const [y, m, d] = date.split('-').map(Number)
  return { y, m, d, dow: new Date(Date.UTC(y, m - 1, d)).getUTCDay() }
}

/** 列首的日期文字：日＝`09-28 週一`；週＝`09/22–09/28`；月／季／年＝期間名。 */
export function rowDateLabel(it: Pick<TimelineItem, 'level' | 'startDate' | 'endDate' | 'periodKey'>): string {
  if (it.level === 'day') {
    const p = parts(it.startDate)
    return `${String(p.m).padStart(2, '0')}-${String(p.d).padStart(2, '0')} 週${WEEKDAYS[p.dow]}`
  }
  if (it.level === 'week') {
    const a = parts(it.startDate); const b = parts(it.endDate)
    const f = (p: { m: number; d: number }) => `${String(p.m).padStart(2, '0')}/${String(p.d).padStart(2, '0')}`
    return `${f(a)}–${f(b)}`
  }
  return it.periodKey
}

/** sticky 分組標題：日／週依（結束日所在）月份；月／季依年；年級不分組。 */
export function groupHeader(level: TimelineLevel, it: Pick<TimelineItem, 'startDate' | 'endDate'>): string {
  if (level === 'year') return ''
  const ref = level === 'day' ? it.startDate : it.endDate
  const p = parts(ref)
  return level === 'day' || level === 'week' ? `${p.y} 年 ${p.m} 月` : `${p.y} 年`
}

export function groupItems(level: TimelineLevel, items: TimelineItem[]): Array<{ header: string; items: TimelineItem[] }> {
  const groups: Array<{ header: string; items: TimelineItem[] }> = []
  for (const it of items) {
    const header = groupHeader(level, it)
    const last = groups[groups.length - 1]
    if (last && last.header === header) last.items.push(it)
    else groups.push({ header, items: [it] })
  }
  return groups
}

/** 列表顯示的一句話：有摘要用摘要；否則明示降級狀態。 */
export function oneLine(it: Pick<TimelineItem, 'summary' | 'hasReport' | 'eventCount' | 'level'>): string {
  if (it.summary) return it.summary
  if (it.hasReport) return '（無摘要，點開看全文）'
  const none = it.level === 'day' ? '無日報' : '本期無報告'
  return it.eventCount > 0 && it.level === 'day' ? `${none} · 當日 ${it.eventCount} 件事件` : none
}

/** 分頁合併：以期間鍵去重、保持順序（先到者優先）。 */
export function mergePages(existing: TimelineItem[], incoming: TimelineItem[]): TimelineItem[] {
  const seen = new Set(existing.map(itemKey))
  return [...existing, ...incoming.filter(i => !seen.has(itemKey(i)))]
}

/** 列表為新→舊：older 是列表中的下一個、newer 是上一個。 */
export function neighbors(items: TimelineItem[], key: string): { older: TimelineItem | null; newer: TimelineItem | null } {
  const i = items.findIndex(it => itemKey(it) === key)
  if (i < 0) return { older: null, newer: null }
  return { older: items[i + 1] ?? null, newer: items[i - 1] ?? null }
}

/** 知識庫健康徽章（後端欄位仍叫 mindScore＝mind_index_history.score）：分數與色調（與儀表板的 ok／warn／concern 語意一致）。
 *  它衡量 HERMES 知識庫管線的運作（轉化率／連結／活化／節奏），不是使用者本人的狀態——幸福指數見 hhiBadge。 */
export function scoreBadge(score: number | null): { text: string; tone: 'ok' | 'warn' | 'concern' } | null {
  if (score === null || Number.isNaN(score)) return null
  return { text: score.toFixed(1), tone: score >= 90 ? 'ok' : score >= 75 ? 'warn' : 'concern' }
}

/** 幸福指數徽章：整數分數（displayed_score）；色調門檻與儀表板 hhiTone 相同（80／65／50／35）。
 *  幸福指數 v3 是「對照自己近 90 天的百分位」，分數會落在 50 上下，與知識庫健康（96–99）不是同一把尺，門檻也因此不同。 */
export type HhiTone = 'great' | 'ok' | 'warn' | 'concern' | 'crit'
export function hhiBadge(score: number | null): { text: string; tone: HhiTone } | null {
  if (score === null || Number.isNaN(score)) return null
  const tone: HhiTone = score >= 80 ? 'great' : score >= 65 ? 'ok' : score >= 50 ? 'warn' : score >= 35 ? 'concern' : 'crit'
  return { text: String(Math.round(score)), tone }
}
