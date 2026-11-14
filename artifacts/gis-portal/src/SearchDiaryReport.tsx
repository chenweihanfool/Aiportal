import { useEffect, useState, type ReactNode } from 'react'
import { MarkdownView } from './MarkdownView'
import { ReportBody } from './ReportBody'
import { DIARY_EVENTS_MAX, isDiaryDate } from './omniSearch'
import { apiFetchTimelineDetail, type TimelineDetail } from './timelineApi'

// 搜尋閱讀面板裡「日記」的日報圖表版（跟時間軸日報對話框同一套 ReportBody）。

type State = { date: string; status: 'loading' | 'ok' | 'error'; data: TimelineDetail | null }

export function SearchDiaryReport({ date, pw }: { date: string; pw: string | null }) {
  const valid = isDiaryDate(date)
  const [st, setSt] = useState<State | null>(null)
  useEffect(() => {
    if (!pw || !valid) return
    let alive = true
    setSt({ date, status: 'loading', data: null })
    apiFetchTimelineDetail(pw, 'day', date)
      .then((d) => { if (alive) setSt({ date, status: 'ok', data: d }) })
      .catch(() => { if (alive) setSt({ date, status: 'error', data: null }) })
    return () => { alive = false }
  }, [date, pw, valid])

  const link = <a className="om-gh om-rp-link" href="#graph/timeline">在時間軸看 →</a>
  let body: ReactNode
  if (!valid) body = <p className="om-one om-dim">這一筆沒有對應的日報。</p>
  else if (!pw) body = <p className="om-one om-dim">解鎖後可看那天的日報圖表</p>
  else if (!st || st.date !== date || st.status === 'loading') body = <p className="om-one om-dim">載入那天的日報…</p>
  else if (st.status === 'error' || !st.data) body = <p className="om-one om-dim" role="status">那天的日報暫時讀不到</p>
  else {
    const d = st.data
    if (d.hasReport) {
      body = (
        <ReportBody level={d.level} startDate={d.startDate} endDate={d.endDate} bodyMd={d.bodyMd} reportScore={d.reportScore} password={pw}
          md={(text, size) => <MarkdownView text={text} fontSize={size ?? '1.1rem'} />} />
      )
    } else if (d.events.length > 0) {
      body = (
        <>
          <p className="om-one om-dim">這一天沒有日報，當日事件如下：</p>
          <ul>
            {d.events.slice(0, DIARY_EVENTS_MAX).map((ev) => (
              <li key={ev.id}><a className="om-rp-ev" href={`#dossier/event/${encodeURIComponent(ev.id)}`}>{ev.title}</a></li>
            ))}
          </ul>
        </>
      )
    } else body = <p className="om-one om-dim">這一天沒有日報。</p>
  }
  return (
    <div id="om-report" className="om-rp">
      {link}
      <div className="om-rp-body">{body}</div>
    </div>
  )
}
