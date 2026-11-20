// 心得「AI 編織層」（3.17.0）的純邏輯：寬容解析 feed insight-weave v1、折疊確認／否決紀錄、依島／依心得建索引。
// 不碰 DOM、不發請求；畫面在 InsightWeave.tsx，請求在 insightWeaveApi.ts。契約見 schemas/feeds 的 insight-weave（v1）。

export type Confidence = 'high' | 'mid' | 'low'
export type WeaveStatus = 'proposed' | 'confirmed'
export type Verdict = 'ok' | 'no' | 'undo'
export type KbKind = 'apply' | 'seed' | 'blindspot'

interface Base { id: string; confidence: Confidence; status: WeaveStatus; since: string }
export interface Lighthouse extends Base { cluster: string; text: string; evidence: string[] }
export interface Insufficient { cluster: string; evidence: string[]; note: string }
export interface BridgeEnd { cluster: string; evidence: string[] }
export interface Bridge extends Base { title: string; text: string; ends: BridgeEnd[]; note: string }
export interface Tension extends Base { text: string; members: string[]; clusters: string[] }
export interface KbLink extends Base { kind: KbKind; topic: string; insights: string[]; text: string }
export type WeaveItem = Lighthouse | Bridge | Tension | KbLink

export interface WeavePayload {
  generatedAt: string
  lighthouses: Lighthouse[]
  insufficient: Insufficient[]
  bridges: Bridge[]
  tensions: Tension[]
  kbLinks: KbLink[]
}

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)
const str = (v: unknown): string | null => (typeof v === 'string' && v.trim() !== '' ? v : null)
const strs = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string' && x !== '') : [])
const conf = (v: unknown): Confidence | null => (v === 'high' || v === 'mid' || v === 'low' ? v : null)

function base(o: Record<string, unknown>): Base | null {
  const id = str(o.id)
  const confidence = conf(o.confidence)
  if (!id || !confidence) return null
  return { id, confidence, status: o.status === 'confirmed' ? 'confirmed' : 'proposed', since: typeof o.since === 'string' ? o.since : '' }
}

function eachItem<T>(v: unknown, f: (o: Record<string, unknown>) => T | null): T[] {
  if (!Array.isArray(v)) return []
  const out: T[] = []
  for (const x of v) {
    if (!isObj(x)) continue
    try { const r = f(x); if (r) out.push(r) } catch { /* 單項壞掉就丟掉 */ }
  }
  return out
}

/** 寬容解析：不合格的單項丟掉；不是物件、或五個陣列欄位一個都沒有（整份壞）回 null。 */
export function parseWeave(raw: unknown): WeavePayload | null {
  if (!isObj(raw)) return null
  const keys = ['lighthouses', 'insufficient', 'bridges', 'tensions', 'kbLinks'] as const
  if (!keys.some((k) => Array.isArray(raw[k]))) return null
  const lighthouses = eachItem<Lighthouse>(raw.lighthouses, (o) => {
    const b = base(o); const cluster = str(o.cluster); const text = str(o.text); const evidence = strs(o.evidence)
    return b && cluster && text && evidence.length > 0 ? { ...b, cluster, text, evidence } : null
  })
  const insufficient = eachItem<Insufficient>(raw.insufficient, (o) => {
    const cluster = str(o.cluster); const evidence = strs(o.evidence)
    return cluster && evidence.length > 0 ? { cluster, evidence, note: typeof o.note === 'string' ? o.note : '' } : null
  })
  const bridges = eachItem<Bridge>(raw.bridges, (o) => {
    const b = base(o); const title = str(o.title); const text = str(o.text)
    const ends = eachItem<BridgeEnd>(o.ends, (e) => { const cluster = str(e.cluster); return cluster ? { cluster, evidence: strs(e.evidence) } : null })
    return b && title && text && ends.length >= 2 ? { ...b, title, text, ends, note: typeof o.note === 'string' ? o.note : '' } : null
  })
  const tensions = eachItem<Tension>(raw.tensions, (o) => {
    const b = base(o); const text = str(o.text); const members = strs(o.members)
    return b && text && members.length > 0 ? { ...b, text, members, clusters: strs(o.clusters) } : null
  })
  const kbLinks = eachItem<KbLink>(raw.kbLinks, (o) => {
    const b = base(o); const text = str(o.text); const topic = str(o.topic)
    const kind: KbKind | null = o.kind === 'apply' || o.kind === 'seed' || o.kind === 'blindspot' ? o.kind : null
    return b && text && topic && kind ? { ...b, kind, topic, text, insights: strs(o.insights) } : null
  })
  return { generatedAt: typeof raw.generatedAt === 'string' ? raw.generatedAt : '', lighthouses, insufficient, bridges, tensions, kbLinks }
}

export interface VerdictRow { id?: string | number; itemId: string; verdict: Verdict }

/** 依序折疊紀錄：每個項目只留最後一筆；undo＝沒判（移除）。 */
export function foldVerdicts(list: readonly VerdictRow[]): Map<string, 'ok' | 'no'> {
  const m = new Map<string, 'ok' | 'no'>()
  for (const r of list) {
    if (r.verdict === 'ok' || r.verdict === 'no') m.set(r.itemId, r.verdict)
    else if (r.verdict === 'undo') m.delete(r.itemId)
  }
  return m
}

