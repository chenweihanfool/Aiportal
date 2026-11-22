// 知識島（3.18.0）的純邏輯：知識樹→群島／島／卡、題目頁→SOP 站、心得對應到站、橋、盲點統計、島嶼版面。
// 不碰 DOM、不發請求；畫面在 KnowledgeIslands.tsx，測試在 knowledgeIslands.test.ts。
// 只讀 knowledgeView.ts／knowledgeSteps.ts／insightWeave.ts 已匯出的型別與函式。

import { matchClaims, parseBodyWithMarkers, type Bullet, type BuiltTree, type ParsedBody, type Topic, type TopicDiagram } from './knowledgeView'
import type { StepDoc, StepInsight, StepRule, TopicStep } from './knowledgeSteps'
import type { Confidence, KbLink, KbStep, StepBridge, WeaveStatus } from './insightWeave'

/* ───────── 島模型 ───────── */

export const UNASSIGNED_ID = '__unassigned'

export interface IslandModelIsland { id: string; name: string; topics: Topic[] }
export interface IslandModelDomain { id: string; name: string; /** 色盤格（領域 index） */ slot: number; islands: IslandModelIsland[] }

/** revision 0（或沒有頁面本文）＝種子 */
export const isSeed = (t: Pick<Topic, 'revision' | 'body'>): boolean => t.revision === 0 || t.body === null

/** 樹→群島（領域）／島（枝）／卡（題目）。沒有題目的枝與領域略過；未歸類的題目放一個「未歸類」群島 */
export function buildIslandModel(built: BuiltTree): IslandModelDomain[] {
  const out: IslandModelDomain[] = []
  for (const d of built.domains) {
    const islands = d.branches.filter((b) => b.topics.length > 0).map((b) => ({ id: b.id, name: b.name, topics: b.topics }))
    if (islands.length > 0) out.push({ id: d.id, name: d.name, slot: out.length, islands })
  }
  if (built.unassigned.length > 0) {
    out.push({ id: UNASSIGNED_ID, name: '未歸類', slot: out.length, islands: [{ id: UNASSIGNED_ID, name: '未歸類', topics: built.unassigned }] })
  }
  return out
}

/* ───────── 站切分 ───────── */

export type StationKind = 'prep' | 'step' | 'decision' | 'pitfall' | 'unknown' | 'why' | 'myth' | 'example' | 'what' | 'how' | 'caution'
export interface StationBullet { bid: string; b: Bullet }
export interface Station {
  id: string
  kind: StationKind
  /** 橫軸上的站名（≤15 字） */
  label: string
  /** 步驟站＝第幾步（1 起） */
  stepNo?: number
  bullets: StationBullet[]
}

