// 首頁想法板（3.1.0；3.20.0 起是中欄主角）：有聚焦就看聚焦（最多 3 張，卡上可直接操作），不足 3 張補空位卡列候選；沒有聚焦就列候選前三名。
// 數字與判斷都在 ideasView.ts（純函式，有測試）；入口網不寫入，動作按鈕只把一句話帶到 HERMES。
import { useMemo, useState } from 'react'
import type { IdeasData, IdeaItem } from './boardApi'
import { StateFrame } from './StateFrame'
import type { BlockStatus } from './homeView'
import { sendToHermes } from './DesktopBoard'
import { prefillHermesChat } from './chatView'
import { alpha, inkMix } from './theme'
import {
  ACTION_LABEL, ACTION_MARK, FOCUS_ICON, FOCUS_LIMIT, SCATTER_QUADRANTS, actionMessage, boardCounts, categoryColor, daysAgoText, focusDays, ideaDashboard, isFocus, moodPicks, nextActions, quadrantOf,
} from './ideasView'

function CatChip({ category }: { category: string | null }) {
  const c = categoryColor(category)
  return <span className="ib-cat" style={{ color: inkMix(c), borderColor: c, background: alpha(c, 10) }}>{category ?? '未分類'}</span>
}

export function IdeaBoard({ st, data, top, nowMs, hhi = null, onOpenIdeas, onOpenIdea, onRequestUnlock, onRetry }: {
  st: BlockStatus
  data: IdeasData | null
  /** 候選前三名（API 的 top 順序） */
  top: IdeaItem[]
  nowMs: number
  /** 今天的幸福指數（0–100）；沒給就照原本 top 順序 */
  hhi?: number | null
  onOpenIdeas: () => void
  /** 點標題直接在想法庫開啟並定位那一張；沒給就只顯示文字 */
  onOpenIdea?: (id: string) => void
  onRequestUnlock: () => void
  onRetry: () => void
}) {
  const ideas = data?.ideas ?? []
  const focus = useMemo(() => ideas.filter((i) => isFocus(i.status)).sort((a, b) => (b.score ?? 0) - (a.score ?? 0) || a.id.localeCompare(b.id)), [ideas])
  const dash = useMemo(() => ideaDashboard(ideas, nowMs), [ideas, nowMs])
  const counts = useMemo(() => boardCounts(ideas, nowMs), [ideas, nowMs])
  const [sent, setSent] = useState<{ text: string; ok: boolean; chat: boolean } | null>(null)
  const shown = focus.slice(0, FOCUS_LIMIT)
  // 久沒動＝最後一次被提到 ≥30 天（與抽屜儀表的 staleFocus 同一份名單，PM 修正）
  const stale = useMemo(() => new Set(dash.staleFocus.map((s) => s.id)), [dash])
  const slots = Math.max(0, FOCUS_LIMIT - shown.length)
  const mood = moodPicks(ideas, top, hhi ?? null, shown.length === 0 ? 3 : Math.max(1, slots))
  const picks = mood.picks
  const bars = dash.monthly.slice(-6)
  const barMax = Math.max(1, ...bars.map((m) => m.done))
  const send = (text: string) => { void sendToHermes(text).then(setSent) }
  const discuss = (it: IdeaItem) => {
    const text = `想跟你討論想法 ${it.id}「${it.title}」：下一步該做什麼？`
    if (prefillHermesChat(text)) setSent({ text, ok: true, chat: true })
    else send(text)
  }
  const titleBtn = (it: IdeaItem, icon = '') => (onOpenIdea
    ? <button type="button" className="ib-card-t ib-card-open" data-testid="idea-board-open" aria-label={`在想法庫開啟：${it.title}`} onClick={() => onOpenIdea(it.id)}>{icon}{it.title}</button>
    : <span className="ib-card-t">{icon}{it.title}</span>)
  const pickMeta = (it: IdeaItem) => (
    <span className="ib-card-m">
      <CatChip category={it.category} />
      {mood.mode !== 'normal' && it.value !== null && it.effort !== null && (
        <span className="ib-quad" data-testid="idea-board-quad">{SCATTER_QUADRANTS[quadrantOf(it.value, it.effort)].slice(0, 2)}</span>
      )}
      <button type="button" className="ib-act" onClick={() => send(actionMessage(it, 'focus'))}>{ACTION_MARK.focus} {ACTION_LABEL.focus}</button>
    </span>
  )
  return (
    <section className="ib-root" data-testid="idea-board" aria-label="想法板">
      <div className="ib-head">
        <h2 className="ib-title"><span aria-hidden>💡</span> 想法板</h2>
        <span className="ib-counts" data-testid="ib-counts">
          <span className="ib-pill">🌱 候選 {counts.candidate}</span>
          <span className="ib-pill">🎯 聚焦 {counts.focus}/{FOCUS_LIMIT}</span>
          <span className="ib-pill">✅ 本月 {counts.monthDone}</span>
        </span>
      </div>
      <StateFrame status={st} source="想法庫" onRequestUnlock={onRequestUnlock} onRetry={onRetry} empty="還沒有想法。HERMES 在日記寫下 💡 標題後，會出現在這裡。">
        {shown.length > 0 ? (
          <ul className="ib-list ib-list--focus" data-testid="idea-board-focus">
            {shown.map((it) => {
              const days = focusDays(it, nowMs)
              const isStale = stale.has(it.id)
              const ago = daysAgoText(it.lastMentioned, nowMs)
              return (
                <li key={it.id} className="ib-card ib-card--focus">
                  {titleBtn(it, `${FOCUS_ICON} `)}
                  <span className="ib-card-m">
                    <CatChip category={it.category} />
                    {isStale && <span className="ib-stale">久沒動</span>}
                  </span>
                  {days !== null && (
                    <span className="ib-days" data-stale={isStale ? 'true' : 'false'}>
                      <span>聚焦 {days} 天</span>
                      <i aria-hidden><u data-testid="ib-days-bar" style={{ width: `${Math.round(Math.min(days / 30, 1) * 100)}%` }} /></i>
                    </span>
                  )}
                  {ago !== null && <span className="ib-ago">最後提到 {ago}</span>}
                  <span className="ib-actions" data-testid="ib-actions">
                    {nextActions(it.status).map((a) => (
                      <button key={a} type="button" className="ib-act" onClick={() => send(actionMessage(it, a))}>{ACTION_MARK[a]} {ACTION_LABEL[a]}</button>
                    ))}
                    <button type="button" className="ib-act" onClick={() => discuss(it)}>💬 討論</button>
                  </span>
                </li>
              )
            })}
            {slots > 0 && (
              <li className="ib-card ib-slot" data-testid="ib-slot">
                <span className="ib-card-t">空位 ×{slots}</span>
                {mood.hint !== null && <p className="ib-hint" data-testid="idea-board-mood">{mood.hint}</p>}
                <ul className="ib-picks">
                  {picks.map((it) => <li key={it.id} className="ib-pick">{titleBtn(it)}{pickMeta(it)}</li>)}
                  {picks.length === 0 && <li className="ib-hint">目前沒有候選的想法</li>}
                </ul>
              </li>
            )}
          </ul>
        ) : (
          <>
            <p className="ib-hint" data-testid="idea-board-pick">還沒有聚焦的想法，挑一個聚焦吧。</p>
            {mood.hint !== null && <p className="ib-hint" data-testid="idea-board-mood">{mood.hint}</p>}
            <ul className="ib-list" data-testid="idea-board-candidates">
              {picks.map((it) => <li key={it.id} className="ib-card">{titleBtn(it)}{pickMeta(it)}</li>)}
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
          <span className="ib-monthly" data-testid="ib-monthly" role="img" aria-label="近 6 個月完成數">
            {bars.map((m, i) => {
              const last = i === bars.length - 1
              return (
                <span key={m.month} className="ib-bar" data-last={last ? 'true' : 'false'} title={`${m.month}：完成 ${m.done}`}>
                  <b className="ib-bar-n">{last ? m.done : ''}</b>
                  <u style={{ height: `${Math.max(m.done > 0 ? 12 : 4, Math.round((m.done / barMax) * 100))}%` }} />
                </span>
              )
            })}
          </span>
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
