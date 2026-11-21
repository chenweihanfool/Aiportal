import { useEffect, useMemo, useRef, type CSSProperties } from 'react'
import { apiFetchFood } from './foodApi'
import { useAsync } from './homeHooks'
import { blockState } from './homeView'
import { Skeleton, StateFrame } from './StateFrame'
import { apiFetchTrips, taipeiTodayIso } from './tripsApi'
import {
  COUNTIES, COUNTY_GRID, buildCalendar, buildFootprint, daysSinceLastTrip, footprintLevel, monthLabels, nextTrip,
} from './travelCharts'

// 旅遊面向頁（#dim/travel）的兩張主圖：年度旅行日曆、足跡縣市方格圖（純函式在 travelCharts.ts）。
// 資料來自既有的遊記（apiFetchTrips）與地點（apiFetchFood），不新增接口。

const LEVEL_PCT = [0, 28, 52, 76, 100] as const

const mdLabel = (iso: string): string => `${Number(iso.slice(5, 7))}/${Number(iso.slice(8, 10))}`

export function TravelCharts({ pw, now, color, onRequestUnlock }: {
  pw: string | null
  now: Date
  color: string
  onRequestUnlock: () => void
}) {
  const trips = useAsync(pw, apiFetchTrips)
  const food = useAsync(pw, apiFetchFood)
  const today = taipeiTodayIso(now)
  const tripList = trips.data?.trips
  const placeList = food.data?.places
  const cal = useMemo(() => (tripList && placeList ? buildCalendar(tripList, placeList, today) : null), [tripList, placeList, today])
  const foot = useMemo(() => (tripList && placeList ? buildFootprint(tripList, placeList) : null), [tripList, placeList])
  const since = useMemo(() => (tripList ? daysSinceLastTrip(tripList, today) : null), [tripList, today])
  const next = useMemo(() => (tripList ? nextTrip(tripList, today) : null), [tripList, today])
  const hasData = !!tripList && !!placeList
  const st = blockState({
    unlocked: !!pw, loading: trips.loading || food.loading, error: trips.error || food.error, hasData,
    empty: hasData && tripList.length === 0 && placeList.length === 0, nowMs: now.getTime(), updatedAtMs: null,
  })
  const reload = () => { trips.reload(); food.reload() }

  // 窄螢幕：日曆放不下，一打開就捲到今天附近（只捲卡片內部）
  const scrollRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const el = scrollRef.current
    if (!el || !cal || el.scrollWidth <= el.clientWidth) return
    const idx = cal.weeks.findIndex((w) => w.some((c) => c?.today))
    if (idx < 0) return
    el.scrollLeft = Math.max(0, (idx / cal.weeks.length) * el.scrollWidth - el.clientWidth / 2)
  }, [cal])

  const frameProps = {
    status: st, source: '旅行日記與地點', onRequestUnlock, onRetry: reload, skeleton: <Skeleton lines={4} />,
    empty: '還沒有遊記與地點資料。',
  }
  const dimStyle = { ['--dim' as string]: color } as CSSProperties

  return (
    <>
      <section className="hm-card dp-gantt tc-card" aria-label="今年的旅行日" data-testid="tc-cal" style={dimStyle}>
        <h2 className="hm-h">今年的旅行日
          {cal && <span className="hm-h-right tc-sum" data-testid="tc-cal-sum">今年 {cal.daysThisYear} 天旅行（去年同期 {cal.daysLastYear} 天）</span>}
        </h2>
        <StateFrame {...frameProps} className="tc-frame">
          {cal && (
            <>
              <div className="tc-scroll" ref={scrollRef}>
                <div className="tc-cal" style={{ ['--weeks' as string]: cal.weeks.length } as CSSProperties}>
                  <div className="tc-months" aria-hidden>
                    {monthLabels(cal.weeks).map((m, i) => <span key={i}>{m}</span>)}
                  </div>
                  <div className="tc-grid" role="group" aria-label={`${cal.year} 年每天的旅行紀錄`}>
                    {cal.weeks.map((w, wi) => w.map((c, di) => {
                      if (!c) return <i key={`${wi}-${di}`} className="tc-cell is-blank" aria-hidden />
                      const first = c.trips[0]
                      const plannedFirst = c.planned[0]
                      const names = (first ? c.trips : c.planned).map((t) => t.name).join('、')
                      const tip = `${c.date}${names ? `｜${names}${first ? '' : '（計畫中）'}` : ''}${c.food ? '｜吃過美食' : ''}`
                      const cls = `tc-cell${first ? ' is-trip' : plannedFirst ? ' is-plan' : ''}${c.today ? ' is-today' : ''}`
                      const dot = c.food ? <b className="tc-dot" aria-hidden /> : null
                      return first ? (
                        <button key={c.date} type="button" className={cls} title={tip} aria-label={tip} data-testid="tc-trip-cell"
                          onClick={() => { location.hash = `trips/${first.id}` }}>{dot}</button>
                      ) : (
                        <i key={c.date} className={cls} title={tip}>{dot}</i>
                      )
                    }))}
                  </div>
                </div>
              </div>
              <p className="tc-foot" data-testid="tc-cal-foot">
                {since === null ? <span>還沒有旅行紀錄</span> : <span>{since === 0 ? '今天正在旅行' : <>距上次旅行 <b>{since}</b> 天</>}</span>}
                {next && <span>下一趟倒數 <b>{next.inDays}</b> 天：{next.trip.name}（{mdLabel(next.trip.start)}）</span>}
              </p>
              <p className="dp-note">實心＝旅行日、虛框＝計畫中的趟次、格內小點＝吃過美食、外框＝今天。點旅行日打開那一趟。</p>
            </>
          )}
        </StateFrame>
      </section>

      <section className="hm-card dp-gantt tc-card" aria-label="足跡" data-testid="tc-foot" style={dimStyle}>
        <h2 className="hm-h">足跡</h2>
        <StateFrame {...frameProps} className="tc-frame">
          {foot && (
            <>
              <div className="tc-map" style={{ ['--cols' as string]: COUNTY_GRID.cols, ['--rows' as string]: COUNTY_GRID.rows } as CSSProperties} role="group" aria-label="台灣各縣市去過的地點數">
                {COUNTIES.map((c) => {
                  const n = foot.counts.get(c.name) ?? 0
                  const lv = footprintLevel(n)
                  const tip = `${c.name}・${n} 個地點`
                  return (
                    <span key={c.name} className={`tc-tile lv-${lv}`} title={tip} aria-label={tip} data-testid="tc-tile"
                      style={{ gridColumn: c.col + 1, gridRow: c.row + 1, ['--pct' as string]: `${LEVEL_PCT[lv]}%` } as CSSProperties}>{c.short}</span>
                  )
                })}
              </div>
              <p className="tc-foot" data-testid="tc-foot-sum">
                <span>去過 <b>{foot.visitedCounties}</b>／{COUNTIES.length} 個縣市</span>
                {foot.unknown > 0 && <span>另有 {foot.unknown} 個地點認不出縣市</span>}
              </p>
              <p className="dp-note">次數＝去過的地點數（遊記裡的地點加上標成去過的地點，同一地點只算一次）；顏色越深越多。</p>
            </>
          )}
        </StateFrame>
      </section>
    </>
  )
}
