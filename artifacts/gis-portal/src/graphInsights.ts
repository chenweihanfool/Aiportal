// ─────────────────────────────────────────────
// 關係圖的推導層：純函式，不碰 React / DOM / 網路。
//
// 全部在前端算：整包圖早就在瀏覽器裡（幾百個節點、上千條邊），BFS 跟共現
// 統計都是微秒級，沒有必要為此多開 API、多存欄位——也因此這一層完全沒有
// pipeline 風險，改這裡不影響 collect.ps1／DB／L3。
//
// 節點 id 規則跟 RelationshipUniverse.tsx 一致：
//   p:<人名>  e:<事件id>  c:<案件名>  o:<物件名>
// ─────────────────────────────────────────────
import type { HermesGraphData, HermesGraphEventNode, HermesGraphHubNarrative } from './hermesGraphApi'

export type NodeKind = 'person' | 'event' | 'case' | 'object'

export const personId = (name: string) => `p:${name}`
export const eventId = (id: string) => `e:${id}`
export const caseId = (name: string) => `c:${name}`
export const objectId = (name: string) => `o:${name}`

export function splitId(id: string): { kind: NodeKind; name: string } {
  const prefix = id.slice(0, 1)
  const name = id.slice(2)
  const kind: NodeKind = prefix === 'p' ? 'person' : prefix === 'c' ? 'case' : prefix === 'o' ? 'object' : 'event'
  return { kind, name }
}

export interface GraphIndex {
  neighbors: Map<string, Set<string>>
  labelOf: Map<string, string>
  eventById: Map<string, HermesGraphEventNode>
  /** 人名 -> 參與過的事件 id */
  personEvents: Map<string, Set<string>>
  /** 事件 id -> 參與者（含角色） */
  eventParticipants: Map<string, Array<{ person: string; role: string }>>
  eventObjects: Map<string, string[]>
  /** 案件名 -> 事件 id，已依日期由舊到新排序 */
  caseEvents: Map<string, string[]>
  objectEvents: Map<string, string[]>
  caseStatus: Map<string, string | null>
  objectType: Map<string, string | null>
  /** 人↔人：排序後的 "a|b" -> L5 寫在 People/*.md「## 關係人物」的描述文字 */
  relationDescription: Map<string, string>
  /** 人↔人共現：排序後的 "a|b" -> 共同參與的事件 id */
  coEvents: Map<string, string[]>
  /** 樞紐節點 id（p:/c:/o:）-> 敘事時間軸（圖譜敘事 weave + 時效警報 alert
   *  合併，已依日期新到舊排序），見 hermesGraphSnapshot.ts 的 hubNarratives 說明 */
  narrativesByHub: Map<string, HermesGraphHubNarrative[]>
  /** 敘事文字裡 [[名稱]] wikilink -> 節點 id，解析不到就原樣顯示文字 */
  nodeIdByLabel: Map<string, string>
}

const pairKey = (a: string, b: string) => (a < b ? `${a}|${b}` : `${b}|${a}`)

