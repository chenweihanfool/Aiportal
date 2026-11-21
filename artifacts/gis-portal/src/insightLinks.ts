// 心得 ↔ 人物／想法的反向連結與根系排版（純函式：不碰 DOM、不用亂數）。
import { dossierHref } from './dossier'
import type { Insight, InsightData, InsightIdeaLink, InsightPersonLink } from './insightModel'

/** 新到舊：date、time、id 都由大到小 */
function newestFirst(a: Insight, b: Insight): number {
  if (a.date !== b.date) return a.date < b.date ? 1 : -1
  const ta = a.time ?? ''
  const tb = b.time ?? ''
  if (ta !== tb) return ta < tb ? 1 : -1
  return a.id < b.id ? 1 : a.id > b.id ? -1 : 0
}

/** 人物卷宗：links.people 的 dossier 等於卷宗名的心得，新到舊，最多 10 則 */
export function insightsForPerson(data: InsightData | null, dossierName: string): Insight[] {
  if (!data) return []
  return data.insights.filter((i) => i.links.people.some((p) => p.dossier === dossierName)).sort(newestFirst).slice(0, 10)
}

/** 想法卡：提到該想法的心得；relation 為 overturn 的歸推翻，其餘歸驗證；各新到舊最多 5 則 */
export function insightsForIdea(data: InsightData | null, ideaId: string): { confirm: Insight[]; overturn: Insight[] } {
  const out = { confirm: [] as Insight[], overturn: [] as Insight[] }
  if (!data) return out
  const hit = data.insights.filter((i) => i.links.ideas.some((x) => x.id === ideaId)).sort(newestFirst)
  for (const i of hit) (i.relation === 'overturn' ? out.overturn : out.confirm).push(i)
  out.confirm = out.confirm.slice(0, 5)
  out.overturn = out.overturn.slice(0, 5)
  return out
}

export interface RootTargets { people: InsightPersonLink[]; ideas: InsightIdeaLink[]; morePeople: number; moreIdeas: number }

/** 根系要畫的人與想法：同一段的人、日記有提到的想法優先（穩定排序），超過上限記在 more */
export function rootTargets(ins: Insight, maxPeople = 4, maxIdeas = 3): RootTargets {
  const people = ins.links.people.map((p, k) => ({ p, k })).sort((a, b) => Number(b.p.sameSegment) - Number(a.p.sameSegment) || a.k - b.k).map((x) => x.p)
  const ideas = ins.links.ideas.map((p, k) => ({ p, k })).sort((a, b) => Number(b.p.mentioned) - Number(a.p.mentioned) || a.k - b.k).map((x) => x.p)
  return {
    people: people.slice(0, maxPeople), ideas: ideas.slice(0, maxIdeas),
    morePeople: Math.max(0, people.length - maxPeople), moreIdeas: Math.max(0, ideas.length - maxIdeas),
  }
}

/** 根系的一條根：對應的人物、想法，或「+N」（面板裡有完整清單） */
export type RootSlot =
  | { kind: 'person'; name: string; dossier: string | null }
  | { kind: 'idea'; id: string; title: string }
  | { kind: 'more'; n: number; of: 'person' | 'idea' }

/** 按「根」要打開什麼：人物卷宗、想法庫那一張，或這則心得的面板（+N） */
export type RootAction =
  | { kind: 'dossier'; href: string }
  | { kind: 'idea'; id: string }
  | { kind: 'panel' }

/** 根系依序排：人、+人、想法、+想法（與 rootTargets 的排序一致） */
export function rootSlots(ins: Insight, maxPeople = 4, maxIdeas = 3): RootSlot[] {
  const t = rootTargets(ins, maxPeople, maxIdeas)
  return [
    ...t.people.map((p): RootSlot => ({ kind: 'person', name: p.name, dossier: p.dossier ?? null })),
    ...(t.morePeople > 0 ? [{ kind: 'more', n: t.morePeople, of: 'person' } as RootSlot] : []),
    ...t.ideas.map((i): RootSlot => ({ kind: 'idea', id: i.id, title: i.title })),
    ...(t.moreIdeas > 0 ? [{ kind: 'more', n: t.moreIdeas, of: 'idea' } as RootSlot] : []),
  ]
}

/** 這條根點下去要做什麼：沒卷宗的人回 null（不可點） */
export function rootAction(slot: RootSlot): RootAction | null {
  if (slot.kind === 'person') return slot.dossier === null ? null : { kind: 'dossier', href: dossierHref('person', slot.dossier) }
  if (slot.kind === 'idea') return { kind: 'idea', id: slot.id }
  return { kind: 'panel' }
}

export interface RootPath { x: number; y: number; d: string }

const r1 = (n: number): number => Math.round(n * 10) / 10
const ROOT_GAP = 110

/** n 條根：從 (originX, 0) 出發的三次貝茲曲線，末端在 0..width 內均勻分布、y 錯落在 depth*0.55～0.9 */
export function rootPaths(originX: number, width: number, n: number, depth = 56): RootPath[] {
  if (n <= 0) return []
  // 末端圍在樹幹附近（每個約 110px，想法小卡寬 100），不攤滿整個舞台；靠邊時整排平移回舞台內
  const margin = Math.min(18, width / 2)
  const ox = Math.min(Math.max(originX, 0), width)
  const span = Math.min(Math.max(0, width - margin * 2), (n - 1) * ROOT_GAP)
  const start = Math.min(Math.max(ox - span / 2, margin), Math.max(margin, width - margin - span))
  const out: RootPath[] = []
  for (let k = 0; k < n; k++) {
    const x = n === 1 ? Math.min(Math.max(ox + 40, margin), Math.max(margin, width - margin)) : start + (span * k) / (n - 1)
    const y = depth * (k % 2 === 0 ? 0.62 : 0.86)
    const c1x = ox + (x - ox) * 0.15
    const c2x = x - (x - ox) * 0.2
    out.push({ x: r1(x), y: r1(y), d: `M${r1(ox)},0 C${r1(c1x)},${r1(y * 0.55)} ${r1(c2x)},${r1(y * 0.2)} ${r1(x)},${r1(y)}` })
  }
  return out
}
