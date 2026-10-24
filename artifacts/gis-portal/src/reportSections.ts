// 週報／月報原文 → 段落卡片（純函式）。報告是 AI 依提示寫的 Markdown，標題多半是 `### 📊 本週概覽` 這種；
// 舊世代有 `**📊 本週重點**` 粗體單行當標題、或完全沒有標題。認不出段落時回空陣列，呼叫端退回整份 Markdown，內容不會少。
// 時間軸設計：kb-pipeline docs/timeline-design.md。

export type SectionKind = 'hero' | 'tasks' | 'people' | 'cases' | 'next' | 'warn' | 'action' | 'echo' | 'question' | 'joke' | 'score' | 'generic'
export interface ReportSection { icon: string | null; title: string; kind: SectionKind; body: string }
export interface ParsedReport { title: string | null; intro: string; sections: ReportSection[] }

const HEAD = /^(#{1,3})\s+(.+?)\s*#*\s*$/
const BOLD_LINE = /^\*\*(.{1,40}?)\*\*\s*$/
// 「⚡ **狀態與決策**」：emoji 在粗體外面（日報第三代格式的段落標題）
const EMOJI_BOLD_LINE = /^((?:\p{Extended_Pictographic}[\uFE0E\uFE0F\u200D]*)+)\s*\*\*(.{1,40}?)\*\*\s*$/u
// 日報條列模組：`- 📝 當日總結（約 90 字）：內容`；實際日報多半沒有開頭的「- 」：`🎯 高槓桿行動：內容`
const DAILY_MODULE = /^(?:[-*]\s*)?((?:\p{Extended_Pictographic}[\uFE0E\uFE0F\u200D]*)+)\s*([^：:（(]{1,30}?)\s*(?:[（(][^）)]*[）)])?\s*[：:]\s*(.*)$/u
const FENCE = /^\s*(```|~~~)/
const SCORE_HEAD = /^\s*📊\s*今日評分\s*[：:]\s*(.*)$/u
// 開頭的 emoji（含變體選擇符、ZWJ 組合）
const LEAD_ICON = /^((?:\p{Extended_Pictographic}[︎️‍]*)+)\s*/u

export function splitTitle(raw: string): { icon: string | null; title: string } {
  const t = raw.replace(/\*\*/g, '').trim()
  const m = LEAD_ICON.exec(t)
  return m ? { icon: m[1]!, title: t.slice(m[0].length).trim() || t } : { icon: null, title: t }
}

export function kindOf(title: string): SectionKind {
  if (/共鳴|呼應/.test(title)) return 'echo'
  if (/評分/.test(title)) return 'score'
  if (/一問|提問/.test(title)) return 'question'
  if (/段子/.test(title)) return 'joke'
  if (/觀察|策略|方向|下週|下月|下季|來年/.test(title)) return 'next'      // 先判斷：「下週觀察重點」不能被「重點」吃掉
  if (/盲點|懸浮|卡點|風險|矛盾/.test(title)) return 'warn'
  if (/高槓桿|行動/.test(title)) return 'action'
  if (/概覽|重點|主題|一句話|濃縮|總結|敘事/.test(title)) return 'hero'
  if (/任務/.test(title)) return 'tasks'
  if (/人事|協同|人物|業務畫像/.test(title)) return 'people'
  if (/專案|案件/.test(title)) return 'cases'
  return 'generic'
}

export function parseReportSections(md: string): ParsedReport {
  const lines = md.replace(/\r\n?/g, '\n').split('\n')
  let title: string | null = null
  const intro: string[] = []
  const sections: Array<{ raw: string; body: string[] }> = []
  let fenced = false
  for (const line of lines) {
    if (FENCE.test(line)) fenced = !fenced
    const h = !fenced ? HEAD.exec(line) : null
    const eb = !fenced ? EMOJI_BOLD_LINE.exec(line) : null
    const boldTitle = fenced ? null : (BOLD_LINE.exec(line)?.[1] ?? (eb ? `${eb[1]} ${eb[2]}` : null))
    if (h && h[1]!.length === 1 && title === null && sections.length === 0) { title = splitTitle(h[2]!).title; continue }
    if (h && h[1]!.length >= 2) { sections.push({ raw: h[2]!, body: [] }); continue }
    // 「📅 **週報 2026-06-21 ~ 2026-06-27**」這種首行是報告標題，不是段落
    if (eb && title === null && sections.length === 0 && /報|\d{4}-\d{2}/.test(eb[2]!)) { title = eb[2]!.trim(); continue }
    if (boldTitle) { sections.push({ raw: boldTitle, body: [] }); continue }
    if (sections.length === 0) intro.push(line)
    else sections[sections.length - 1]!.body.push(line)
  }
  if (sections.length === 0) {
    const daily = parseDailyModules(lines)
    if (daily) return { title, intro: daily.intro, sections: daily.sections }
  }
  return {
    title,
    intro: intro.join('\n').trim(),
    sections: sections.map((s) => {
      const { icon, title: t } = splitTitle(s.raw)
      return { icon, title: t, kind: kindOf(t), body: s.body.join('\n').trim() }
    }).filter((s) => s.body !== '' || s.title !== ''),
  }
}

/** 日報條列模組（- 📝 當日總結：…）→ 段落；少於 3 個模組不當作這種格式 */
function parseDailyModules(lines: string[]): { intro: string; sections: ReportSection[] } | null {
  const mods: Array<{ raw: string; icon: string; head: string; body: string[] }> = []
  const intro: string[] = []
  for (const line of lines) {
    // 尾端的「📊 今日評分：60」與五行依據自成一段，不要黏在最後一個模組（😄／💭）裡
    const score = SCORE_HEAD.exec(line)
    if (score && mods.length > 0) { mods.push({ raw: line, icon: '📊', head: '今日評分', body: [score[1]!.trim()] }); continue }
    const m = DAILY_MODULE.exec(line)
    if (m) { mods.push({ raw: line, icon: m[1]!, head: m[2]!.trim(), body: m[3] ? [m[3]] : [] }); continue }
    if (mods.length === 0) intro.push(line)
    else if (!/^#{1,6}\s/.test(line) && line.trim() !== '') mods[mods.length - 1]!.body.push(line.trim())
  }
  if (mods.length < 3) return null
  return {
    intro: intro.filter((l) => !/^#{1,3}\s/.test(l)).join('\n').trim(),
    sections: mods.map((m) => ({ icon: m.icon, title: m.head, kind: kindOf(m.head), body: m.body.join('\n').trim() })),
  }
}

export interface TaskLine { text: string; kind: 'overdue' | 'due' | 'plain'; date: string | null }

const TASK_TAIL = /[（(]\s*(逾期|到期)\s*(\d{4}-\d{2}-\d{2})\s*[）)]\s*$/

/** 任務段落 → 逐項清單（逾期／到期日拆成徽章）。沒有任何清單項目回 null（呼叫端退回 Markdown） */
export function parseTaskLines(body: string): TaskLine[] | null {
  const out: TaskLine[] = []
  for (const line of body.split('\n')) {
    const m = /^\s*(?:[-*•]|\d+[.)])\s+(.+?)\s*$/.exec(line)
    if (!m) continue
    const tail = TASK_TAIL.exec(m[1]!)
    out.push(tail
      ? { text: m[1]!.slice(0, tail.index).trim(), kind: tail[1] === '逾期' ? 'overdue' : 'due', date: tail[2]! }
      : { text: m[1]!, kind: 'plain', date: null })
  }
  return out.length > 0 ? out : null
}

export interface CardEntry { head: string; body: string }

/** 人事／案件段落：頂層清單項目（`- **[[名稱]]**…`）各成一張卡；沒有這種結構回 null */
export function splitEntries(body: string): CardEntry[] | null {
  const lines = body.split('\n')
  const entries: Array<{ head: string; rest: string[] }> = []
  for (const line of lines) {
    const m = /^[-*]\s+(\*\*.+)$/.exec(line)
    if (m) entries.push({ head: m[1]!, rest: [] })
    else if (entries.length > 0) entries[entries.length - 1]!.rest.push(line)
  }
  if (entries.length === 0) return null
  return entries.map((e) => ({ head: e.head, body: e.rest.map((l) => l.replace(/^ {2,4}/, '')).join('\n').trim() }))
}

// 段落裡的視覺化子項（kb-pipeline docs/report-visual-modules.md）：模組一句話之後接「  - 」開頭的固定格式子項，
// 依格式（不依段落）認成下列幾種，前端各畫成一種小圖；認不出的行留在 lead 照 Markdown 顯示，所以舊報告不受影響。
//   day      `[[2025-10-24]]（365 天前）那天… → 今天…`、`2026-10-27｜總點數呈報`   過去可點、未來倒數的時間線
//   thread   `〔王小明〕□□■□■□□□■□□■（近 12 週出現 4 週）走向`                    出現格（一格一個時間單位）
//   slot     `上午｜外業｜北港段界址測量`                                           一天的時段帶＋重心比例
//   stuck    `7 天｜PR#14 loadKg 驗收待實測`                                        懸浮天數條
//   spectrum `獨立機制↔深度人際｜2｜今天偏機制`（值 1–5，可寫 `2→3→4` 表示走向）   光譜滑桿
//   lane     `延續｜…`、`推進｜…`、`強化｜…`                                         分欄看板
//   phase    `第1週｜…`、`Q1｜…`、`3月｜…`                                           階段步驟
// 日報 🕰️ 的格式見 kb-pipeline docs/daily-insight-echo.md；舊日報沒有子項，只有一段含 YYYY-MM-DD 的文字：日期改包成 [[日期]]。
export type VizItem =
  | { kind: 'day'; date: string; text: string }
  | { kind: 'thread'; name: string; cells: boolean[]; text: string }
  | { kind: 'slot'; slot: string; tag: string; text: string }
  | { kind: 'stuck'; days: number; text: string }
  | { kind: 'spectrum'; left: string; right: string; values: number[]; text: string }
  | { kind: 'lane'; lane: string; text: string }
  | { kind: 'phase'; label: string; text: string }
export type EchoItem = Extract<VizItem, { kind: 'day' | 'thread' }>
export interface VizBlock { lead: string; items: VizItem[] }
export interface EchoBlock { lead: string; items: EchoItem[] }

const ISO_DATE = /\d{4}-\d{2}-\d{2}/
const SEP = '\\s*[｜|]\\s*'
const ECHO_DAY = /^\[?\[?(\d{4}-\d{2}-\d{2})\]?\]?\s*(?:[（(][^）)]*天[前後][）)])?\s*[：:｜|]?\s*(.*)$/
const ECHO_THREAD = /^[〔[]([^〕\]]{1,30})[〕\]]\s*([■□]{2,})\s*(.*)$/
export const DAY_SLOTS = ['清晨', '早上', '上午', '中午', '下午', '傍晚', '晚上', '深夜', '全天'] as const
const VIZ_SLOT = new RegExp(`^(${DAY_SLOTS.join('|')})${SEP}([^｜|]{1,8}?)${SEP}(.+)$`)
const VIZ_STUCK = new RegExp(`^(\\d{1,4})\\s*天${SEP}(.+)$`)
const VIZ_SPECTRUM = new RegExp(`^([^｜|↔]{1,16}?)\\s*(?:↔|<->)\\s*([^｜|]{1,16}?)${SEP}([1-5](?:\\s*(?:→|->)\\s*[1-5])*)(?:${SEP}(.*))?$`)
// 分欄的固定標籤（順序就是畫面上的欄序）
export const VIZ_LANES = ['延續', '斷裂', '新出現', '推進', '停滯', '進步', '退步', '強化', '鬆動', '新浮現', '開始認同', '不再認同'] as const
const VIZ_LANE = new RegExp(`^(${VIZ_LANES.join('|')})${SEP}(.+)$`)
const VIZ_PHASE = new RegExp(`^(第\\s*\\d{1,2}\\s*[週月季]|Q[1-4]|\\d{1,2}\\s*月|[上中下]旬)${SEP}(.+)$`)