export function buildIndex(graph: NonNullable<HermesGraphData['graph']>): GraphIndex {
  const neighbors = new Map<string, Set<string>>()
  const labelOf = new Map<string, string>()
  const link = (a: string, b: string) => {
    const sa = neighbors.get(a) ?? new Set<string>(); sa.add(b); neighbors.set(a, sa)
    const sb = neighbors.get(b) ?? new Set<string>(); sb.add(a); neighbors.set(b, sb)
  }

  const eventById = new Map(graph.events.map(e => [e.id, e]))
  for (const p of graph.people) labelOf.set(personId(p.name), p.name)
  for (const e of graph.events) labelOf.set(eventId(e.id), e.title)
  for (const c of graph.cases) labelOf.set(caseId(c.name), c.name)
  for (const o of graph.objects) labelOf.set(objectId(o.name), o.name)

  const personEvents = new Map<string, Set<string>>()
  const eventParticipants = new Map<string, Array<{ person: string; role: string }>>()
  for (const e of graph.edges) {
    if (!eventById.has(e.eventId)) continue
    link(personId(e.person), eventId(e.eventId))
    const pe = personEvents.get(e.person) ?? new Set<string>(); pe.add(e.eventId); personEvents.set(e.person, pe)
    const ep = eventParticipants.get(e.eventId) ?? []; ep.push({ person: e.person, role: e.role }); eventParticipants.set(e.eventId, ep)
  }

  const caseEvents = new Map<string, string[]>()
  for (const e of graph.caseEdges) {
    if (!eventById.has(e.eventId)) continue
    link(eventId(e.eventId), caseId(e.case))
    const ce = caseEvents.get(e.case) ?? []; ce.push(e.eventId); caseEvents.set(e.case, ce)
  }
  const dateOf = (id: string) => eventById.get(id)?.date ?? ''
  for (const [, ids] of caseEvents) ids.sort((a, b) => dateOf(a).localeCompare(dateOf(b)))

  const objectEvents = new Map<string, string[]>()
  const eventObjects = new Map<string, string[]>()
  for (const e of graph.objectEdges) {
    if (!eventById.has(e.eventId)) continue
    link(eventId(e.eventId), objectId(e.object))
    const oe = objectEvents.get(e.object) ?? []; oe.push(e.eventId); objectEvents.set(e.object, oe)
    const eo = eventObjects.get(e.eventId) ?? []; eo.push(e.object); eventObjects.set(e.eventId, eo)
  }
  for (const [, ids] of objectEvents) ids.sort((a, b) => dateOf(a).localeCompare(dateOf(b)))

  const relationDescription = new Map<string, string>()
  for (const r of graph.personRelations) {
    link(personId(r.from), personId(r.to))
    relationDescription.set(pairKey(r.from, r.to), r.description)
  }

  // 共現：同一個事件裡的每一對參與者。這是「推導」出來的關係，跟 L3 寫在
  // People/*.md 的 relationDescription 是兩回事——兩者的差集正是下面
  // missingRelations 要抓的東西。
  const coEvents = new Map<string, string[]>()
  for (const [evId, parts] of eventParticipants) {
    const names = Array.from(new Set(parts.map(p => p.person))).sort()
    for (let i = 0; i < names.length; i++) {
      for (let j = i + 1; j < names.length; j++) {
        const k = pairKey(names[i], names[j])
        const arr = coEvents.get(k) ?? []; arr.push(evId); coEvents.set(k, arr)
      }
    }
  }

  // 樞紐敘事：kind 決定用哪個 id 前綴分組，跟其他區塊同一套 personId/
  // caseId/objectId 的 key 慣例。同一樞紐可能同時有 weave 跟 alert 兩種
  // type，混在同一個陣列裡依日期新到舊排序，詳情面板的「敘事」分頁自己
  // 用 type 標籤區分，不在這裡先拆開存。
  const narrativesByHub = new Map<string, HermesGraphHubNarrative[]>()
  for (const n of graph.hubNarratives) {
    const id = n.kind === 'person' ? personId(n.hub) : n.kind === 'case' ? caseId(n.hub) : objectId(n.hub)
    const arr = narrativesByHub.get(id) ?? []
    arr.push(n)
    narrativesByHub.set(id, arr)
  }
  for (const arr of narrativesByHub.values()) arr.sort((a, b) => b.date.localeCompare(a.date))

  // Wikilink 解析用的反查表：人/案/物直接用顯示名稱當 key；事件比較特殊——
  // 敘事文字裡的 [[名稱]] 慣例是完整檔名（含日期前綴，例：
  // 「2026-09-17_載爸媽台大回診...」），但 event.title 有時是「檔名去掉日
  // 期前綴」的 fallback 值（見 collect.ps1 的 Get-HermesEvents），兩者對
  // 不上，所以事件額外把「date_title」重組回檔名格式也收一份當 key。仍然
  // 解析不到的 wikilink（例如指到某個沒有 # 標題、標題又被使用者自訂過的
  // 事件）就原樣顯示文字，不是每個連結都保證能點——優雅降級。
  const nodeIdByLabel = new Map<string, string>()
  for (const p of graph.people) if (!nodeIdByLabel.has(p.name)) nodeIdByLabel.set(p.name, personId(p.name))
  for (const c of graph.cases) if (!nodeIdByLabel.has(c.name)) nodeIdByLabel.set(c.name, caseId(c.name))
  for (const o of graph.objects) if (!nodeIdByLabel.has(o.name)) nodeIdByLabel.set(o.name, objectId(o.name))
  for (const e of graph.events) {
    if (!nodeIdByLabel.has(e.title)) nodeIdByLabel.set(e.title, eventId(e.id))
    const reconstructed = `${e.date}_${e.title}`
    if (!nodeIdByLabel.has(reconstructed)) nodeIdByLabel.set(reconstructed, eventId(e.id))
  }

  return {
    neighbors, labelOf, eventById, personEvents, eventParticipants, eventObjects,
    caseEvents, objectEvents,
    caseStatus: new Map(graph.cases.map(c => [c.name, c.status])),
    objectType: new Map(graph.objects.map(o => [o.name, o.objectType])),
    relationDescription, coEvents, narrativesByHub, nodeIdByLabel,
  }
}

