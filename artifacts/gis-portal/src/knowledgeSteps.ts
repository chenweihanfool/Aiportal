// 方法頁步驟卡（3.13.0）：feed `topics` v1 選用欄位 business／steps 的型別、解析與純函式。
// 契約以 schemas/feeds/topics.v1.schema.json 為準；任何欄位不合格的子項在這裡丟掉，呼叫端只看到合法資料。
// 元件在 KnowledgeSteps.tsx；測試在 knowledgeSteps.test.ts。

export type StepDocRole = '公文' | '圖表' | '表單'
export const STEP_DOC_TYPES = ['函', '簽', '書函', '公告', '便簽', '其他公文', '圖表', '表單', '其他'] as const
export type StepDocType = (typeof STEP_DOC_TYPES)[number]

export interface StepDoc {
  templateId: string
  family: string
  docType: StepDocType
  role: StepDocRole
  score: number
  /** 同家族另有幾個舊版（chip 後顯示「＋n 版」） */
  others: number
  evidence: string[]
}

export interface StepRule {
  text: string
  /** 例：第221條 */
  article: string
  claim: string
  /** sources 的 1 起算位置（原文面板用） */
  src: number
}

export interface StepInsight { insightId: string; quote: string; date: string }
export interface StepPitfall { text: string; claim: string; case: string | null }
export interface StepCase { case: string; date: string | null }

export interface TopicStep {
  id: string
  title: string
  claim: string
  /** 對應圖解的節點 id；null＝沒有對應 */
  node: string | null
  docs: StepDoc[]
  why: { rules: StepRule[]; insights: StepInsight[]; pitfalls: StepPitfall[] }
  cases: StepCase[]
}

type Rec = Record<string, unknown>
const isRec = (v: unknown): v is Rec => !!v && typeof v === 'object' && !Array.isArray(v)
const isStr = (v: unknown): v is string => typeof v === 'string'
const strIn = (v: unknown, min: number, max: number): v is string => isStr(v) && v.length >= min && v.length <= max
const isInt = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v)
const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v)
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/

const STEP_ID_RE = /^s[0-9]{1,2}$/
const CLAIM_RE = /^c[0-9]{3,5}$/
const NODE_RE = /^[a-z0-9]{1,8}$/
const TEMPLATE_RE = /^tpl_[0-9a-f]{10}$/
const ARTICLE_RE = /^第[0-9]{1,4}條(之[0-9]{1,2})?$/
const INSIGHT_RE = /^INS-\d{4}-\d{2}-\d{2}-[0-9a-f]{8}$/

function parseDoc(raw: unknown): StepDoc | null {
  if (!isRec(raw)) return null
  if (!isStr(raw.templateId) || !TEMPLATE_RE.test(raw.templateId)) return null
  if (!strIn(raw.family, 1, 60)) return null
  if (!(STEP_DOC_TYPES as readonly unknown[]).includes(raw.docType)) return null
  if (raw.role !== '公文' && raw.role !== '圖表' && raw.role !== '表單') return null
  if (!isNum(raw.score) || raw.score < 0 || raw.score > 1) return null
  if (!isInt(raw.others) || raw.others < 0 || raw.others > 99) return null
  if (!Array.isArray(raw.evidence) || raw.evidence.length > 3) return null
  if (!raw.evidence.every((e) => strIn(e, 1, 60))) return null
  return {
    templateId: raw.templateId,
    family: raw.family,
    docType: raw.docType as StepDocType,
    role: raw.role,
    score: raw.score,
    others: raw.others,
    evidence: raw.evidence as string[],
  }
}

function parseRule(raw: unknown): StepRule | null {
  if (!isRec(raw)) return null
  if (!strIn(raw.text, 1, 120) || !isStr(raw.article) || !ARTICLE_RE.test(raw.article)) return null
  if (!isStr(raw.claim) || !CLAIM_RE.test(raw.claim)) return null
  if (!isInt(raw.src) || raw.src < 1 || raw.src > 80) return null
  return { text: raw.text, article: raw.article, claim: raw.claim, src: raw.src }
}

function parseInsight(raw: unknown): StepInsight | null {
  if (!isRec(raw)) return null
  if (!isStr(raw.insightId) || !INSIGHT_RE.test(raw.insightId)) return null
  if (!strIn(raw.quote, 1, 80) || !isStr(raw.date) || !DATE_RE.test(raw.date)) return null
  return { insightId: raw.insightId, quote: raw.quote, date: raw.date }
}

