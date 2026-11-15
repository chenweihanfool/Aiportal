// 首頁想法板（3.1.0）：心得樹下方的一塊。有聚焦就看聚焦（最多 3 張），沒有就列候選前三名請你挑一個聚焦。
// 數字與判斷都在 ideasView.ts（純函式，有測試）；入口網不寫入，「聚焦」按鈕只把一句話帶到 HERMES。
import { useMemo, useState } from 'react'
import type { IdeasData, IdeaItem } from './boardApi'
import { StateFrame } from './StateFrame'
import type { BlockStatus } from './homeView'
import { sendToHermes } from './DesktopBoard'
import { alpha, inkMix } from './theme'
import {
  ACTION_LABEL, ACTION_MARK, FOCUS_ICON, FOCUS_LIMIT, SCATTER_QUADRANTS, actionMessage, categoryColor, focusDays, ideaDashboard, isFocus, moodPicks, quadrantOf,
} from './ideasView'

function CatChip({ category }: { category: string | null }) {
  const c = categoryColor(category)
  return <span className="ib-cat" style={{ color: inkMix(c), borderColor: c, background: alpha(c, 10) }}>{category ?? '未分類'}</span>
}

export function IdeaBoard({ st, data, top, nowMs, hhi = null, onOpenIdeas, onRequestUnlock, onRetry }: {
  st: BlockStatus
  data: IdeasData | null
  /** 候選前三名（API 的 top 順序） */
  top: IdeaItem[]
  nowMs: number
  /** 今天的幸福指數（0–100）；沒給就照原本 top 順序 */
  hhi?: number | null
  onOpenIdeas: () => void
  onRequestUnlock: () => void
  onRetry: () => void
}) {
  const ideas = data?.ideas ?? []
  const focus = useMemo(() => ideas.filter((i) => isFocus(i.status)).sort((a, b) => (b.score ?? 0) - (a.score ?? 0) || a.id.localeCompare(b.id)), [ideas])
  const dash = useMemo(() => ideaDashboard(ideas, nowMs), [ideas, nowMs])
  const [sent, setSent] = useState<{ text: string; ok: boolean; chat: boolean } | null>(null)
  const shown = focus.slice(0, FOCUS_LIMIT)
  // 久沒動＝最後一次被提到 ≥30 天（與抽屜儀表的 staleFocus 同一份名單，PM 修正）
  const stale = useMemo(() => new Set(dash.staleFocus.map((s) => s.id)), [dash])
  const mood = moodPicks(ideas, top, hhi ?? null)
  const picks = mood.picks
  const monthDone = dash.monthly[dash.monthly.length - 1]?.done ?? 0
  return (
    <section className="ib-root" data-testid="idea-board" aria-label="想法板">
      <div className="ib-head">
        <h2 className="ib-title"><span aria-hidden>💡</span> 想法板</h2>
      </div>
      <StateFrame status={st} source="想法庫" onRequestUnlock={onRequestUnlock} onRetry={onRetry} empty="還沒有想法。HERMES 在日記寫下 💡 標題後，會出現在這裡。">
        {shown.length > 0 ? (
          <ul className="ib-list" data-testid="idea-board-focus">
            {shown.map((it) => {
              const days = focusDays(it, nowMs)
              return (
                <li key={it.id} className="ib-card">
                  <span className="ib-card-t">{FOCUS_ICON} {it.title}</span>
                  <span className="ib-card-m">
                    <CatChip category={it.category} />
                    {days !== null && <span>聚焦 {days} 天</span>}
                    {stale.has(it.id) && <span className="ib-stale">久沒動</span>}
                  </span>
                </li>
              )
            })}
          </ul>
        ) : (
          <>
            <p className="ib-hint" data-testid="idea-board-pick">還沒有聚焦的想法，挑一個聚焦吧。</p>
            {mood.hint !== null && <p className="ib-hint" data-testid="idea-board-mood">{mood.hint}</p>}
            <ul className="ib-list" data-testid="idea-board-candidates">
              {picks.map((it) => (
                <li key={it.id} className="ib-card">
                  <span className="ib-card-t">{it.title}</span>
                  <span className="ib-card-m">
                    <CatChip category={it.category} />
                    {mood.mode !== 'normal' && it.value !== null && it.effort !== null && (
                      <span className="ib-quad" data-testid="idea-board-quad">{SCATTER_QUADRANTS[quadrantOf(it.value, it.effort)].slice(0, 2)}</span>
                    )}
                    <button type="button" className="ib-act" onClick={() => { void sendToHermes(actionMessage(it, 'focus')).then(setSent) }}>{ACTION_MARK.focus} {ACTION_LABEL.focus}</button>
                  </span>
                </li>
              ))}
              {picks.length === 0 && <li className="ib-hint">目前沒有候選的想法。</li>}
            </ul>
          </>
        )}
        {focus.length > FOCUS_LIMIT && <p className="ib-hint">還有 {focus.length - FOCUS_LIMIT} 張聚焦</p>}
        {sent && (
          <div role="status" className="ib-sent" data-ok={sent.ok ? 'true' : 'false'}>
            {sent.chat ? '已帶到對話框，按送出即可：' : sent.ok ? '已複製，貼給 HERMES 即可：' : '瀏覽器不允許自動複製，請手動選取下面這段：'}
            <pre>{sent.text}</pre>
          </div>
        )}
        <div className="ib-foot">
          <span>本月完成 <b>{monthDone}</b></span>
          {dash.next && (
            <span className="ib-next" title={`完成 ${dash.next.target} 個想法`}>
              下一個：完成 {dash.next.target} 個，還差 {dash.next.remaining}
              <i aria-hidden><u style={{ width: `${Math.round(dash.next.ratio * 100)}%` }} /></i>
            </span>
          )}
          <button type="button" className="hm-link ib-open" onClick={onOpenIdeas}>打開想法庫 →</button>
        </div>
      </StateFrame>
    </section>
  )
}
