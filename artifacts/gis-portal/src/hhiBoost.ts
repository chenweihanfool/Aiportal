// 幸福觸發 1（3.4.0）：最弱面向推播卡。純函式，不碰 DOM、不發網路。
// 規則見任務單 hhi-boost：六面向（不含財務）今天最低的一面 < 60 分時，推一張對症的「boost」卡，
// 把分數從「結果」變成「推什麼」的開關。社交點名該聯絡的人、心智找你上次低潮時寫下的心得，其餘用陪伴區塊的建議句。
import { MOVES, visibleQuietPeople, type CompanionData, type PersonAction } from './companion'
import type { HhiHistoryPoint } from './boardApi'
import type { HhiRow } from './boardView'
import type { Insight } from './insightTree'
import { RANK, cardKeyOf, type NowCard } from './nowCards'

/** 最弱面向低於這個分數才推卡 */
export const BOOST_THRESHOLD = 60

/** 財務主要看市場、權重又最大，留著會天天推它，不列入（與 companion.ts 的 bestMove 一致） */
const EXCLUDED_KEY = 'lifeFreedom'

/** 六面向裡分數最低的一列；財務、沒有分數的列不算。同分取 rows 中先出現的；最低值 ≥ 門檻回 null */
export function weakestDimension(rows: HhiRow[]): HhiRow | null {
  let best: HhiRow | null = null
  let bestValue = Number.POSITIVE_INFINITY
  for (const r of rows) {
    if (r.key === EXCLUDED_KEY || r.value === null || !Number.isFinite(r.value)) continue
    if (r.value < bestValue) { best = r; bestValue = r.value }
  }
  return best !== null && bestValue < BOOST_THRESHOLD ? best : null
}

/** 今天以前、該面向分數最低的 25%（至少 1 天）當「低潮日」集合；優先 components[dimKey]，沒有就用 displayedScore */
function lowDays(history: readonly HhiHistoryPoint[], dimKey: string, today: string): Set<string> {
  const scored: Array<{ date: string; score: number }> = []
  for (const h of history) {
    if (h.date >= today) continue
    const score = h.components?.[dimKey] ?? h.displayedScore
    if (!Number.isFinite(score)) continue
    scored.push({ date: h.date, score })
  }
  if (scored.length === 0) return new Set()
  scored.sort((a, b) => a.score - b.score)
  const n = Math.max(1, Math.ceil(scored.length * 0.25))
  return new Set(scored.slice(0, n).map((x) => x.date))
}

/** 低潮日裡最新的一則心得（date、time、id 由新到舊）；沒有回 null */
export function lowDayInsight(insights: Insight[], history: HhiHistoryPoint[], dimKey: string, today: string): Insight | null {
  const low = lowDays(history, dimKey, today)
  if (low.size === 0) return null
  const picked = insights.filter((i) => low.has(i.date))
  if (picked.length === 0) return null
  picked.sort((a, b) =>
    (a.date < b.date ? 1 : a.date > b.date ? -1 : 0)
    || ((a.time ?? '') < (b.time ?? '') ? 1 : (a.time ?? '') > (b.time ?? '') ? -1 : 0)
    || (a.id < b.id ? 1 : a.id > b.id ? -1 : 0))
  return picked[0] ?? null
}

export interface BoostInput {
  rows: HhiRow[]
  history: HhiHistoryPoint[]
  insights: Insight[] | null
  companion: CompanionData | null
  personActions: PersonAction[] | null
  today: string
}

/** 今天最弱的一面做成推播卡；沒有可用面向或最低值 ≥ 門檻回 null */
export function boostCard({ rows, history, insights, companion, personActions, today }: BoostInput): NowCard | null {
  const w = weakestDimension(rows)
  if (!w || w.value === null) return null
  const base = {
    key: cardKeyOf({ kind: 'boost', dim: w.key, date: today }),
    kind: 'boost' as const, forDate: today, at: null,
    why: `「${w.label}」是今天最弱的一面（${Math.round(w.value)} 分）`,
    lines: [] as string[], point: '', rank: RANK.boost,
  }
  if (w.key === 'social') {
    const who = companion && personActions ? visibleQuietPeople(companion.quietPeople, personActions, today)[0] : undefined
    if (who) return { ...base, title: `跟 ${who.name} 聯絡一下`, lines: [`最後聯絡 ${who.lastDate}`], person: who.name }
    return { ...base, title: MOVES.social ?? '' }
  }
  if (w.key === 'mind') {
    const ins = insights ? lowDayInsight(insights, history, 'mind', today) : null
    if (ins) {
      return {
        ...base, title: '你上次低潮時寫下的心得', point: ins.text, lines: [`${ins.date} 寫的`],
        href: '#insight/' + encodeURIComponent(ins.id),
      }
    }
    return { ...base, title: MOVES.mind ?? '' }
  }
  return { ...base, title: MOVES[w.key] ?? '' }
}