function parsePitfall(raw: unknown): StepPitfall | null {
  if (!isRec(raw)) return null
  if (!strIn(raw.text, 1, 120) || !isStr(raw.claim) || !CLAIM_RE.test(raw.claim)) return null
  if (raw.case !== null && !strIn(raw.case, 1, 60)) return null
  return { text: raw.text, claim: raw.claim, case: raw.case === null ? null : raw.case }
}

function parseCase(raw: unknown): StepCase | null {
  if (!isRec(raw)) return null
  if (!strIn(raw.case, 1, 60)) return null
  if (raw.date !== null && (!isStr(raw.date) || !DATE_RE.test(raw.date))) return null
  return { case: raw.case, date: raw.date === null ? null : raw.date }
}

function list<T>(raw: unknown, max: number, parse: (v: unknown) => T | null): T[] {
  if (!Array.isArray(raw)) return []
  const out: T[] = []
  for (const item of raw.slice(0, max)) {
    const parsed = parse(item)
    if (parsed) out.push(parsed)
  }
  return out
}

function parseStep(raw: unknown): TopicStep | null {
  if (!isRec(raw)) return null
  if (!isStr(raw.id) || !STEP_ID_RE.test(raw.id)) return null
  if (!strIn(raw.title, 1, 30)) return null
  if (!isStr(raw.claim) || !CLAIM_RE.test(raw.claim)) return null
  if (raw.node !== null && (!isStr(raw.node) || !NODE_RE.test(raw.node))) return null
  const why = isRec(raw.why) ? raw.why : {}
  return {
    id: raw.id,
    title: raw.title,
    claim: raw.claim,
    node: raw.node === null ? null : raw.node,
    docs: list(raw.docs, 6, parseDoc),
    why: {
      rules: list(why.rules, 3, parseRule),
      insights: list(why.insights, 2, parseInsight),
      pitfalls: list(why.pitfalls, 3, parsePitfall),
    },
    cases: list(raw.cases, 8, parseCase),
  }
}

/** 不是陣列回 []；單一子項不合格只丟那一項（步驟本身的 id／title／claim／node 不合格就丟整個步驟）。 */
export function parseSteps(raw: unknown): TopicStep[] {
  if (!Array.isArray(raw)) return []
  const out: TopicStep[] = []
  for (const item of raw.slice(0, 30)) {
    const step = parseStep(item)
    if (step) out.push(step)
  }
  return out
}

export type UnlinkKind = 'doc' | 'insight' | 'rule' | 'pitfall' | 'case'

/** 不相關按鈕送出的 text：<類型>:<識別碼>（後端 unlink 的格式） */
export function unlinkText(kind: UnlinkKind, value: string): string {
  return `${kind}:${value}`
}

/** 案件 chip → 來源面板的 1 起算位置：t.sources 中第一個 case 相符的；找不到回 null */
export function caseSourcePosition(sources: readonly { case?: string }[], caseName: string): number | null {
  const i = sources.findIndex((s) => s.case === caseName)
  return i < 0 ? null : i + 1
}

/** business 為 null＝這頁沒有任何範本，整頁不顯示 📄 列；undefined（舊頁）照常顯示 */
export function showsDocs(business: string | null | undefined): boolean {
  return business !== null
}

/** 步驟卡有沒有對應到這個圖解節點（圖解點節點時決定要不要捲到卡片） */
export function stepForNode(steps: readonly Pick<TopicStep, 'id' | 'node'>[], nodeId: string): Pick<TopicStep, 'id' | 'node'> | null {
  return steps.find((s) => s.node === nodeId) ?? null
}

export interface InsightUsage { topicId: string; topicName: string; stepNo: number; stepTitle: string }

/** 心得面板「用在」：找出哪些題目的哪個步驟（序號 1 起算）引用了這則心得 */
export function insightUsages(
  topics: readonly { id: string; name: string; steps?: readonly Pick<TopicStep, 'title' | 'why'>[] }[],
  insightId: string,
): InsightUsage[] {
  const out: InsightUsage[] = []
  for (const t of topics) {
    ;(t.steps ?? []).forEach((st, i) => {
      if (st.why.insights.some((x) => x.insightId === insightId)) out.push({ topicId: t.id, topicName: t.name, stepNo: i + 1, stepTitle: st.title })
    })
  }
  return out
}
