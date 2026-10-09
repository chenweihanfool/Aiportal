// 💡 想法庫卡片與抽屜用的純函式（排序、篩選、類別徽章顏色、狀態文字）。
// 使用者 2026-10-09：系統／工作改善類也一起排名，只用徽章標出類別。
import type { IdeaItem, IdeaStatus } from './boardApi'

export const STATUS_LABEL: Record<IdeaStatus, string> = {
  new: '新想法', evaluating: '評估中', doing: '進行中', done: '已實行', shelved: '擱置', dropped: '放棄',
}
export const STATUS_ICON: Record<IdeaStatus, string> = {
  new: '💭', evaluating: '🔍', doing: '🚀', done: '✅', shelved: '🗄️', dropped: '❌',
}
const OPEN: IdeaStatus[] = ['new', 'evaluating', 'doing']
export const isOpen = (s: IdeaStatus) => OPEN.includes(s)

// 類別徽章顏色：常見類別固定色，其他類別用名稱雜湊挑一個，同一類別每次都同色。
const FIXED: Record<string, string> = {
  系統: '#5f9bf0', 工作改善: '#9b8cf0', 財務: '#e8b23d', 學習: '#4fc1c9', 創作: '#e07bb5',
  生活: '#7cc47f', 健身: '#ef7d57', 旅遊: '#3fb6a8', 社交: '#f29e4c',
}
const EXTRA = ['#8fb0e8', '#c9a0f0', '#d4c45a', '#6fd0a0', '#f08f8f', '#a6b4c8']
export function categoryColor(category: string | null): string {
  if (!category) return '#5b6270'
  const hit = Object.keys(FIXED).find((k) => category.includes(k))
  if (hit) return FIXED[hit]!
  let h = 0
  for (const ch of category) h = (h * 31 + ch.codePointAt(0)!) >>> 0
  return EXTRA[h % EXTRA.length]!
}

/** 首頁前三名：依 API 給的 top 順序取出 */
export function topIdeas(ideas: IdeaItem[], top: string[]): IdeaItem[] {
  const by = new Map(ideas.map((i) => [i.id, i]))
  return top.map((id) => by.get(id)).filter((i): i is IdeaItem => !!i)
}

/** 抽屜清單：開放中的照分數高→低，已結束的排後面（新→舊） */
export function sortForList(ideas: IdeaItem[]): IdeaItem[] {
  return [...ideas].sort((a, b) => {
    const ao = isOpen(a.status), bo = isOpen(b.status)
    if (ao !== bo) return ao ? -1 : 1
    if (ao) return (b.score ?? 0) - (a.score ?? 0) || a.id.localeCompare(b.id)
    return b.lastMentioned.localeCompare(a.lastMentioned)
  })
}

export function categoryCounts(ideas: IdeaItem[]): Array<[string, number]> {
  const m = new Map<string, number>()
  for (const i of ideas) m.set(i.category ?? '未分類', (m.get(i.category ?? '未分類') ?? 0) + 1)
  return [...m.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
}

export type StatusFilter = 'open' | 'done' | 'closed' | 'all'
export function filterIdeas(ideas: IdeaItem[], category: string | null, status: StatusFilter): IdeaItem[] {
  return ideas.filter((i) => {
    if (category && (i.category ?? '未分類') !== category) return false
    if (status === 'open') return isOpen(i.status)
    if (status === 'done') return i.status === 'done'
    if (status === 'closed') return i.status === 'shelved' || i.status === 'dropped'
    return true
  })
}

export function statusCounts(ideas: IdeaItem[]): { open: number; doing: number; done: number; total: number } {
  return {
    open: ideas.filter((i) => isOpen(i.status)).length,
    doing: ideas.filter((i) => i.status === 'doing').length,
    done: ideas.filter((i) => i.status === 'done').length,
    total: ideas.length,
  }
}

/** 1–5 的點數（價值／難度），null 顯示「—」 */
export const pips = (n: number | null) => (n === null ? '—' : '●'.repeat(n) + '○'.repeat(5 - n))

// 「複製給 HERMES」：入口網不寫入，狀態一律由 HERMES 寫進日記（docs/ideas.md 的 💡✅／🚀… 標記）。
// 使用者 2026-10-09：用 Telegram 告訴 HERMES 進度，按鈕只負責把要貼的那句話複製好。
export const STATUS_MARK: Record<Exclude<IdeaStatus, 'new'>, string> = {
  evaluating: '🔍', doing: '🚀', done: '✅', shelved: '🗄️', dropped: '❌',
}
export const STATUS_ACTION: Record<Exclude<IdeaStatus, 'new'>, string> = {
  evaluating: '評估中', doing: '開始做', done: '已實行', shelved: '擱置', dropped: '放棄',
}
/** 這筆想法可以改成哪些狀態（不含目前的、也不回到「新想法」） */
export function nextStatuses(current: IdeaStatus): Array<Exclude<IdeaStatus, 'new'>> {
  return (['done', 'doing', 'evaluating', 'shelved', 'dropped'] as const).filter((s) => s !== current)
}
/** 貼到 Telegram 給 HERMES 的一句話；第一行就是 HERMES 寫進日記時用的標記 */
export function statusMessage(idea: Pick<IdeaItem, 'id' | 'title'>, status: Exclude<IdeaStatus, 'new'>, note = ''): string {
  const line = `💡${STATUS_MARK[status]} ${idea.id}「${idea.title}」${STATUS_ACTION[status]}`
  return note.trim() ? `${line}\n${note.trim()}` : `${line}\n（請照想法庫格式寫進今天的日記）`
}