/** 一行子項（已去掉開頭的「- 」）→ 視覺化項目；不是任何固定格式回 null */
export function parseVizLine(t: string): VizItem | null {
  let m: RegExpExecArray | null
  if ((m = VIZ_SLOT.exec(t))) return { kind: 'slot', slot: m[1]!, tag: m[2]!.trim(), text: m[3]!.trim() }
  if ((m = VIZ_STUCK.exec(t))) return { kind: 'stuck', days: Number(m[1]), text: m[2]!.trim() }
  if ((m = VIZ_SPECTRUM.exec(t))) {
    return { kind: 'spectrum', left: m[1]!.trim(), right: m[2]!.trim(), values: m[3]!.split(/→|->/).map((v) => Number(v.trim())), text: (m[4] ?? '').trim() }
  }
  if ((m = VIZ_LANE.exec(t))) return { kind: 'lane', lane: m[1]!, text: m[2]!.trim() }
  if ((m = VIZ_PHASE.exec(t))) return { kind: 'phase', label: m[1]!.replace(/\s+/g, ''), text: m[2]!.trim() }
  if ((m = ECHO_DAY.exec(t))) return { kind: 'day', date: m[1]!, text: m[2]!.trim() }
  if ((m = ECHO_THREAD.exec(t))) return { kind: 'thread', name: m[1]!.trim(), cells: [...m[2]!].map((c) => c === '■'), text: m[3]!.trim() }
  return null
}

