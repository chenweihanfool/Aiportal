// 週報／月報原文 → 段落卡片（純函式）。報告是 AI 依提示寫的 Markdown，標題多半是 `### 📊 本週概覽` 這種；
// 舊世代有 `**📊 本週重點**` 粗體單行當標題、或完全沒有標題。認不出段落時回空陣列，呼叫端退回整份 Markdown，內容不會少。
// 時間軸設計：kb-pipeline docs/timeline-design.md。

export type SectionKind = 'hero' | 'tasks' | 'people' | 'cases' | 'next' | 'generic'
export interface ReportSection { icon: string | null; title: string; kind: SectionKind; body: string }
export interface ParsedReport { title: string | null; intro: string; sections: ReportSection[] }

const HEAD = /^(#{1,3})\s+(.+?)\s*#*\s*$/
const BOLD_LINE = /^\*\*(.{1,40}?)\*\*\s*$/
const FENCE = /^\s*(```|~~~)/
// 開頭的 emoji（含變體選擇符、ZWJ 組合）
const LEAD_ICON = /^((?:\p{Extended_Pictographic}[︎️‍]*)+)\s*/u

export function splitTitle(raw: string): { icon: string | null; title: string } {
  const t = raw.replace(/\*\*/g, '').trim()
  const m = LEAD_ICON.exec(t)
  return m ? { icon: m[1]!, title: t.slice(m[0].length).trim() || t } : { icon: null, title: t }
}

export function kindOf(title: string): SectionKind {
  if (/觀察|策略|方向|下週|下月|下季/.test(title)) return 'next'      // 先判斷：「下週觀察重點」不能被「重點」吃掉
  if (/概覽|重點|主題|一句話|濃縮/.test(title)) return 'hero'
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
    const bold = !fenced ? BOLD_LINE.exec(line) : null
    if (h && h[1]!.length === 1 && title === null && sections.length === 0) { title = splitTitle(h[2]!).title; continue }
    if (h && h[1]!.length >= 2) { sections.push({ raw: h[2]!, body: [] }); continue }
    if (bold) { sections.push({ raw: bold[1]!, body: [] }); continue }
    if (sections.length === 0) intro.push(line)
    else sections[sections.length - 1]!.body.push(line)
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
