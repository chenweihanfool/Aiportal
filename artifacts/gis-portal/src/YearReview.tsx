import { useEffect, useMemo } from 'react'
import { apiFetchFood } from './foodApi'
import { apiFetchTrips } from './tripsApi'
import { fetchHhiHistoryStrict } from './homeApi'
import { useAsync, useNow } from './homeHooks'
import { taipeiDate } from './homeView'
import { dimensionsYear, hhiYear, placesYear, tripsYear } from './yearReview'
import { Skeleton } from './StateFrame'
import { COLOR, FONT } from './theme'

// 年度回顧頁（#year／#year/<年>，P2-1）：這一年的幸福指數、六個面向、旅行、去過的地點。
// 全部由既有接口算出來（/api/happiness/history、遊記、美食地圖），沒有新後端。
// 幸福指數歷史接口最多回近 365 天，所以只有最近一年看得到完整資料；更早的年份只會有落在這個範圍內的日子，沒有的就顯示「沒有紀錄」，不補 0。

const fetchHistory365 = (pw: string) => fetchHhiHistoryStrict(pw, 365)
const MIN_YEAR = 2020

export function YearReview({ year, unlocked, unlockedPassword, toneOf, onRequestUnlock }: {
  year: number
  unlocked: boolean
  unlockedPassword: string | null
  toneOf: (s: number) => { color: string; label: string }
  onRequestUnlock: () => void
}) {
  const pw = unlocked && unlockedPassword ? unlockedPassword : null
  const now = useNow()
  const thisYear = Number(taipeiDate(now).slice(0, 4))
  const history = useAsync(pw, fetchHistory365)
  const trips = useAsync(pw, apiFetchTrips)
  const food = useAsync(pw, apiFetchFood)

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape' && !e.defaultPrevented) window.location.hash = '' }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const hhi = useMemo(() => hhiYear(history.data, year), [history.data, year])
  const dims = useMemo(() => dimensionsYear(history.data, year), [history.data, year])
  const tr = useMemo(() => tripsYear(trips.data?.trips, year), [trips.data, year])
  const pl = useMemo(() => placesYear(food.data?.places, year), [food.data, year])
  const withDims = dims.filter((d) => d.avg !== null)
  const strongest = withDims[0] ?? null
  const weakest = withDims.length >= 2 ? withDims[withDims.length - 1]! : null
  const go = (y: number) => { window.location.hash = `year/${y}` }

  return (
    <div className="dp-page yr-page" data-testid="year-page" data-year={year}
      style={{ position: 'fixed', inset: 0, background: COLOR.panelDeep, display: 'flex', flexDirection: 'column', zIndex: 200, color: COLOR.ink, fontFamily: FONT.body }}>
      <header className="dp-head">
        <a href="#" data-testid="dp-back" className="dp-back" onClick={(e) => { e.preventDefault(); window.location.hash = '' }}>← 首頁</a>
        <nav className="yr-nav" aria-label="切換年份">
          <button type="button" className="dp-range" disabled={year <= MIN_YEAR} data-testid="yr-prev" onClick={() => go(year - 1)}>← {year - 1}</button>
          <button type="button" className="dp-range" disabled={year >= thisYear} data-testid="yr-next" onClick={() => go(year + 1)}>{year + 1} →</button>
        </nav>
        <span className="dp-title" aria-hidden>年度回顧</span>
      </header>
      <div className="dp-body">
        <div className="dp-wrap yr-wrap">
          <h1 className="yr-title">{year} 年回顧</h1>
          {!pw ? (
            <section className="hm-card"><button type="button" className="hm-lock" onClick={onRequestUnlock}>🔒 解鎖後顯示</button></section>
          ) : (
            <>
              <section className="hm-card yr-hhi" aria-label="幸福指數">
                <h2 className="hm-h">幸福指數</h2>
                {history.loading && !history.data ? <Skeleton lines={3} /> : history.error ? (
                  <p className="hm-note">幸福指數歷史暫時讀不到。<button type="button" className="hm-retry" onClick={history.reload}>重試</button></p>
                ) : hhi.count === 0 ? (
                  <p className="hm-note" data-testid="yr-hhi-empty">{year} 年沒有幸福指數紀錄（歷史接口最多回近 365 天）。</p>
                ) : (
                  <>
                    <dl className="dp-stats" data-testid="yr-hhi-stats">
                      <div><dt>年平均</dt><dd style={{ color: toneOf(hhi.avg ?? 0).color }}>{hhi.avg}</dd></div>
                      <div><dt>最好的一天</dt><dd>{hhi.best!.value}<small>{hhi.best!.date.slice(5)}</small></dd></div>
                      <div><dt>最低的一天</dt><dd>{hhi.worst!.value}<small>{hhi.worst!.date.slice(5)}</small></dd></div>
                      <div><dt>有紀錄</dt><dd>{hhi.count}<small>天</small></dd></div>
                    </dl>
                    <div className="yr-months" role="img" aria-label="各月平均幸福指數">
                      {hhi.months.map((m) => (
                        <div key={m.month} className="yr-month" title={m.avg === null ? `${m.month}月沒有紀錄` : `${m.month}月平均 ${m.avg}（${m.days} 天）`}>
                          <span className="yr-bar-wrap"><i className="yr-bar" style={{ height: m.avg === null ? 0 : `${Math.max(4, m.avg)}%`, background: m.avg === null ? undefined : toneOf(m.avg).color }} /></span>
                          <span className="yr-m">{m.month}</span>
                        </div>
                      ))}
                    </div>
                  </>
                )}
              </section>

              <section className="hm-card yr-dims" aria-label="六個面向" data-testid="yr-dims">
                <h2 className="hm-h">六個面向的年平均</h2>
                {history.loading && !history.data ? <Skeleton lines={3} /> : withDims.length === 0 ? (
                  <p className="hm-note">各面向的每日分數還沒有紀錄（後端的歷史接口有 components 才算得出來）。</p>
                ) : (
                  <ul className="yr-dim-list">
                    {dims.map((d) => (
                      <li key={d.key} className="yr-dim" style={{ ['--dim' as string]: d.color }}>
                        <a href={`#dim/${d.key}`} className="yr-dim-name"><span aria-hidden>{d.icon}</span>{d.label}</a>
                        <span className="yr-dim-bar" aria-hidden><i style={{ width: d.avg === null ? 0 : `${Math.max(2, d.avg)}%` }} /></span>
                        <b className="yr-dim-n">{d.avg === null ? '—' : d.avg}</b>
                        {strongest && d.key === strongest.key && <span className="hm-chip">全年最強</span>}
                        {weakest && d.key === weakest.key && <span className="hm-chip hm-chip--warn">全年最弱</span>}
                      </li>
                    ))}
                  </ul>
                )}
              </section>

              <section className="hm-card yr-trips" aria-label="旅行" data-testid="yr-trips">
                <h2 className="hm-h">旅行<span className="hm-h-right"><a href="#trips" className="hm-link">遊記 →</a></span></h2>
                {trips.loading && !trips.data ? <Skeleton lines={2} /> : trips.error ? (
                  <p className="hm-note">遊記暫時讀不到。<button type="button" className="hm-retry" onClick={trips.reload}>重試</button></p>
                ) : tr.count === 0 ? (
                  <p className="hm-note">{year} 年遊記裡沒有旅行。</p>
                ) : (
                  <>
                    <dl className="dp-stats">
                      <div><dt>趟數</dt><dd>{tr.count}</dd></div>
                      <div><dt>旅行天數</dt><dd>{tr.days}</dd></div>
                      <div><dt>最長一趟</dt><dd>{tr.longest!.days}<small>天</small></dd></div>
                      <div><dt>地區</dt><dd className="yr-areas">{tr.areas.length ? tr.areas.join('、') : '—'}</dd></div>
                    </dl>
                    <p className="dp-note">最長的一趟：{tr.longest!.name}。規劃中、還沒出發的不算；跨年的趟次只算落在 {year} 年的天數。</p>
                  </>
                )}
              </section>

              <section className="hm-card yr-places" aria-label="去過的地點" data-testid="yr-places">
                <h2 className="hm-h">去過的地點<span className="hm-h-right"><a href="#food" className="hm-link">美食地圖 →</a></span></h2>
                {food.loading && !food.data ? <Skeleton lines={2} /> : food.error ? (
                  <p className="hm-note">美食地圖暫時讀不到。<button type="button" className="hm-retry" onClick={food.reload}>重試</button></p>
                ) : pl.visited === 0 ? (
                  <p className="hm-note">{year} 年美食地圖裡沒有去過的紀錄。</p>
                ) : (
                  <dl className="dp-stats">
                    <div><dt>去過</dt><dd>{pl.visited}<small>處</small></dd></div>
                    <div><dt>其中美食</dt><dd>{pl.food}<small>間</small></dd></div>
                    <div><dt>愛店</dt><dd>{pl.favorites}<small>間</small></dd></div>
                  </dl>
                )}
              </section>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