const LABEL_MAX = 15
const CLAUSE_RE = /[，,、；;。：:！!？?（(]/

/** 站名：該條第一個子句，最多 15 字（超過時第 15 字換成「…」）；整句沒有標點就整句截斷 */
export function shortLabel(text: string, max = LABEL_MAX): string {
  const clean = text.replace(/\s+/g, ' ').trim()
  const m = CLAUSE_RE.exec(clean)
  let head = m && m.index > 0 ? clean.slice(0, m.index) : clean
  head = head.trim() || clean
  const chars = [...head]
  if (chars.length <= max) return chars.join('')
  return `${chars.slice(0, max - 1).join('')}…`
}

const KIND_LABEL: Record<string, string> = {
  prep: '開工前準備', decision: '判斷點', pitfall: '踩過的坑', unknown: '還不知道',
  why: '為什麼存在', myth: '常見誤解', example: '實例', what: '這件事在幹嘛', how: '怎麼做', caution: '要注意',
}
export const stationKindLabel = (k: StationKind): string => (k === 'step' ? '步驟' : KIND_LABEL[k] ?? k)

function group(kind: StationKind, key: 'prep' | 'decisions' | 'pitfalls' | 'unknown' | 'why' | 'myths' | 'examples' | 'what' | 'how' | 'caution', list: Bullet[], id: string): Station[] {
  if (list.length === 0) return []
  return [{ id, kind, label: KIND_LABEL[kind]!, bullets: list.map((b, i) => ({ bid: `${key}:${i}`, b })) }]
}

/**
 * 把題目頁切成橫軸的站（沒有的段落就沒有那一站）。
 * 方法：開工前準備 → 步驟 1…n（每條一站）→ 判斷點 → 踩過的坑 → 還不知道；
 * 概念：為什麼存在 → 常見誤解 → 實例 → 還不知道；舊格式：這件事在幹嘛 → 怎麼做 → 要注意 → 還不知道。
 * bullet 的 bid 與 knowledgeView 的 bulletId 同格式（section:index），好用 matchClaims 對帳本。
 */
export function buildStations(parsed: ParsedBody | null): Station[] {
  if (!parsed) return []
  if (parsed.format === 'method') {
    const steps: Station[] = parsed.steps.map((b, i) => ({ id: `step:${i}`, kind: 'step', label: shortLabel(b.text), stepNo: i + 1, bullets: [{ bid: `steps:${i}`, b }] }))
    return [
      ...group('prep', 'prep', parsed.prep, 'prep'),
      ...steps,
      ...group('decision', 'decisions', parsed.decisions, 'decisions'),
      ...group('pitfall', 'pitfalls', parsed.pitfalls, 'pitfalls'),
      ...group('unknown', 'unknown', parsed.unknown, 'unknown'),
    ]
  }
  if (parsed.format === 'concept') {
    return [
      ...group('why', 'why', parsed.why, 'why'),
      ...group('myth', 'myths', parsed.myths, 'myths'),
      ...group('example', 'examples', parsed.examples, 'examples'),
      ...group('unknown', 'unknown', parsed.unknown, 'unknown'),
    ]
  }
  const what: StationBullet[] = [
    ...(parsed.summary ? [{ bid: 'summary', b: parsed.summary }] : []),
    ...parsed.what.map((b, i) => ({ bid: `what:${i}`, b })),
  ]
  return [
    ...(what.length > 0 ? [{ id: 'what', kind: 'what' as const, label: KIND_LABEL.what!, bullets: what }] : []),
    ...group('how', 'how', parsed.how, 'how'),
    ...group('caution', 'caution', parsed.caution, 'caution'),
    ...group('unknown', 'unknown', parsed.unknown, 'unknown'),
  ]
}

/* ───────── 心得對應到站 ───────── */

export interface StationLinks { insights: StepInsight[]; rules: StepRule[]; docs: StepDoc[] }
export interface TopicAnalysis {
  topicId: string
  seed: boolean
  parsed: ParsedBody | null
  stations: Station[]
  /** stationId → 掛在這站的心得／法條／範本（只含有掛東西的站） */
  links: Map<string, StationLinks>
  /** claim id → stationId（parsed 與 claims 都有就算，不限定有 steps） */
  stationOfClaim: Map<string, string>
  /** stationId → 掛在這站的 AI 步驟對應（去重後的同站同心得） */
  ai: Map<string, KbStep[]>
  /** 這題所有不同的心得 id（含對不到站的、含 AI 對應） */
  insightIds: Set<string>
}

/**
 * 分析一題：切站，再用 step.claim → topic.claims 同 id 的條目 → matchClaims 配到的 bullet → 所屬站，把 steps 的心得／法條／範本掛上去。
 * AI 步驟對應（kbSteps）也走同一條 claim → 站的路徑掛進 ai；對不到的步驟略過（不猜），但心得仍算進 insightIds。
 * 心得以 insightId 去重。
 */
export function analyzeTopic(t: Topic, kbSteps: readonly KbStep[] = [], hidden: ReadonlySet<string> = new Set()): TopicAnalysis {
  const parsed = t.body ? parseBodyWithMarkers(t.body) : null
  const stations = buildStations(parsed)
  const links = new Map<string, StationLinks>()
  const insightIds = new Set<string>()
  const stationOfClaim = new Map<string, string>()
  if (parsed) {
    const stationOfBid = new Map<string, string>()
    for (const st of stations) for (const sb of st.bullets) stationOfBid.set(sb.bid, st.id)
    if (t.claims && t.claims.length > 0) {
      for (const [bid, c] of matchClaims(parsed, t.claims)) {
        const sid = stationOfBid.get(bid)
        if (sid) stationOfClaim.set(c.id, sid)
      }
    }
  }
  const steps = t.steps ?? []
  for (const s of steps) for (const i of s.why.insights) insightIds.add(i.insightId)
  if (parsed && steps.length > 0) {
    for (const step of steps) {
      const sid = stationOfClaim.get(step.claim)
      if (!sid) continue
      let l = links.get(sid)
      if (!l) { l = { insights: [], rules: [], docs: [] }; links.set(sid, l) }
      for (const i of step.why.insights) if (!l.insights.some((x) => x.insightId === i.insightId)) l.insights.push(i)
      for (const r of step.why.rules) if (!l.rules.some((x) => x.article === r.article && x.claim === r.claim)) l.rules.push(r)
      for (const d of step.docs) if (!l.docs.some((x) => x.templateId === d.templateId)) l.docs.push(d)
    }
  }
  const ai = new Map<string, KbStep[]>()
  for (const s of kbSteps) {
    if (s.topic !== t.id || hidden.has(s.id)) continue
    insightIds.add(s.insight)
    const sid = stationOfClaim.get(s.claim)
    if (!sid) continue
    let l = ai.get(sid)
    if (!l) { l = []; ai.set(sid, l) }
    if (!l.some((x) => x.insight === s.insight)) l.push(s)
  }
  return { topicId: t.id, seed: isSeed(t), parsed, stations, links, stationOfClaim, ai, insightIds }
}

/** 這題掛了心得的站數 / 可掛心得的站數（只算步驟站；規則比對心得或 AI 對應有其一就算） */
export function stationCoverage(a: TopicAnalysis): { covered: number; total: number } {
  const steps = a.stations.filter((s) => s.kind === 'step')
  return {
    total: steps.length,
    covered: steps.filter((s) => (a.links.get(s.id)?.insights.length ?? 0) > 0 || (a.ai.get(s.id)?.length ?? 0) > 0).length,
  }
}

/* ───────── 橋 ───────── */

export interface BridgeEnd { topicId: string; stationId: string }
export interface Bridge { key: string; kind: 'rule' | 'doc'; name: string; ends: BridgeEnd[] }

/**
 * 兩個不同題目的步驟共用同一條法條（why.rules[].article）或同一份範本（docs[].templateId）就是一座橋；
 * 橋名＝法條或範本 family。同一題內共用不算。輸出依 key 排序（穩定）。
 */
export function computeBridges(analyses: readonly TopicAnalysis[]): Bridge[] {
  const map = new Map<string, Bridge>()
  const add = (key: string, kind: 'rule' | 'doc', name: string, e: BridgeEnd) => {
    let b = map.get(key)
    if (!b) { b = { key, kind, name, ends: [] }; map.set(key, b) }
    if (!b.ends.some((x) => x.topicId === e.topicId && x.stationId === e.stationId)) b.ends.push(e)
  }
  for (const a of analyses) {
    for (const [sid, l] of a.links) {
      for (const r of l.rules) add(`rule:${r.article}`, 'rule', r.article, { topicId: a.topicId, stationId: sid })
      for (const d of l.docs) add(`doc:${d.templateId}`, 'doc', d.family, { topicId: a.topicId, stationId: sid })
    }
  }
  return [...map.values()]
    .filter((b) => new Set(b.ends.map((e) => e.topicId)).size >= 2)
    .sort((x, y) => (x.key < y.key ? -1 : x.key > y.key ? 1 : 0))
}

/** 這一站的橋，以及「別題」的另一端 */
export function bridgesAt(bridges: readonly Bridge[], topicId: string, stationId: string): Array<{ bridge: Bridge; others: BridgeEnd[] }> {
  const out: Array<{ bridge: Bridge; others: BridgeEnd[] }> = []
  for (const bridge of bridges) {
    if (!bridge.ends.some((e) => e.topicId === topicId && e.stationId === stationId)) continue
    out.push({ bridge, others: bridge.ends.filter((e) => e.topicId !== topicId) })
  }
  return out
}

/** AI 步驟橋（J）：端點已經解析成站；其餘欄位沿用 feed 的 StepBridge */
export interface AiBridge { id: string; title: string; text: string; confidence: Confidence; status: WeaveStatus; ends: BridgeEnd[] }

/**
 * 把 feed 的 stepBridges 解析成站座標：每端用 analyses 的 stationOfClaim 對到站，對不到的端丟掉；
 * 剩下不同題目 ≥2 才保留；id 在 hidden 的整座丟掉。輸出順序同輸入。
 */
export function resolveStepBridges(list: readonly StepBridge[], analyses: ReadonlyMap<string, TopicAnalysis>, hidden: ReadonlySet<string> = new Set()): AiBridge[] {
  const out: AiBridge[] = []
  for (const b of list) {
    if (hidden.has(b.id)) continue
    const ends: BridgeEnd[] = []
    for (const e of b.ends) {
      const stationId = analyses.get(e.topic)?.stationOfClaim.get(e.claim)
      if (!stationId) continue
      if (!ends.some((x) => x.topicId === e.topic && x.stationId === stationId)) ends.push({ topicId: e.topic, stationId })
    }
    if (new Set(ends.map((e) => e.topicId)).size < 2) continue
    out.push({ id: b.id, title: b.title, text: b.text, confidence: b.confidence, status: b.status, ends })
  }
  return out
}

/** 這一站的 AI 橋，以及「別題」的另一端 */
export function aiBridgesAt(list: readonly AiBridge[], topicId: string, stationId: string): Array<{ bridge: AiBridge; others: BridgeEnd[] }> {
  const out: Array<{ bridge: AiBridge; others: BridgeEnd[] }> = []
  for (const bridge of list) {
    if (!bridge.ends.some((e) => e.topicId === topicId && e.stationId === stationId)) continue
    out.push({ bridge, others: bridge.ends.filter((e) => e.topicId !== topicId) })
  }
  return out
}

/* ───────── weave kbLinks、卡片標記、統計 ───────── */

/** weave kbLinks 以「題目名稱」指到題目（沒有 weave 就空陣列） */
export function kbLinksFor(kbLinks: readonly KbLink[] | null | undefined, t: Pick<Topic, 'name'>): KbLink[] {
  return (kbLinks ?? []).filter((k) => k.topic === t.name)
}

export type CardMark = { type: 'insights'; n: number } | { type: 'blind' } | { type: 'waiting' } | null

/** 疊加層的卡片角標：有心得＝💬n；已發布但 0 心得＝盲點；種子但 weave 指到它＝✦ 心得在等；其餘無 */
export function cardMark(t: Topic, a: TopicAnalysis, kbLinks: readonly KbLink[] | null | undefined): CardMark {
  if (a.seed) return kbLinksFor(kbLinks, t).length > 0 ? { type: 'waiting' } : null
  return a.insightIds.size > 0 ? { type: 'insights', n: a.insightIds.size } : { type: 'blind' }
}

export interface IslandStats { insights: number; bridges: number; blind: number; published: number }

/** 一座島的統計：心得則數（各題不同心得加總）、碰到這座島的橋數（規則橋＋AI 橋）、盲點題數／已發布題數 */
export function islandStats(island: Pick<IslandModelIsland, 'topics'>, analyses: ReadonlyMap<string, TopicAnalysis>, bridges: readonly Bridge[], aiBridges: readonly AiBridge[] = []): IslandStats {
  const ids = new Set(island.topics.map((t) => t.id))
  let insights = 0
  let blind = 0
  let published = 0
  for (const t of island.topics) {
    const a = analyses.get(t.id)
    if (!a) continue
    insights += a.insightIds.size
    if (!a.seed) { published++; if (a.insightIds.size === 0) blind++ }
  }
  const bridgeCount = bridges.filter((b) => b.ends.some((e) => ids.has(e.topicId))).length
    + aiBridges.filter((b) => b.ends.some((e) => ids.has(e.topicId))).length
  return { insights, bridges: bridgeCount, blind, published }
}

/* ───────── 版面 ───────── */

export interface Box { w: number; h: number }
export interface Placed { x: number; y: number; w: number; h: number }

export const CARD_W = 168
export const CARD_H = 46
export const CARD_GAP = 8
export const ISL_PAD = 14
export const ISL_LABEL_H = 34
export const DOMAIN_HEAD_H = 34
export const DOMAIN_PAD = 18
const ISL_GAP = 26
const DOMAIN_GAP = 56

/** 一座島有 n 張卡時的欄數（偏寬的長方形，最多 5 欄） */
export function islandCols(n: number): number {
  return Math.max(1, Math.min(n, 5, Math.ceil(Math.sqrt(n * 1.6))))
}

/** 第 i 張卡在島內的位置（相對島左上角） */
export function cardRect(i: number, n: number): Placed {
  const cols = islandCols(n)
  return { x: ISL_PAD + (i % cols) * (CARD_W + CARD_GAP), y: ISL_LABEL_H + ISL_PAD / 2 + Math.floor(i / cols) * (CARD_H + CARD_GAP), w: CARD_W, h: CARD_H }
}

export function islandSize(n: number): Box {
  const cols = islandCols(n)
  const rows = Math.ceil(n / cols)
  return { w: ISL_PAD * 2 + cols * CARD_W + (cols - 1) * CARD_GAP, h: ISL_LABEL_H + ISL_PAD / 2 + rows * CARD_H + (rows - 1) * CARD_GAP + ISL_PAD }
}

/** 依序排進寬 W 的列，超寬換行，每列置中；回傳每個盒子的位置與整體寬高（寬至少 W 與最寬的列） */
export function shelf(boxes: readonly Box[], W: number, gx: number, gy: number): { pos: Placed[]; w: number; h: number } {
  const rows: Array<{ idx: number[]; w: number; h: number }> = []
  let cur: { idx: number[]; w: number; h: number } = { idx: [], w: 0, h: 0 }
  boxes.forEach((b, i) => {
    const nextW = cur.idx.length === 0 ? b.w : cur.w + gx + b.w
    if (cur.idx.length > 0 && nextW > W) { rows.push(cur); cur = { idx: [], w: 0, h: 0 } }
    cur.w = cur.idx.length === 0 ? b.w : cur.w + gx + b.w
    cur.h = Math.max(cur.h, b.h)
    cur.idx.push(i)
  })
  if (cur.idx.length > 0) rows.push(cur)
  const total = Math.max(W, ...rows.map((r) => r.w), 0)
  const pos: Placed[] = new Array<Placed>(boxes.length)
  let y = 0
  for (const r of rows) {
    let x = (total - r.w) / 2
    for (const i of r.idx) {
      const b = boxes[i]!
      pos[i] = { x, y: y + (r.h - b.h) / 2, w: b.w, h: b.h }
      x += b.w + gx
    }
    y += r.h + gy
  }
  return { pos, w: total, h: Math.max(0, y - gy) }
}

export interface SeaDomainLayout extends Placed { islands: Placed[] }
export interface SeaLayout { domains: SeaDomainLayout[]; width: number; height: number }

/**
 * 群島版面：每個領域內先把島排好（領域框＝標題列＋島），再把領域依視窗比例排開（掃寬度找最貼近 ratio 的）。
 * 輸入每個領域的島尺寸，輸出絕對座標；島之間、領域之間都不重疊。
 */
export function layoutSea(domains: ReadonlyArray<{ islands: readonly Box[] }>, ratio: number): SeaLayout {
  const inner = domains.map((d) => {
    const area = d.islands.reduce((s, b) => s + b.w * b.h, 0)
    const maxW = Math.max(0, ...d.islands.map((b) => b.w))
    const W = Math.max(maxW, Math.round(Math.sqrt(area * 1.6)))
    return shelf(d.islands, W, ISL_GAP, ISL_GAP)
  })
  const boxes: Box[] = inner.map((s) => ({ w: s.w + DOMAIN_PAD * 2, h: s.h + DOMAIN_HEAD_H + DOMAIN_PAD * 2 }))
  if (boxes.length === 0) return { domains: [], width: 0, height: 0 }
  const minW = Math.max(...boxes.map((b) => b.w))
  const sumW = boxes.reduce((s, b) => s + b.w + DOMAIN_GAP, -DOMAIN_GAP)
  let best = shelf(boxes, minW, DOMAIN_GAP, DOMAIN_GAP)
  let bestScore = Math.abs(Math.log(best.w / Math.max(1, best.h) / ratio))
  const steps = 24
  for (let i = 1; i <= steps; i++) {
    const W = minW + ((sumW - minW) * i) / steps
    const s = shelf(boxes, W, DOMAIN_GAP, DOMAIN_GAP)
    const score = Math.abs(Math.log(s.w / Math.max(1, s.h) / ratio))
    if (score < bestScore) { best = s; bestScore = score }
  }
  const out: SeaDomainLayout[] = boxes.map((_b, i) => {
    const p = best.pos[i]!
    const sh = inner[i]!
    const ox = p.x + DOMAIN_PAD + (p.w - DOMAIN_PAD * 2 - sh.w) / 2
    const oy = p.y + DOMAIN_HEAD_H + DOMAIN_PAD
    return { ...p, islands: sh.pos.map((q) => ({ x: ox + q.x, y: oy + q.y, w: q.w, h: q.h })) }
  })
  return { domains: out, width: best.w, height: best.h }
}

export interface View { x: number; y: number; k: number }
export const MIN_K = 0.2
export const MAX_K = 2.6

/** 讓內容（cw×ch）置中縮進視窗（vw×vh）；不放大超過 1.1 倍 */
export function fitView(cw: number, ch: number, vw: number, vh: number, margin = 24): View {
  if (cw <= 0 || ch <= 0 || vw <= 0 || vh <= 0) return { x: 0, y: 0, k: 1 }
  const k = Math.min(1.1, Math.max(MIN_K, Math.min((vw - margin * 2) / cw, (vh - margin * 2) / ch)))
  return { k, x: (vw - cw * k) / 2, y: (vh - ch * k) / 2 }
}

/** 以 (cx,cy) 為中心縮放 f 倍，限制在 MIN_K～MAX_K */
export function zoomAt(v: View, f: number, cx: number, cy: number): View {
  const k = Math.min(MAX_K, Math.max(MIN_K, v.k * f))
  return { k, x: cx - ((cx - v.x) * k) / v.k, y: cy - ((cy - v.y) * k) / v.k }
}

/* ───────── 索引模式（3.23.0）：格子 ↔ 站、選取、順序、chips ───────── */

export type GroupKey = 'steps' | 'prep' | 'decisions' | 'pitfalls' | 'unknown' | 'why' | 'myths' | 'examples' | 'what' | 'how' | 'caution'
export interface ChipGroup { key: GroupKey; label: string; n: number }

const GROUP_ORDER: Record<'method' | 'concept' | 'legacy', Array<[GroupKey, string]>> = {
  method: [['prep', '開工前準備'], ['decisions', '判斷點'], ['pitfalls', '踩過的坑'], ['unknown', '還不知道']],
  concept: [['why', '為什麼存在'], ['myths', '常見誤解'], ['examples', '實例'], ['unknown', '還不知道']],
  legacy: [['what', '這件事在幹嘛'], ['how', '怎麼做'], ['caution', '要注意']],
}

/** 一組的條目（groupKey 與站 id 同名） */
export function groupBullets(parsed: ParsedBody | null, key: GroupKey): Bullet[] {
  return parsed ? parsed[key] : []
}

/** 沒有格子可以進的步驟卡：node 為 null，或 node 指向圖上不存在的格子（沒有圖時全部算） */
export function orphanSteps(topic: Pick<Topic, 'steps'>, d: TopicDiagram | null | undefined): TopicStep[] {
  const ids = new Set(nodeOrder(d))
  return (topic.steps ?? []).filter((s) => !s.node || !ids.has(s.node))
}

/** 索引下方 chips：依題目格式列出有條目的組，附數量；orphans＞0 時最後加「其他步驟卡」（g:steps） */
export function chipGroups(parsed: ParsedBody | null, orphans = 0): ChipGroup[] {
  if (!parsed) return []
  const out = GROUP_ORDER[parsed.format]
    .map(([key, label]) => ({ key, label, n: groupBullets(parsed, key).length }))
    .filter((g) => g.n > 0)
  if (orphans > 0) out.push({ key: 'steps', label: '其他步驟卡', n: orphans })
  return out
}

/** 這格對應的站 id：有 node===nodeId 的步驟卡 → 該卡 claim 的站；否則格子 id 本身就是站（備援圖）；都沒有 null */
export function stationForNode(topic: Pick<Topic, 'steps'>, a: TopicAnalysis, nodeId: string): string | null {
  const step = (topic.steps ?? []).find((s) => s.node === nodeId)
  if (step) return a.stationOfClaim.get(step.claim) ?? null
  return a.stations.some((s) => s.id === nodeId) ? nodeId : null
}

/** ←／→ 用的格子順序：flow 依 phase、再 lane；timeline 依日期；map 依觀察→框架→判斷 */
export function nodeOrder(d: TopicDiagram | null | undefined): string[] {
  if (!d) return []
  if (d.type === 'flow') {
    return d.nodes.map((n, i) => ({ n, i })).sort((x, y) => x.n.phase - y.n.phase || x.n.lane - y.n.lane || x.i - y.i).map((r) => r.n.id)
  }
  if (d.type === 'timeline') {
    return d.items.map((it, i) => ({ it, i })).sort((x, y) => (x.it.date < y.it.date ? -1 : x.it.date > y.it.date ? 1 : x.i - y.i)).map((r) => `i${r.i}`)
  }
  return [...d.observations, ...d.frameworks, ...d.judgments].map((n) => n.id)
}

/**
 * 索引圖縮放：整張圖縮到放得進高度上限（不允許框內垂直捲動），比例不超過 1；
 * 比例低於 minScale 時改用 minScale 繪製（clamped），這時高度會超過上限、寬度超過框就橫向捲（hScroll）。
 * natural＝圖的自然尺寸（viewBox），box.w＝可用寬度，box.maxH＝高度上限。
 */
export function indexScale(natural: { w: number; h: number }, box: { w: number; maxH: number }, minScale = 0.45): { scale: number; width: number; height: number; clamped: boolean; hScroll: boolean } {
  if (natural.w <= 0 || natural.h <= 0) return { scale: 1, width: Math.max(0, natural.w), height: Math.max(0, natural.h), clamped: false, hScroll: false }
  const want = Math.min(1, box.maxH > 0 ? box.maxH / natural.h : 1)
  const clamped = want < minScale
  const scale = clamped ? minScale : want
  const width = natural.w * scale
  return { scale, width, height: natural.h * scale, clamped, hScroll: width > box.w }
}

/** 桌機左圖右文的索引欄寬：圖放大倍率 s＝min(maxScale, 可用高 ÷ 圖自然高)，欄寬＝clamp(自然寬 × s, minW, 容器寬 × maxRatio) */
export function wideIndexWidth(natural: { w: number; h: number }, availH: number, containerW: number, maxScale = 1.6, minW = 380, maxRatio = 0.52): { width: number; scale: number } {
  const cap = Math.max(minW, containerW * maxRatio)
  if (natural.w <= 0 || natural.h <= 0) return { width: Math.min(cap, Math.max(minW, 0)), scale: 1 }
  const s = Math.min(maxScale, availH > 0 ? availH / natural.h : maxScale)
  const width = Math.round(Math.min(cap, Math.max(minW, natural.w * s)))
  return { width, scale: width / natural.w }
}

/**
 * 索引精簡切換（窄螢幕）：只看 scrollTop 與黏頂點（sentinel 在捲動內容裡的絕對位置 − .kn-head 高），與索引本身高度無關，
 * 所以切換不會改到觸發條件；上下各 band px 的遲滯。scrollTop > 黏頂點 + band → 精簡；< 黏頂點 − band → 完整；其間維持原狀。
 */
export function nextCompact(cur: boolean, scrollTop: number, stickTop: number, band = 40): boolean {
  if (!cur && scrollTop > stickTop + band) return true
  if (cur && (scrollTop < stickTop - band || scrollTop <= 5)) return false
  return cur
}

export const isGroupSel = (sel: string): boolean => sel.startsWith('g:')
export const groupOfSel = (sel: string): GroupKey | null => (isGroupSel(sel) ? (sel.slice(2) as GroupKey) : null)

/** 預設選取：第一個有步驟卡或站種類為 step 的格子；沒有則第一格；再沒有則第一個 chip（g:組名）；都沒有回 null */
export function defaultSelection(topic: Pick<Topic, 'steps'>, a: TopicAnalysis, d: TopicDiagram | null | undefined): string | null {
  const order = nodeOrder(d)
  const cards = new Set((topic.steps ?? []).map((s) => s.node).filter((x): x is string => !!x))
  const hit = order.find((id) => cards.has(id) || a.stations.find((s) => s.id === id)?.kind === 'step')
  if (hit) return hit
  if (order[0]) return order[0]
  const g = chipGroups(a.parsed, orphanSteps(topic, d).length)[0]
  return g ? `g:${g.key}` : null
}

/** 選取是否合法（格子 id 在圖上，或 g:組名 在 chips 裡） */
export function isValidSelection(sel: string, a: TopicAnalysis, d: TopicDiagram | null | undefined, topic?: Pick<Topic, 'steps'>): boolean {
  if (isGroupSel(sel)) return chipGroups(a.parsed, topic ? orphanSteps(topic, d).length : 0).some((g) => `g:${g.key}` === sel)
  return nodeOrder(d).includes(sel)
}