/** 段落內文 → 一句話（其餘文字）＋視覺化子項 */
export function parseViz(body: string): VizBlock {
  const lead: string[] = []
  const items: VizItem[] = []
  for (const raw of body.split('\n')) {
    const li = /^\s*[-*•]\s+(.+?)\s*$/.exec(raw)
    const item = li ? parseVizLine(li[1]!) : null
    if (item) items.push(item)
    else lead.push(raw)
  }
  return { lead: lead.join('\n').trim(), items }
}

/** 不在 [[ ]] 裡的 YYYY-MM-DD 包成 [[YYYY-MM-DD]] */
export function linkifyDates(text: string): string {
  return text.replace(/(\[\[[^\]]*\]\])|(\d{4}-\d{2}-\d{2})/g, (m, link: string | undefined) => (link ? m : `[[${m}]]`))
}

/** 🕰️ 歷史共鳴：只認日期與脈絡線兩種子項（其他格式的行留在 lead），lead 裡的日期包成連結 */
export function parseEcho(body: string): EchoBlock {
  const lead: string[] = []
  const items: EchoItem[] = []
  for (const raw of body.split('\n')) {
    const li = /^\s*[-*•]\s+(.+?)\s*$/.exec(raw)
    const item = li ? parseVizLine(li[1]!) : null
    if (item && (item.kind === 'day' || item.kind === 'thread')) items.push(item)
    else lead.push(raw)
  }
  return { lead: linkifyDates(lead.join('\n').trim()), items }
}

