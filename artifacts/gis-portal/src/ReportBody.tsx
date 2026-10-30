import { useMemo, useState, type ReactNode } from 'react'
import { apiFetchIdeas } from './boardApi'
import { apiFetchFood } from './foodApi'
import { apiFetchTrips, taipeiTodayIso } from './tripsApi'
import { useAsync } from './homeHooks'
import { MarkdownView } from './MarkdownView'
import { DailyScoreCard, ReportCharts, ScoreBars } from './ReportCharts'
import { dailyScore } from './dailyScore'
import { MilestoneCard } from './ReportMilestones'
import { apiFetchDailyLife, apiFetchTasksDone, buildMilestones } from './milestones'
import type { ReportScore } from './timelineApi'
import { buildPeriodReport, inputFromData } from './periodStats'
import { parseCaseFlow, parseEcho, parseReportSections, parseScoreSection, parseTaskLines, parseViz, splitEntries, type ReportSection } from './reportSections'
import { ScoreRadar, VizItems } from './ReportViz'
import { Skeleton } from './StateFrame'

// 週報／月報的視覺化版面（時間軸報告對話框裡，取代原本整篇 Markdown）：
// 最上面 🏁 里程碑卡（完成任務＋新想法＋想法實行，近 N 期走勢與年度關卡，見 ReportMilestones.tsx）＋ 圖表帶（想法・美食・旅遊・活動節奏，依報告期間現算）＋ 下方依原文段落拆成的卡片（概覽放大、任務清單帶到期日、
// 人物與案件各一張卡、其餘段落的固定格式子項畫成小圖，見 ReportViz.tsx）。可切到「原文」看完整 Markdown；認不出段落時整份退回原文。
// 設計：kb-pipeline docs/report-visual-design.md（2026-10-23 修訂）。

export const VISUAL_LEVELS = ['day', 'week', 'month', 'quarter', 'year'] as const
export type VisualLevel = (typeof VISUAL_LEVELS)[number]
export const isVisualLevel = (l: string): l is VisualLevel => (VISUAL_LEVELS as readonly string[]).includes(l)

const KIND_TONE: Record<string, string> = {
  hero: 'var(--c-accent)', tasks: 'var(--c-warn)', people: 'var(--c-ok)', cases: 'var(--c-ink-2)', next: 'var(--c-accent)',
  warn: 'var(--c-warn)', action: 'var(--c-ok)', echo: 'var(--c-accent)', question: 'var(--c-accent)', joke: 'var(--c-ok)',
  score: 'var(--c-accent)', generic: 'var(--c-line-strong)',
}

type Md = (text: string, size?: string) => ReactNode

/** 一個段落：先畫一句話（lead），再畫固定格式子項的小圖（ReportViz.tsx）。🕰️ 只認日期與脈絡線，lead 裡的日期包成連結。 */
function VizBody({ s, level, refDate, md, onOpenDay }: { s: ReportSection; level: VisualLevel; refDate: string; md: Md; onOpenDay?: (date: string) => void }) {
  const { lead, items } = s.kind === 'echo' ? parseEcho(s.body) : parseViz(s.body)
  if (items.length === 0) return s.kind === 'hero' ? <div className="rb-hero">{md(lead, '1.2rem')}</div> : <>{md(lead)}</>
  return (
    <>
      {lead && <div className={s.kind === 'hero' ? 'rb-hero' : 'rb-echo-lead'}>{md(lead, s.kind === 'hero' ? '1.2rem' : '1.05rem')}</div>}
      <VizItems items={items} level={level} refDate={refDate} md={md} onOpenDay={onOpenDay} />
    </>
  )
}

/** 人物／案件卡；案件的「進展摘要／卡關點／下一步」畫成三格流程 */
function Entry({ head, body, md }: { head: string; body: string; md: Md }) {
  const flow = parseCaseFlow(body)
  return (
    <div className="rb-entry">
      <div className="rb-entry-h">{md(head)}</div>
      {flow ? (
        <ol className="rb-flow">
          {flow.map((f, i) => (
            <li key={i} data-step={f.label} data-clear={f.label === '卡關' && /^無/.test(f.text) ? 'true' : undefined}>
              <span className="rb-flow-h">{f.label}</span>
              <span className="rb-flow-t">{md(f.text, '0.95rem')}</span>
            </li>
          ))}
        </ol>
      ) : body && <div className="rb-entry-b">{md(body, '1rem')}</div>}
    </div>
  )
}

function SectionCard({ s, md, level, refDate, onOpenDay }: { s: ReportSection; md: Md; level: VisualLevel; refDate: string; onOpenDay?: (date: string) => void }) {
  const tasks = s.kind === 'tasks' ? parseTaskLines(s.body) : null
  const entries = s.kind === 'people' || s.kind === 'cases' ? splitEntries(s.body) : null
  const score = s.kind === 'score' ? parseScoreSection(s.body) : null
  return (
    <section className="rb-card" data-kind={s.kind} data-testid={`rb-section-${s.kind}`} style={{ ['--rb-tone' as string]: KIND_TONE[s.kind] }}>
      <h3 className="rb-h">{s.icon && <span aria-hidden>{s.icon}</span>}{s.title}</h3>
      {score ? <ScoreRadar total={score.total} parts={score.parts} /> : s.kind === 'question' ? (
        <blockquote className="rb-quote">{md(s.body, '1.15rem')}</blockquote>
      ) : s.kind === 'joke' ? (
        <div className="rb-bubble">{md(s.body, '1rem')}</div>
      ) : tasks ? (
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
          {entries.map((e, i) => <Entry key={i} head={e.head} body={e.body} md={md} />)}
        </div>
      ) : <VizBody s={s} level={level} refDate={refDate} md={md} onOpenDay={onOpenDay} />}
    </section>
  )
}

