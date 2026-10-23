import { useMemo, useState, type ReactNode } from 'react'
import { apiFetchIdeas } from './boardApi'
import { apiFetchFood } from './foodApi'
import { apiFetchTrips, taipeiTodayIso } from './tripsApi'
import { useAsync } from './homeHooks'
import { MarkdownView } from './MarkdownView'
import { ReportCharts, ScoreBars } from './ReportCharts'
import type { ReportScore } from './timelineApi'
import { buildPeriodReport, inputFromData } from './periodStats'
import { parseReportSections, parseTaskLines, splitEntries, type ReportSection } from './reportSections'
import { Skeleton } from './StateFrame'

// 週報／月報的視覺化版面（時間軸報告對話框裡，取代原本整篇 Markdown）：
// 上方圖表帶（想法・美食・旅遊・活動節奏，依報告期間現算）＋ 下方依原文段落拆成的卡片（概覽放大、任務清單帶到期日、
// 人物與案件各一張卡、其餘段落照 Markdown）。可切到「原文」看完整 Markdown；認不出段落時整份退回原文。
// 設計：kb-pipeline docs/report-visual-design.md（2026-10-23 修訂）。

export const VISUAL_LEVELS = ['day', 'week', 'month', 'quarter', 'year'] as const
export type VisualLevel = (typeof VISUAL_LEVELS)[number]
export const isVisualLevel = (l: string): l is VisualLevel => (VISUAL_LEVELS as readonly string[]).includes(l)

const KIND_TONE: Record<string, string> = {
  hero: 'var(--c-accent)', tasks: 'var(--c-warn)', people: 'var(--c-ok)', cases: 'var(--c-ink-2)', next: 'var(--c-accent)',
  warn: 'var(--c-warn)', action: 'var(--c-ok)', generic: 'var(--c-line-strong)',
}

function SectionCard({ s, md }: { s: ReportSection; md: (text: string, size?: string) => ReactNode }) {
  const tasks = s.kind === 'tasks' ? parseTaskLines(s.body) : null
  const entries = s.kind === 'people' || s.kind === 'cases' ? splitEntries(s.body) : null
  return (
    <section className="rb-card" data-kind={s.kind} data-testid={`rb-section-${s.kind}`} style={{ ['--rb-tone' as string]: KIND_TONE[s.kind] }}>
      <h3 className="rb-h">{s.icon && <span aria-hidden>{s.icon}</span>}{s.title}</h3>
      {s.kind === 'hero' ? <div className="rb-hero">{md(s.body, '1.2rem')}</div> : tasks ? (
        <ul className="rb-tasks" aria-label={s.title}>
          {tasks.map((t, i) => (
            <li key={i} data-kind={t.kind}>
              <span className="rb-task-t">{t.text}</span>
              {t.date && <span className="rb-chip" data-kind={t.kind}>{t.kind === 'overdue' ? '逾期' : '到期'} {t.date.slice(5)}</span>}
            </li>
          ))}
        </ul>
      ) : entries ? (
        <div className="rb-entries">
          {entries.map((e, i) => (
            <div key={i} className="rb-entry">
              <div className="rb-entry-h">{md(e.head)}</div>
              {e.body && <div className="rb-entry-b">{md(e.body, '1rem')}</div>}
            </div>
          ))}
        </div>
      ) : md(s.body)}
    </section>
  )
}

export function ReportBody({ level, startDate, endDate, bodyMd, reportScore, password, md }: {
  level: VisualLevel
  startDate: string
  endDate: string
  bodyMd: string
  /** 僅日報：每日報告分數（日報 📊 段） */
  reportScore?: ReportScore | null
  password: string | null
  /** 原本時間軸用的 Markdown 渲染（帶 wikilink 解析與附件預覽），由對話框傳入 */
  md: (text: string, size?: string) => ReactNode
}) {
  const [raw, setRaw] = useState(false)
  const ideas = useAsync(password, apiFetchIdeas)
  const food = useAsync(password, apiFetchFood)
  const trips = useAsync(password, apiFetchTrips)
  const parsed = useMemo(() => parseReportSections(bodyMd), [bodyMd])
  const settled = (a: { data: unknown; error: boolean }) => a.data !== null || a.error
  const ready = !!password && settled(ideas) && settled(food) && settled(trips)
  const missing = [ideas.error && ideas.data === null ? '想法庫' : '', food.error && food.data === null ? '美食地點' : '', trips.error && trips.data === null ? '遊記' : ''].filter(Boolean)
  const report = useMemo(
    () => (ready ? buildPeriodReport(inputFromData(ideas.data, food.data?.places ?? null, trips.data?.trips ?? null), [startDate, endDate], taipeiTodayIso()) : null),
    [ready, ideas.data, food.data, trips.data, startDate, endDate],
  )
  const structured = parsed.sections.length > 0

  return (
    <div data-testid="report-body" data-level={level}>
      <div className="rb-toggle" role="group" aria-label="報告版面">
        <button type="button" className="dp-range" aria-pressed={!raw} data-testid="rb-mode-visual" onClick={() => setRaw(false)}>圖表版</button>
        <button type="button" className="dp-range" aria-pressed={raw} data-testid="rb-mode-raw" onClick={() => setRaw(true)}>原文</button>
      </div>
      {raw ? md(bodyMd, '1.1rem') : (
        <>
          {level === 'day' && reportScore && <div className="rp-band"><ScoreBars score={reportScore} /></div>}
          {password && (ready ? (report && <ReportCharts r={report} level={level} missing={missing} />) : <Skeleton lines={4} />)}
          {structured ? (
            <div className="rb-sections" data-testid="rb-sections">
              {parsed.intro && <div className="rb-intro">{md(parsed.intro, '1.02rem')}</div>}
              {parsed.sections.map((s, i) => <SectionCard key={i} s={s} md={md} />)}
            </div>
          ) : md(bodyMd, '1.1rem')}
        </>
      )}
    </div>
  )
}
