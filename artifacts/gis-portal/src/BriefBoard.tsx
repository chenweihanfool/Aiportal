// 首頁 🌙 明日報告的視覺版：日期卡＋優先卡＋21 天擠壓條＋專案進度。純邏輯在 briefView.ts；報告格式認不出時退回原文。
import type { CSSProperties } from 'react'
import { MarkdownView } from './MarkdownView'
import { dueLabel, weekdayOf, type Brief, type Crowd, type CrowdDay, type ParsedBrief } from './briefView'

const WEEKDAY = ['週日', '週一', '週二', '週三', '週四', '週五', '週六']
const md = (d: string) => `${Number(d.slice(5, 7))}/${Number(d.slice(8, 10))}`
const level = (n: number) => (n === 0 ? 'none' : n >= 5 ? 'peak' : n >= 3 ? 'busy' : 'calm')

function CrowdStrip({ crowd, tip }: { crowd: Crowd; tip: string | null }) {
  const max = Math.max(1, ...crowd.days.map((d) => d.titles.length))
  const dayTip = (d: CrowdDay) => `${md(d.date)} 週${d.weekday}：${d.titles.length} 件${d.titles.length ? `\n${d.titles.slice(0, 8).join('\n')}${d.titles.length > 8 ? `\n另 ${d.titles.length - 8} 件` : ''}` : ''}`
  return (
    <section className="br-block" aria-label="未來 21 天到期分布" data-testid="brief-strip">
      <h3>未來 21 天的擠壓條</h3>
      <div className="br-strip">
        {crowd.days.map((d) => (
          <div key={d.date} className="br-day" data-weekend={d.weekend} data-level={level(d.titles.length)} title={dayTip(d)} tabIndex={0} aria-label={dayTip(d)}>
            {d.titles.length > 0 && <span className="br-n">{d.titles.length}</span>}
            <span className="br-bar" style={{ height: d.titles.length ? `${Math.round((d.titles.length / max) * 72)}%` : undefined }} />
          </div>
        ))}
      </div>
      <div className="br-axis" aria-hidden>
        {crowd.days.map((d, i) => <span key={d.date}>{i % 7 === 0 ? md(d.date) : ''}</span>)}
      </div>
      {tip && <p className="br-tip">{tip}</p>}
    </section>
  )
}

export function BriefBoard({ brief, parsed, crowd }: { brief: Brief; parsed: ParsedBrief | null; crowd: Crowd | null }) {
  if (!parsed) return <div data-testid="brief-body"><MarkdownView text={brief.bodyMd} /></div>
  const w = weekdayOf(brief.date)
  return (
    <div className="br-root" data-testid="brief-body">
      <div className="br-hero">
        <div className="br-date"><b>{md(brief.date)}</b><span>{WEEKDAY[w]}{w === 0 || w === 6 ? '・假日' : ''}</span></div>
        {crowd && (
          <div className="br-stats">
            <div className="br-stat" data-hot={crowd.overdue > 0}><b>{crowd.overdue}</b><span>已逾期</span></div>
            <div className="br-stat"><b>{crowd.days[0]!.titles.length}</b><span>當天到期</span></div>
            <div className="br-stat"><b>{crowd.total}</b><span>未來 21 天</span></div>
            {crowd.busiest && <div className="br-stat" data-hot={crowd.busiest.titles.length >= 5}><b>{md(crowd.busiest.date)}</b><span>最擠・{crowd.busiest.titles.length} 件</span></div>}
          </div>
        )}
      </div>
      <div className="br-tasks">
        {parsed.tasks.map((t, i) => {
          const due = dueLabel(t.due, brief.date)
          return (
            <article key={t.title} className="br-task">
              <span className="br-rank" aria-hidden>{i + 1}</span>
              <h3>{t.title}</h3>
              <div className="br-meta">
                {due && <span className="br-due" data-hot={due.hot}>{due.text}</span>}
                {t.project && <span>{t.project}</span>}
              </div>
              {t.why && <p className="br-why">{t.why}</p>}
              {t.next && <p className="br-next">{t.next}</p>}
            </article>
          )
        })}
      </div>
      {crowd ? <CrowdStrip crowd={crowd} tip={parsed.tip} /> : parsed.tip && <p className="br-tip">{parsed.tip}</p>}
      {parsed.progress.length > 0 && (
        <section className="br-block" aria-label="專案進度">
          <h3>專案進度（低到高）</h3>
          <div className="br-progress">
            {parsed.progress.slice(0, 8).map((p) => (
              <div key={p.name} className="br-prog"><span title={p.name}>{p.name}</span><b>{p.pct}%</b><i style={{ '--pct': `${p.pct}%` } as CSSProperties} /></div>
            ))}
          </div>
        </section>
      )}
      <div className="br-foot">
        {parsed.system && <span title={parsed.system.text}><span className="ch-dot" data-on={parsed.system.ok} />系統{parsed.system.ok ? '正常' : '有異常'}</span>}
        <details className="br-more">
          <summary>完整分析</summary>
          {parsed.analysis.map((p, i) => <p key={i}>{p}</p>)}
          {parsed.system && !parsed.system.ok && <p>{parsed.system.text}</p>}
        </details>
      </div>
    </div>
  )
}
