import { useState } from 'react'
import { kindLabel, type Topic } from './knowledgeView'
import { knowledgeWeekDetail, userCorrectionDetail, type WeekClaimGroup, type WeekTopicRow } from './knowledgeWeek'

// STATUS 右欄兩個抽屜的內容（3.20.0）：「知識庫這週」明細、你的更正明細。
// 純計算在 knowledgeWeek.ts；樣式 kw- 前綴在 portal.css 檔尾。

function WeekRow({ row, onOpenTopic }: { row: WeekTopicRow; onOpenTopic: (id: string) => void }) {
  return (
    <li className="kw-row">
      <span className="kw-date">{row.date.slice(5)}</span>
      <span className="kw-kind">{kindLabel(row.kind)}</span>
      <button type="button" className="kw-topic" data-testid="kw-topic" onClick={() => onOpenTopic(row.id)}>{row.name}</button>
      <span className="kw-detail">{row.detail}</span>
    </li>
  )
}

/** 一組句子：預設前 3 句，多的收在「再看 X 句」後面 */
function ClaimGroup({ group, onOpenTopic }: { group: WeekClaimGroup; onOpenTopic: (id: string) => void }) {
  const [open, setOpen] = useState(false)
  const shown = open ? group.claims : group.claims.slice(0, 3)
  const hidden = group.claims.length - 3
  return (
    <div className="kw-group">
      <div className="kw-group-h">
        <button type="button" className="kw-topic" data-testid="kw-topic" onClick={() => onOpenTopic(group.id)}>{group.name}</button>
        <span className="kw-count">{group.claims.length} 句</span>
      </div>
      <ul className="kw-sents">
        {shown.map((c) => <li key={c.id}>{c.text}</li>)}
      </ul>
      {!open && hidden > 0 && (
        <button type="button" className="kw-more" data-testid="kw-more" onClick={() => setOpen(true)}>再看 {hidden} 句</button>
      )}
    </div>
  )
}

export function KnowledgeWeekPanel({ topics, now, onOpenTopic }: {
  topics: readonly Topic[]
  now: Date
  onOpenTopic: (id: string) => void
}) {
  const d = knowledgeWeekDetail(topics, now)
  return (
    <div className="kw-panel" data-testid="kw-panel">
      <section className="kw-sec" data-testid="kw-pages" aria-label="新頁">
        <h3 className="kw-h">🆕 新頁（{d.pages.length}）</h3>
        {d.pages.length === 0
          ? <p className="kw-empty">這週沒有</p>
          : <ul className="kw-list">{d.pages.map((row) => <WeekRow key={`${row.id}-${row.date}`} row={row} onOpenTopic={onOpenTopic} />)}</ul>}
      </section>

      <section className="kw-sec" data-testid="kw-claims" aria-label="新長出的句子">
        <h3 className="kw-h">✍️ 新長出的句子（{d.totals.claims}）</h3>
        {d.claimGroups.length === 0
          ? <p className="kw-empty">這週沒有</p>
          : d.claimGroups.map((g) => <ClaimGroup key={g.id} group={g} onOpenTopic={onOpenTopic} />)}
      </section>

      <section className="kw-sec" data-testid="kw-revised" aria-label="改版">
        <h3 className="kw-h">🔁 改版（{d.revised.length}）</h3>
        {d.revised.length === 0
          ? <p className="kw-empty">這週沒有</p>
          : <ul className="kw-list">{d.revised.map((row) => <WeekRow key={`${row.id}-${row.date}`} row={row} onOpenTopic={onOpenTopic} />)}</ul>}
      </section>
    </div>
  )
}

export function CorrectionsPanel({ topics, onOpenTopic }: {
  topics: readonly Topic[]
  onOpenTopic: (id: string) => void
}) {
  const d = userCorrectionDetail(topics)
  if (d.total === 0) {
    return (
      <div className="kw-panel" data-testid="kw-fixes">
        <p className="kw-empty">還沒有更正。在知識頁的句子旁按 ✎ 就能更正。</p>
      </div>
    )
  }
  return (
    <div className="kw-panel" data-testid="kw-fixes">
      {d.missingText && <p className="kw-note">更正已計入，但這版資料沒有附上句子</p>}
      {d.groups.map((g) => (
        <div className="kw-group" key={g.id}>
          <div className="kw-group-h">
            <button type="button" className="kw-topic" data-testid="kw-topic" onClick={() => onOpenTopic(g.id)}>{g.name}</button>
            <span className="kw-count">{g.claims.length} 筆</span>
          </div>
          <ul className="kw-sents">
            {g.claims.map((c) => (
              <li key={c.id}>
                {c.text}
                <span className="kw-when">{c.lastChanged}</span>
                {c.disputed && <span className="kw-badge">有爭議</span>}
              </li>
            ))}
          </ul>
        </div>
      ))}
    </div>
  )
}