export interface ScorePart { label: string; value: number; note: string }

/** 📊 今日評分段：首行總分＋「- 推進 3：依據」；少於 3 項回 null（呼叫端退回 Markdown） */
export function parseScoreSection(body: string): { total: number | null; parts: ScorePart[] } | null {
  const parts: ScorePart[] = []
  let total: number | null = null
  for (const line of body.split('\n')) {
    const p = /^\s*[-*•]\s*([^\d\s：:]{1,6})\s*([0-4])\s*[：:]?\s*(.*)$/.exec(line)
    if (p) { parts.push({ label: p[1]!, value: Number(p[2]), note: p[3]!.trim() }); continue }
    const t = /^\s*(\d{1,3})\s*(?:分)?\s*$/.exec(line)
    if (t && total === null) total = Number(t[1])
  }
  return parts.length >= 3 ? { total, parts } : null
}

export interface FlowStep { label: string; text: string }

/** 案件卡片的「進展摘要／卡關點／下一步」→ 三格流程；少於兩格回 null */
export function parseCaseFlow(body: string): FlowStep[] | null {
  const want: Array<[RegExp, string]> = [[/^進展/, '進展'], [/^卡關/, '卡關'], [/^下一步/, '下一步']]
  const out: FlowStep[] = []
  for (const line of body.split('\n')) {
    const m = /^\s*[-*•]\s*([^：:]{1,8})[：:]\s*(.+)$/.exec(line)
    if (!m) continue
    const hit = want.find(([re]) => re.test(m[1]!.trim()))
    if (hit && !out.some((s) => s.label === hit[1])) out.push({ label: hit[1], text: m[2]!.trim() })
  }
  return out.length >= 2 ? out : null
}

/** 兩個 YYYY-MM-DD 相差幾天（a − b） */
function dayDiff(a: string, b: string): number {
  return Math.round((Date.parse(`${a}T00:00:00Z`) - Date.parse(`${b}T00:00:00Z`)) / 86_400_000)
}

/** 「一年前」「3 個月前」「43 天前」：以報告日期為準，不信任文字裡模型寫的天數 */
export function agoLabel(date: string, reportDate: string): string {
  if (!ISO_DATE.test(date) || !ISO_DATE.test(reportDate)) return ''
  const n = dayDiff(reportDate, date)
  if (n <= 0) return n === 0 ? '當天' : `${-n} 天後`
  const years = Math.round(n / 365)
  if (n >= 330 && Math.abs(n - years * 365) <= 10) return years === 1 ? '一年前' : `${years} 年前`
  if (n >= 60) return `${Math.round(n / 30)} 個月前`
  return `${n} 天前`
}
