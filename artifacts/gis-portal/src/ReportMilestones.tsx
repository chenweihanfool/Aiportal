import { PARTS, UNIT_WORD, type Bucket, type Milestones } from './milestones'

// 🏁 里程碑卡（日／週／月／季／年報共用，取代原本日報的「近 14 天 AI 分數走勢」）。圖全是 CSS，不引入圖表套件。
// 上：本期三項成果＋合計（與近幾期平均比）；中：徽章（連續天數、新高、年度關卡）；下：近 N 期堆疊柱（虛線＝平均）、年度累計關卡進度。
// 數字由 milestones.ts 現算；設計見 docs/milestones.md。

const PERIOD: Record<Milestones['level'], string> = { day: '這天', week: '這週', month: '這個月', quarter: '這一季', year: '這一年' }

function Trend({ m, onOpenDay }: { m: Milestones; onOpenDay?: (date: string) => void }) {
  const max = Math.max(1, ...m.trend.map((b) => b.total))
  const tip = (b: Bucket) =>
    `${b.range[0] === b.range[1] ? b.range[0] : `${b.range[0]}～${b.range[1]}`}　成果 ${b.total}\n` +
    PARTS.map((p) => `${p.icon} ${p.label} ${b.noTasks && p.key === 'tasks' ? '—（還沒有資料）' : b[p.key]}`).join('\n') +
    (b.partial ? '\n（還沒結束）' : '')
  return (
    <div className="ms-chart" role="list" aria-label={`近 ${m.trend.length} ${UNIT_WORD[m.level]}的成果`} data-testid="ms-trend"
      style={{ gridTemplateColumns: `repeat(${m.trend.length}, minmax(0, 1fr))` }}>
      {m.avg !== null && (
        <span className="ms-avg" aria-hidden style={{ bottom: `calc(var(--ms-lab) + var(--ms-track) * ${Math.min(1, m.avg / max)})` }}>
          <em>平均 {m.avg}</em>
        </span>
      )}
      {m.trend.map((b) => {
        const click = m.level === 'day' && !b.current && onOpenDay
        const body = (
          <>
            <span className="ms-col-v">{b.total > 0 ? b.total : ''}</span>
            <span className="ms-col-track">
              {PARTS.map((p) => b[p.key] > 0 && <i key={p.key} data-k={p.key} style={{ height: `${(b[p.key] / max) * 100}%` }} />)}
            </span>
            <span className="ms-col-d">{b.label}</span>
          </>
        )
        const common = {
          className: 'ms-col', role: 'listitem', title: tip(b), 'aria-label': tip(b).replace(/\n/g, '；'),
          'data-current': b.current ? 'true' : undefined, 'data-partial': b.partial ? 'true' : undefined,
        } as const
        return click
          ? <button key={b.range[0]} type="button" {...common} onClick={() => onOpenDay(b.range[0])}>{body}</button>
          : <div key={b.range[0]} {...common} tabIndex={0}>{body}</div>
      })}
    </div>
  )
}

export function MilestoneCard({ m, tasksMissing, onOpenDay }: { m: Milestones; tasksMissing: boolean; onOpenDay?: (date: string) => void }) {
  const c = m.current
  const diff = m.avg === null ? null : Math.round((c.total - m.avg) * 10) / 10
  const prevN = m.trend.length - 1
  const tasksUnknown = tasksMissing || c.noTasks
  return (
    <section className="hm-card ms-card" aria-label="里程碑" data-testid="ms-card" data-level={m.level}>
      <h2 className="hm-h">🏁 里程碑<span className="hm-h-right rp-hint">成果＝完成任務＋新想法＋想法實行</span></h2>

      <div className="ms-now" aria-label={`${PERIOD[m.level]}的成果`}>
        <div className="ms-total" data-testid="ms-total">
          <span className="ms-total-t">{PERIOD[m.level]}成果</span>
          <b>{c.total}</b>
          {diff !== null && (
            <span className="ms-total-d" data-tone={diff > 0 ? 'up' : diff < 0 ? 'down' : 'flat'}>
              {diff === 0 ? `與近 ${prevN} ${UNIT_WORD[m.level]}平均持平` : `比近 ${prevN} ${UNIT_WORD[m.level]}平均${diff > 0 ? '多' : '少'} ${Math.abs(diff)}`}
              {c.partial && '（還沒結束）'}
            </span>
          )}
        </div>
        {PARTS.map((p) => (
          <div key={p.key} className="ms-part" data-k={p.key} data-testid={`ms-part-${p.key}`}>
            <span className="ms-part-t"><span aria-hidden>{p.icon}</span>{p.label}</span>
            <b>{p.key === 'tasks' && tasksUnknown ? '—' : c[p.key]}<small>{p.unit}</small></b>
          </div>
        ))}
      </div>

      {m.badges.length > 0 && (
        <ul className="ms-badges" aria-label="達成" data-testid="ms-badges">
          {m.badges.map((b) => <li key={b.text} data-kind={b.kind}><span aria-hidden>{b.icon}</span>{b.text}</li>)}
        </ul>
      )}

      <h3 className="rp-sub">近 {m.trend.length} {UNIT_WORD[m.level]}{m.level === 'day' ? '（點柱子看那天）' : ''}</h3>
      <Trend m={m} onOpenDay={onOpenDay} />
      <p className="rp-legend ms-legend">
        {PARTS.map((p) => <span key={p.key}><i data-k={p.key} />{p.label}</span>)}
        {m.avg !== null && <span><i className="ms-legend-avg" />平均（不含本期與空白期）</span>}
      </p>

      <h3 className="rp-sub">{m.road.year} 年累計・下一關</h3>
      <ul className="ms-road" data-testid="ms-road">
        {m.road.rows.map((r) => {
          const p = PARTS.find((x) => x.key === r.key)!
          const unknown = r.key === 'tasks' && tasksMissing
          return (
            <li key={r.key} data-k={r.key}>
              <span className="ms-road-l"><span aria-hidden>{p.icon}</span>{p.label}</span>
              <span className="ms-road-track" aria-hidden><i style={{ width: `${unknown ? 0 : r.pct}%` }} /></span>
              <span className="ms-road-v">
                {unknown ? '—' : <><b>{r.ytd}</b>{r.next !== null ? <small> / {r.next}</small> : <small> 全破</small>}</>}
              </span>
            </li>
          )
        })}
      </ul>

      {tasksMissing ? <p className="hm-note" data-testid="ms-tasks-missing">完成任務暫時讀不到（以 — 表示，成果只算想法）。</p>
        : m.tasksSince && m.trend[0].range[0] < m.tasksSince && <p className="hm-note">完成任務的資料從 {m.tasksSince} 起才有，之前的期只算想法。</p>}
    </section>
  )
}