/** 兩個節點之間的最短路徑（含頭尾），找不到回 null。無權重圖用 BFS 就是
 *  最短路徑，不需要 Dijkstra。 */
export function shortestPath(index: GraphIndex, fromId: string, toId: string): string[] | null {
  if (fromId === toId) return [fromId]
  if (!index.neighbors.has(fromId) || !index.neighbors.has(toId)) return null
  const prev = new Map<string, string>([[fromId, '']])
  const queue = [fromId]
  for (let head = 0; head < queue.length; head++) {
    const cur = queue[head]
    for (const nb of index.neighbors.get(cur) ?? []) {
      if (prev.has(nb)) continue
      prev.set(nb, cur)
      if (nb === toId) {
        const path = [nb]
        let step = cur
        while (step) { path.push(step); step = prev.get(step) ?? '' }
        return path.reverse()
      }
      queue.push(nb)
    }
  }
  return null
}

const daysBetween = (a: string, b: string) =>
  Math.round((Date.parse(b) - Date.parse(a)) / 86400000)

export interface PersonInsight {
  /** 共同參與過事件的人，依共現次數排序 */
  collaborators: Array<{ name: string; sharedEvents: number; hasRecordedRelation: boolean }>
  /** 有共同事件、但 L3 的「## 關係人物」沒記到的配對——管線漏記的偵測 */
  missingRelations: Array<{ name: string; sharedEvents: number }>
  /** 沒有共同事件，但和我的協作者有共同事件的人（二度人脈） */
  secondDegree: Array<{ name: string; via: string[] }>
  /** 參與過的案件 */
  cases: Array<{ name: string; events: number }>
  /** 這個人是不是「橋接點」：拿掉他之後，他的協作者會裂成幾個互不相連的群 */
  bridgeGroups: string[][]
  firstDate: string | null
  lastDate: string | null
}

/** 人物共現網（含 L3 明寫的關係），給二度人脈與橋接偵測用 */
function personGraph(index: GraphIndex): Map<string, Set<string>> {
  const g = new Map<string, Set<string>>()
  const add = (a: string, b: string) => {
    const sa = g.get(a) ?? new Set<string>(); sa.add(b); g.set(a, sa)
    const sb = g.get(b) ?? new Set<string>(); sb.add(a); g.set(b, sb)
  }
  for (const name of index.personEvents.keys()) if (!g.has(name)) g.set(name, new Set())
  for (const key of index.coEvents.keys()) { const [a, b] = key.split('|'); add(a, b) }
  for (const key of index.relationDescription.keys()) { const [a, b] = key.split('|'); add(a, b) }
  return g
}

