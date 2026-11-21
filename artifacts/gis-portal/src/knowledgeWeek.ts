// 知識庫這週的明細（3.20.0）：把 STATUS 列上的「+N 頁・+M 句」與「你的更正」攤成可看的清單。
// 純邏輯、無 React；數字規則必須與 statusAside 的 knowledgeWeek／userCorrections 一致，抽屜內容在 KnowledgeWeekPanel.tsx。
import { changesByDay, isFresh, type Topic } from './knowledgeView'
import { userCorrections } from './statusAside'

/** 畫面上顯示的句子：去掉開頭的項目符號、⟦n⟧ 來源標記，前後 trim */
export function cleanClaimText(text: string): string {
  return text.replace(/^[-*]\s+/, '').replace(/⟦\d+⟧/g, '').trim()
}

export interface WeekTopicRow { id: string; name: string; kind: Topic['kind']; date: string; detail: string }
export interface WeekClaimGroup { id: string; name: string; kind: Topic['kind']; claims: Array<{ id: string; text: string; firstSeen: string }> }
export interface KnowledgeWeekDetail { pages: WeekTopicRow[]; revised: WeekTopicRow[]; claimGroups: WeekClaimGroup[]; totals: { pages: number; claims: number } }

const desc = (a: string, b: string): number => (a < b ? 1 : a > b ? -1 : 0)
const asc = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0)

/** 近 days 天（預設 7）的明細：新頁、改版（同題只留最新一天）、新長出的句子；totals 與 knowledgeWeek 同一套規則 */
export function knowledgeWeekDetail(topics: readonly Topic[], now: Date, days = 7): KnowledgeWeekDetail {
  // changesByDay 已是新→舊、日內 new-page 在前，直接照順序攤平就是新→舊
  const pages: WeekTopicRow[] = []
  const revised: WeekTopicRow[] = []
  const seenRevised = new Set<string>()
  for (const d of changesByDay(topics, now, days)) {
    for (const it of d.items) {
      const row: WeekTopicRow = { id: it.topic.id, name: it.topic.name, kind: it.topic.kind, date: d.date, detail: it.detail }
      if (it.change === 'new-page') pages.push(row)
      else if (it.change === 'revised' && !seenRevised.has(it.topic.id)) {
        seenRevised.add(it.topic.id)
        revised.push(row)
      }
    }
  }

  const claimGroups: WeekClaimGroup[] = []
  for (const t of topics) {
    const claims = (t.claims ?? [])
      .filter((c) => isFresh(c, now, days))
      .map((c) => ({ id: c.id, text: cleanClaimText(c.text), firstSeen: c.firstSeen }))
      .sort((a, b) => desc(a.firstSeen, b.firstSeen))
    if (claims.length > 0) claimGroups.push({ id: t.id, name: t.name, kind: t.kind, claims })
  }
  // 句數多→少、同數依題名
  claimGroups.sort((a, b) => b.claims.length - a.claims.length || asc(a.name, b.name))

  return {
    pages,
    revised,
    claimGroups,
    totals: { pages: pages.length, claims: claimGroups.reduce((s, g) => s + g.claims.length, 0) },
  }
}

export interface CorrectionGroup { id: string; name: string; kind: Topic['kind']; claims: Array<{ id: string; text: string; lastChanged: string; disputed: boolean }> }
export interface CorrectionDetail { total: number; groups: CorrectionGroup[]; missingText: boolean }

/** 你的更正明細：origin==='user' 的句子，組內與組間都依 lastChanged 新→舊；total 與 userCorrections 一致 */
export function userCorrectionDetail(topics: readonly Topic[]): CorrectionDetail {
  const groups: CorrectionGroup[] = []
  for (const t of topics) {
    const claims = (t.claims ?? [])
      .filter((c) => c.origin === 'user')
      .map((c) => ({ id: c.id, text: c.text, lastChanged: c.lastChanged, disputed: c.status === 'disputed' }))
      .sort((a, b) => desc(a.lastChanged, b.lastChanged))
    if (claims.length > 0) groups.push({ id: t.id, name: t.name, kind: t.kind, claims })
  }
  groups.sort((a, b) => desc(a.claims[0]!.lastChanged, b.claims[0]!.lastChanged))
  const total = userCorrections(topics)
  return { total, groups, missingText: total > 0 && groups.length === 0 }
}