/** 目前判定：有人工判定就用它；沒有時 feed 的 status:confirmed 算已確認。 */
export function verdictOf(verdicts: ReadonlyMap<string, 'ok' | 'no'>, item: { id: string; status: WeaveStatus }): 'ok' | 'no' | null {
  return verdicts.get(item.id) ?? (item.status === 'confirmed' ? 'ok' : null)
}

export const CONF_TEXT: Record<Confidence, string> = { high: '信心 高 ●●●', mid: '信心 中 ●●○', low: '信心 低 ●○○' }
export const KB_KIND_TEXT: Record<KbKind, string> = { apply: '可用在', seed: '可起頭', blindspot: '盲點' }

export interface ClusterWeave { lighthouses: Lighthouse[]; insufficient: Insufficient | null; bridges: Bridge[]; tensions: Tension[]; kb: KbLink[] }
export type InsightWeaveRefs = ClusterWeave
export interface WeaveIndex {
  payload: WeavePayload
  hasAny: boolean
  cluster: (cid: string) => ClusterWeave
  insight: (id: string) => InsightWeaveRefs
  /** 該島有幾個編織項目（燈塔＋證據不足＋橋＋張力＋知識庫） */
  total: (cid: string) => number
  /** 與該島有橋或跨島張力相連的島（含自己） */
  related: (cid: string) => Set<string>
}

const EMPTY: ClusterWeave = { lighthouses: [], insufficient: null, bridges: [], tensions: [], kb: [] }
const blank = (): ClusterWeave => ({ lighthouses: [], insufficient: null, bridges: [], tensions: [], kb: [] })
const push = <T>(list: T[], x: T): void => { if (!list.includes(x)) list.push(x) }

/** 依島、依心得 id 建索引。依據 id 不在心得清單的不列入；剩下沒有依據的項目整個丟掉。 */
export function weaveIndex(payload: WeavePayload, insights: readonly { id: string; cluster: string }[]): WeaveIndex {
  const known = new Map(insights.map((i) => [i.id, i.cluster]))
  const keep = (ids: readonly string[]): string[] => ids.filter((i) => known.has(i))
  const lighthouses = payload.lighthouses.map((l) => ({ ...l, evidence: keep(l.evidence) })).filter((l) => l.evidence.length > 0)
  const insufficient = payload.insufficient.map((x) => ({ ...x, evidence: keep(x.evidence) })).filter((x) => x.evidence.length > 0)
  const bridges = payload.bridges
    .map((b) => ({ ...b, ends: b.ends.map((e) => ({ ...e, evidence: keep(e.evidence) })).filter((e) => e.evidence.length > 0) }))
    .filter((b) => b.ends.length >= 2)
  const tensions = payload.tensions.map((t) => ({ ...t, members: keep(t.members) })).filter((t) => t.members.length > 0)
    .map((t) => ({ ...t, clusters: t.clusters.length > 0 ? t.clusters : [...new Set(t.members.map((m) => known.get(m)!))] }))
  const kbLinks = payload.kbLinks.map((k) => ({ ...k, insights: keep(k.insights) }))

  const byC = new Map<string, ClusterWeave>()
  const cw = (cid: string): ClusterWeave => { let c = byC.get(cid); if (!c) { c = blank(); byC.set(cid, c) } return c }
  const byI = new Map<string, ClusterWeave>()
  const iw = (id: string): ClusterWeave => { let c = byI.get(id); if (!c) { c = blank(); byI.set(id, c) } return c }

  for (const l of lighthouses) { push(cw(l.cluster).lighthouses, l); for (const id of l.evidence) push(iw(id).lighthouses, l) }
  for (const x of insufficient) { const c = cw(x.cluster); if (!c.insufficient) c.insufficient = x; for (const id of x.evidence) { const r = iw(id); if (!r.insufficient) r.insufficient = x } }
  for (const b of bridges) {
    for (const e of b.ends) { push(cw(e.cluster).bridges, b); for (const id of e.evidence) push(iw(id).bridges, b) }
  }
  for (const t of tensions) {
    for (const c of t.clusters) push(cw(c).tensions, t)
    for (const id of t.members) push(iw(id).tensions, t)
  }
  for (const k of kbLinks) {
    for (const id of k.insights) { push(iw(id).kb, k); const c = known.get(id); if (c) push(cw(c).kb, k) }
  }
  const total = (cid: string): number => { const c = byC.get(cid); return c ? c.lighthouses.length + (c.insufficient ? 1 : 0) + c.bridges.length + c.tensions.length + c.kb.length : 0 }
  const related = (cid: string): Set<string> => {
    const s = new Set<string>([cid])
    const c = byC.get(cid)
    if (!c) return s
    for (const b of c.bridges) for (const e of b.ends) s.add(e.cluster)
    for (const t of c.tensions) for (const x of t.clusters) s.add(x)
    return s
  }
  return {
    payload: { ...payload, lighthouses, insufficient, bridges, tensions, kbLinks },
    hasAny: lighthouses.length + insufficient.length + bridges.length + tensions.length + kbLinks.length > 0,
    cluster: (cid) => byC.get(cid) ?? EMPTY,
    insight: (id) => byI.get(id) ?? EMPTY,
    total, related,
  }
}