export function personInsight(index: GraphIndex, name: string): PersonInsight {
  const myEvents = index.personEvents.get(name) ?? new Set<string>()

  const collaborators: PersonInsight['collaborators'] = []
  const missingRelations: PersonInsight['missingRelations'] = []
  for (const [key, evs] of index.coEvents) {
    const [a, b] = key.split('|')
    if (a !== name && b !== name) continue
    const other = a === name ? b : a
    const recorded = index.relationDescription.has(key)
    collaborators.push({ name: other, sharedEvents: evs.length, hasRecordedRelation: recorded })
    if (!recorded) missingRelations.push({ name: other, sharedEvents: evs.length })
  }
  collaborators.sort((p, q) => q.sharedEvents - p.sharedEvents || p.name.localeCompare(q.name))
  missingRelations.sort((p, q) => q.sharedEvents - p.sharedEvents || p.name.localeCompare(q.name))

  const pg = personGraph(index)
  const direct = pg.get(name) ?? new Set<string>()
  const second = new Map<string, Set<string>>()
  for (const mid of direct) {
    for (const far of pg.get(mid) ?? []) {
      if (far === name || direct.has(far)) continue
      const via = second.get(far) ?? new Set<string>(); via.add(mid); second.set(far, via)
    }
  }
  const secondDegree = Array.from(second.entries())
    .map(([n, via]) => ({ name: n, via: Array.from(via).sort() }))
    .sort((p, q) => q.via.length - p.via.length || p.name.localeCompare(q.name))

  // 橋接偵測：把自己從人物網拿掉，看直接協作者裂成幾群。>1 群代表這些人
  // 之間唯一的連結就是你——單一窗口／知識單點風險。
  const bridgeGroups: string[][] = []
  if (direct.size > 1) {
    const unseen = new Set(direct)
    while (unseen.size > 0) {
      const start: string = unseen.values().next().value as string
      const comp: string[] = []
      const stack = [start]
      const visited = new Set<string>([start, name]) // name 視為已拿掉
      while (stack.length > 0) {
        const cur = stack.pop() as string
        comp.push(cur)
        unseen.delete(cur)
        for (const nb of pg.get(cur) ?? []) {
          if (visited.has(nb)) continue
          visited.add(nb)
          stack.push(nb)
        }
      }
      bridgeGroups.push(comp.filter(c => direct.has(c)).sort())
    }
  }

  const caseCount = new Map<string, number>()
  const dates: string[] = []
  for (const evId of myEvents) {
    const ev = index.eventById.get(evId)
    if (!ev) continue
    dates.push(ev.date)
    if (ev.case) caseCount.set(ev.case, (caseCount.get(ev.case) ?? 0) + 1)
  }
  dates.sort()

  return {
    collaborators,
    missingRelations,
    secondDegree,
    cases: Array.from(caseCount.entries()).map(([n, events]) => ({ name: n, events })).sort((p, q) => q.events - p.events),
    bridgeGroups: bridgeGroups.length > 1 ? bridgeGroups : [],
    firstDate: dates[0] ?? null,
    lastDate: dates[dates.length - 1] ?? null,
  }
}

export interface CaseInsight {
  firstDate: string | null
  lastDate: string | null
  spanDays: number | null
  /** 最長的一段沒有任何事件的空窗 */
  longestGap: { days: number; from: string; to: string } | null
  /** 距今多久沒有新事件 */
  staleDays: number | null
  /** 重複出現的班底 vs 只出現一次的人 */
  coreTeam: Array<{ name: string; events: number }>
  oneOffPeople: string[]
  objects: string[]
  eventsWithoutPeople: number
  totalEvents: number
}

export function caseInsight(index: GraphIndex, name: string, today = new Date()): CaseInsight {
  const ids = index.caseEvents.get(name) ?? []
  const dates = ids.map(id => index.eventById.get(id)?.date ?? '').filter(Boolean).sort()

  let longestGap: CaseInsight['longestGap'] = null
  for (let i = 1; i < dates.length; i++) {
    const days = daysBetween(dates[i - 1], dates[i])
    if (!longestGap || days > longestGap.days) longestGap = { days, from: dates[i - 1], to: dates[i] }
  }

  const peopleCount = new Map<string, number>()
  const objects = new Set<string>()
  let eventsWithoutPeople = 0
  for (const id of ids) {
    const parts = index.eventParticipants.get(id) ?? []
    if (parts.length === 0) eventsWithoutPeople++
    for (const p of parts) peopleCount.set(p.person, (peopleCount.get(p.person) ?? 0) + 1)
    for (const o of index.eventObjects.get(id) ?? []) objects.add(o)
  }

  const ranked = Array.from(peopleCount.entries()).map(([n, events]) => ({ name: n, events }))
    .sort((p, q) => q.events - p.events || p.name.localeCompare(q.name))

  const last = dates[dates.length - 1]
  return {
    firstDate: dates[0] ?? null,
    lastDate: last ?? null,
    spanDays: dates.length > 1 ? daysBetween(dates[0], last) : dates.length === 1 ? 0 : null,
    longestGap,
    staleDays: last ? Math.round((today.getTime() - Date.parse(last)) / 86400000) : null,
    coreTeam: ranked.filter(r => r.events > 1),
    oneOffPeople: ranked.filter(r => r.events === 1).map(r => r.name),
    objects: Array.from(objects).sort(),
    eventsWithoutPeople,
    totalEvents: ids.length,
  }
}

export interface EventInsight {
  /** 同一個案件裡的前一筆／後一筆事件 */
  prevInCase: { id: string; date: string; title: string } | null
  nextInCase: { id: string; date: string; title: string } | null
  /** 同一天發生的其他事件 */
  sameDay: Array<{ id: string; title: string }>
  positionInCase: { index: number; total: number } | null
  gapFromPrev: number | null
  isolated: boolean
}