export function ReportBody({ level, startDate, endDate, bodyMd, reportScore, password, md, onOpenDay }: {
  level: VisualLevel
  startDate: string
  endDate: string
  bodyMd: string
  /** 僅日報：AI 自評（日報 📊 段）；每日評分＝80% 成果＋20% 這個分數 */
  reportScore?: ReportScore | null
  password: string | null
  /** 原本時間軸用的 Markdown 渲染（帶 wikilink 解析與附件預覽），由對話框傳入 */
  md: Md
  /** 點過去的日期 → 打開那天的日報（🕰️ 時間線、里程碑的日柱） */
  onOpenDay?: (date: string) => void
}) {
  const [raw, setRaw] = useState(false)
  const ideas = useAsync(password, apiFetchIdeas)
  const food = useAsync(password, apiFetchFood)
  const trips = useAsync(password, apiFetchTrips)
  const tasksDone = useAsync(password, apiFetchTasksDone)
  const life = useAsync(password, apiFetchDailyLife)
  const parsed = useMemo(() => parseReportSections(bodyMd), [bodyMd])
  const settled = (a: { data: unknown; error: boolean }) => a.data !== null || a.error
  const ready = !!password && settled(ideas) && settled(food) && settled(trips)
  const missing = [ideas.error && ideas.data === null ? '想法庫' : '', food.error && food.data === null ? '美食地點' : '', trips.error && trips.data === null ? '遊記' : ''].filter(Boolean)
  const report = useMemo(
    () => (ready ? buildPeriodReport(inputFromData(ideas.data, food.data?.places ?? null, trips.data?.trips ?? null), [startDate, endDate], taipeiTodayIso()) : null),
    [ready, ideas.data, food.data, trips.data, startDate, endDate],
  )
  // 里程碑等想法庫、完成任務與生活項目；完成任務讀不到（或還沒部署）時照樣畫，任務格標「—」；生活項目讀不到時另外註明
  const msReady = !!password && settled(ideas) && settled(tasksDone) && settled(life)
  const tasksMissing = tasksDone.data === null
  const milestones = useMemo(
    () => (msReady ? buildMilestones(ideas.data?.ideas ?? [], tasksDone.data, level, [startDate, endDate], taipeiTodayIso(), life.data) : null),
    [msReady, ideas.data, tasksDone.data, life.data, level, startDate, endDate],
  )
  // 日報的每日評分：80% 這天成果（里程碑本期＝這一天）＋20% AI 自評；完成任務讀不到時只算 AI 自評
  const score = useMemo(
    () => (level === 'day' && msReady ? dailyScore(reportScore?.total, milestones && !tasksMissing ? milestones.current : null) : null),
    [level, msReady, reportScore, milestones, tasksMissing],
  )
  const structured = parsed.sections.length > 0
  // 📊 段畫成雷達（含每項依據）時，上方的分數條就重複了
  const radar = structured && parsed.sections.some((s) => s.kind === 'score' && parseScoreSection(s.body))

  return (
    <div data-testid="report-body" data-level={level}>
      <div className="rb-toggle" role="group" aria-label="報告版面">
        <button type="button" className="dp-range" aria-pressed={!raw} data-testid="rb-mode-visual" onClick={() => setRaw(false)}>圖表版</button>
        <button type="button" className="dp-range" aria-pressed={raw} data-testid="rb-mode-raw" onClick={() => setRaw(true)}>原文</button>
      </div>
      {raw ? md(bodyMd, '1.1rem') : (
        <>
          {password && (milestones ? <div className="rp-band"><MilestoneCard m={milestones} tasksMissing={tasksMissing} lifeMissing={life.data === null} onOpenDay={onOpenDay} /></div>
            : !msReady && <Skeleton lines={3} />)}
          {score && <div className="rp-band"><DailyScoreCard s={score} /></div>}
          {level === 'day' && reportScore && !radar && <div className="rp-band"><ScoreBars score={reportScore} /></div>}
          {password && (ready ? (report && <ReportCharts r={report} level={level} missing={missing} />) : <Skeleton lines={4} />)}
          {structured ? (
            <div className="rb-sections" data-testid="rb-sections">
              {parsed.intro && <div className="rb-intro">{md(parsed.intro, '1.02rem')}</div>}
              {parsed.sections.map((s, i) => <SectionCard key={i} s={s} md={md} level={level} refDate={endDate} onOpenDay={onOpenDay} />)}
            </div>
          ) : md(bodyMd, '1.1rem')}
        </>
      )}
    </div>
  )
}