export function eventInsight(index: GraphIndex, id: string): EventInsight {
  const ev = index.eventById.get(id)
  const parts = index.eventParticipants.get(id) ?? []
  const objs = index.eventObjects.get(id) ?? []
  const isolated = parts.length === 0 && !ev?.case && objs.length === 0

  let prevInCase: EventInsight['prevInCase'] = null
  let nextInCase: EventInsight['nextInCase'] = null
  let positionInCase: EventInsight['positionInCase'] = null
  let gapFromPrev: number | null = null
  if (ev?.case) {
    const ids = index.caseEvents.get(ev.case) ?? []
    const i = ids.indexOf(id)
    if (i >= 0) {
      positionInCase = { index: i + 1, total: ids.length }
      const pick = (j: number) => {
        const other = index.eventById.get(ids[j])
        return other ? { id: other.id, date: other.date, title: other.title } : null
      }
      if (i > 0) { prevInCase = pick(i - 1); if (prevInCase && ev.date) gapFromPrev = daysBetween(prevInCase.date, ev.date) }
      if (i < ids.length - 1) nextInCase = pick(i + 1)
    }
  }

  const sameDay: EventInsight['sameDay'] = []
  if (ev?.date) {
    for (const other of index.eventById.values()) {
      if (other.id === id || other.date !== ev.date) continue
      sameDay.push({ id: other.id, title: other.title })
      if (sameDay.length >= 12) break
    }
  }

  return { prevInCase, nextInCase, sameDay, positionInCase, gapFromPrev, isolated }
}

export interface ObjectInsight {
  handlers: Array<{ name: string; events: number }>
  cases: string[]
  firstDate: string | null
  lastDate: string | null
  reusedAcrossCases: boolean
}

export function objectInsight(index: GraphIndex, name: string): ObjectInsight {
  const ids = index.objectEvents.get(name) ?? []
  const handlers = new Map<string, number>()
  const cases = new Set<string>()
  const dates: string[] = []
  for (const id of ids) {
    const ev = index.eventById.get(id)
    if (ev?.date) dates.push(ev.date)
    if (ev?.case) cases.add(ev.case)
    for (const p of index.eventParticipants.get(id) ?? []) handlers.set(p.person, (handlers.get(p.person) ?? 0) + 1)
  }
  dates.sort()
  return {
    handlers: Array.from(handlers.entries()).map(([n, events]) => ({ name: n, events })).sort((p, q) => q.events - p.events),
    cases: Array.from(cases).sort(),
    firstDate: dates[0] ?? null,
    lastDate: dates[dates.length - 1] ?? null,
    reusedAcrossCases: cases.size > 1,
  }
}

export interface SearchHit { id: string; kind: NodeKind; label: string; sub: string }

/** 跨四種類型的子字串搜尋。刻意不限制在目前的核心類型——使用者通常不知道
 *  要找的東西被歸成哪一類；但同類型內把「目前核心」排前面。 */
export function searchNodes(
  graph: NonNullable<HermesGraphData['graph']>,
  query: string,
  coreKind: NodeKind,
  limit = 40,
): SearchHit[] {
  const q = query.trim().toLowerCase()
  if (!q) return []
  const hits: Array<SearchHit & { score: number }> = []
  const push = (id: string, kind: NodeKind, label: string, sub: string) => {
    const lower = label.toLowerCase()
    const at = lower.indexOf(q)
    if (at < 0) return
    // 開頭命中優先，其次短字串優先（比較可能是精確的那個），核心類型再加權
    const score = at * 10 + label.length * 0.1 + (kind === coreKind ? 0 : 25)
    hits.push({ id, kind, label, sub, score })
  }
  for (const p of graph.people) push(personId(p.name), 'person', p.name, `人物 · ${p.eventCount} 事件`)
  for (const c of graph.cases) push(caseId(c.name), 'case', c.name, `案件 · ${c.eventCount} 事件`)
  for (const o of graph.objects) push(objectId(o.name), 'object', o.name, `物件${o.objectType ? ` · ${o.objectType}` : ''}`)
  for (const e of graph.events) push(eventId(e.id), 'event', e.title, `事件 · ${e.date}`)
  hits.sort((a, b) => a.score - b.score || a.label.localeCompare(b.label))
  return hits.slice(0, limit).map(({ score: _score, ...hit }) => hit)
}
