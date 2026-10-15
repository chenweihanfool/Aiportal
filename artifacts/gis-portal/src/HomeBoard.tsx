import { useMemo, useState, type ReactNode } from 'react'
import { apiFetchHermesGraph } from './hermesGraphApi'
import { apiFetchBoardPipeline, apiFetchBoardStatus, apiFetchIdeas, apiFetchUsage } from './boardApi'
import { apiFetchFood } from './foodApi'
import { apiFetchTrips } from './tripsApi'
import { biggestDrag, buildHhiBreakdown } from './boardView'
import { topIdeas as pickTopIdeas, statusCounts } from './ideasView'
import { Drawer, FEED_LABEL, IdeasPanel, PusherHealthPanel, pusherSummary } from './DesktopBoard'
import { fetchHhiHistoryStrict } from './homeApi'
import { useAsync, useNow } from './homeHooks'
import { DimensionsSection, FunSection, GrowthSection, SystemSection, TodaySection } from './HomeSections'
import {
  EXPECTED_EVERY_MIN, badFeedNames, blockState, buildHeatmap, greeting, hhiTrend, historyUpdatedAtMs, knowledgeStats, latestTrip, milestones,
  oldestWantPlace, placesBeenCount, systemLight, taipeiDate, todaySentence, yearProgress, type BlockStatus,
} from './homeView'

// 新首頁（審計報告 §2.6 五段式）：① 今天 → ② 六個面向 → ③ 成長軌跡 → ④ 好玩的 → ⑤ 系統一顆燈（異常時移到 ① 下方）。
// 獨立元件，props 與 DesktopBoard 類似；目前只掛在 #home 預覽路由，使用者看過截圖同意後才會換成預設首頁。
// 資料全部來自既有 API 與既有型別／函式，沒有任何示範值：拿不到就依 StateFrame 的狀態機顯示（未解鎖／載入中／空／過期／失敗）。

type DrawerKey = 'hhi' | 'ops' | 'ideas'

const fetchHistory365 = (pw: string) => fetchHhiHistoryStrict(pw, 365)

export function HomeBoard({ unlocked, unlockedPassword, hhiData, hhiFetchedAt, hhiError, toneOf, onRequestUnlock, hhiDetail, opsDetail }: {
  unlocked: boolean
  unlockedPassword: string | null
  /** /api/dashboard 的 hhi 摘要資料（App.tsx 的 hhiSummary?.data）；undefined＝還沒載入 */
  hhiData: Record<string, unknown> | undefined
  /** hhi 摘要的抓取時間（ISO），用來判斷新舊 */
  hhiFetchedAt?: string | null
  /** hhi 摘要抓取失敗 */
  hhiError?: boolean
  toneOf: (s: number) => { color: string; label: string }
  onRequestUnlock: () => void
  /** 抽屜「幸福指數詳情」（與 DesktopBoard 同一份） */
  hhiDetail: ReactNode
  /** 抽屜「HERMES 戰情室」（與 DesktopBoard 同一份） */
  opsDetail: ReactNode
}) {
  const pw = unlocked && unlockedPassword ? unlockedPassword : null
  const now = useNow()
  const nowMs = now.getTime()
  const todayIso = taipeiDate(now)
  const [drawer, setDrawer] = useState<DrawerKey | null>(null)

  const history = useAsync(pw, fetchHistory365)
  const graph = useAsync(pw, apiFetchHermesGraph)
  const ideas = useAsync(pw, apiFetchIdeas)
  const food = useAsync(pw, apiFetchFood)
  const trips = useAsync(pw, apiFetchTrips)
  const pipeline = useAsync(pw, apiFetchBoardPipeline)
  const status = useAsync(pw, apiFetchBoardStatus)
  const usage = useAsync(pw, apiFetchUsage)

  const breakdown = useMemo(() => buildHhiBreakdown(hhiData), [hhiData])
  const histData = history.data ?? []
  const trend = useMemo(() => hhiTrend(histData, todayIso, breakdown?.displayed ?? null), [histData, todayIso, breakdown])

  // ── 各區塊的狀態（§2.4）──
  const on = !!pw
  const hhiSt = blockState({
    unlocked: on, loading: !hhiData && !hhiError, error: !!hhiError, hasData: !!breakdown, nowMs,
    updatedAtMs: hhiFetchedAt ? Date.parse(hhiFetchedAt) : null, expectedEveryMin: EXPECTED_EVERY_MIN.hhi,
  })
  const histBase = blockState({
    unlocked: on, loading: history.loading, error: history.error, hasData: history.data !== null, nowMs,
    updatedAtMs: history.data ? historyUpdatedAtMs(history.data) : null, expectedEveryMin: EXPECTED_EVERY_MIN.hhiHistory,
  })
  // 熱圖：有紀錄的天數 < 2 視為「資料累積中」，不畫一張幾乎全空的圖
  const heat = useMemo(() => buildHeatmap(histData, todayIso, 365), [histData, todayIso])
  const heatSt: BlockStatus = histBase.state === 'fresh' || histBase.state === 'empty' ? (heat.withData < 2 ? { ...histBase, state: 'pending' } : { ...histBase, state: 'fresh' }) : histBase
  const kbData = graph.data
  const kb = useMemo(() => knowledgeStats(kbData?.metrics), [kbData])
  const kbSt = blockState({
    unlocked: on, loading: graph.loading, error: graph.error, hasData: !!kbData, empty: !!kbData && !kbData.metrics, nowMs,
    updatedAtMs: kbData?.computedAt ? Date.parse(kbData.computedAt) : null, expectedEveryMin: EXPECTED_EVERY_MIN.graph,
  })
  const ideasList = ideas.data
  const ideaTop = useMemo(() => (ideasList ? pickTopIdeas(ideasList.ideas, ideasList.top) : []), [ideasList])
  const ideasSt = blockState({
    unlocked: on, loading: ideas.loading, error: ideas.error, hasData: !!ideasList, empty: !!ideasList && (!ideasList.available || ideaTop.length === 0), nowMs,
    expectedEveryMin: EXPECTED_EVERY_MIN.ideas,
  })
  const places = food.data?.places ?? []
  const wantInfo = useMemo(() => oldestWantPlace(places, now), [places, now])
  const foodSt = blockState({
    unlocked: on, loading: food.loading, error: food.error, hasData: !!food.data, empty: !!food.data && places.length === 0, nowMs,
    expectedEveryMin: EXPECTED_EVERY_MIN.food,
  })
  const tripList = trips.data?.trips ?? []
  const trip = useMemo(() => latestTrip(tripList), [tripList])
  const tripsSt = blockState({
    unlocked: on, loading: trips.loading, error: trips.error, hasData: !!trips.data, empty: !!trips.data && !trip, nowMs,
    expectedEveryMin: EXPECTED_EVERY_MIN.trips,
  })

  // ── ① 的趨勢說明與那一句話 ──
  const historyUsable = histBase.state === 'fresh' || histBase.state === 'stale'
  const trendNote = history.loading ? '趨勢載入中'
    : history.error && !history.data ? '趨勢暫時無法取得'
    : historyUsable && trend.historyDays < 2 ? `資料累積中：再 ${2 - trend.historyDays} 天會畫出趨勢`
    : !historyUsable && histBase.state !== 'pending' ? '趨勢暫時無法取得'
    : null
  const sentence = todaySentence({ trend, rows: breakdown?.rows ?? [], trendKnown: trendNote === null })

  // ── 里程碑（只列算得出來的）──
  const miles = useMemo(() => milestones({
    events: kb.events, people: kb.people,
    ideasDone: ideasList ? statusCounts(ideasList.ideas).done : null,
    placesBeen: food.data ? placesBeenCount(places) : null,
    hhi: history.data ? { score: breakdown?.displayed ?? null, history: history.data, todayIso } : null,
  }), [kb, ideasList, food.data, places, history.data, breakdown, todayIso])

  // ── ⑤ 一顆燈 ──
  const pusher = pusherSummary(status.data?.pushers)
  const deadBlocks = [
    ...(hhiSt.state === 'dead' ? [{ label: '幸福指數', ageMin: hhiSt.ageMin ?? 0 }] : []),
    ...(histBase.state === 'dead' ? [{ label: '幸福指數歷史', ageMin: histBase.ageMin ?? 0 }] : []),
    ...(kbSt.state === 'dead' ? [{ label: '知識庫累積', ageMin: kbSt.ageMin ?? 0 }] : []),
  ]
  const light = useMemo(() => systemLight({
    nowMs,
    pipeline: { data: pipeline.data, error: pipeline.error }, status: { data: status.data, error: status.error }, usage: { data: usage.data, error: usage.error },
    pusher, badFeeds: badFeedNames(status.data?.pushers, (f) => FEED_LABEL[f] ?? f), deadBlocks,
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }), [nowMs, pipeline.data, pipeline.error, status.data, status.error, usage.data, usage.error, hhiSt.state, histBase.state, kbSt.state])
  const sysLoading = pipeline.loading && status.loading && usage.loading
  const sysSt = blockState({ unlocked: on, loading: sysLoading, error: false, hasData: !sysLoading, nowMs })
  const alert = on && (light.level === 'warn' || light.level === 'crit')

  const g = greeting(now)
  const dateLabel = new Intl.DateTimeFormat('zh-TW', { timeZone: 'Asia/Taipei', month: 'numeric', day: 'numeric', weekday: 'short' }).format(now)
  const closeDrawer = () => setDrawer(null)

  return (
    <div className="hm-root" data-sys={alert ? 'alert' : 'ok'}>
      <TodaySection greetingText={g.text} part={g.part} dateLabel={dateLabel} st={hhiSt} breakdown={breakdown} trend={trend} trendNote={trendNote} sentence={sentence}
        year={yearProgress(now)} toneOf={toneOf} onOpen={() => setDrawer('hhi')} onRequestUnlock={onRequestUnlock} />
      <SystemSection st={sysSt} light={light} onOpen={() => setDrawer('ops')} onRequestUnlock={onRequestUnlock} />
      <DimensionsSection st={hhiSt} breakdown={breakdown} onOpen={() => setDrawer('hhi')} onRequestUnlock={onRequestUnlock} />
      <GrowthSection histSt={heatSt} heat={heat} heatPending={`資料累積中：有紀錄的日子還不到 2 天（目前 ${heat.withData} 天）`}
        kbSt={kbSt} kb={kb} milestones={miles} toneOf={toneOf} onRequestUnlock={onRequestUnlock} onRetryHistory={history.reload} onRetryKb={graph.reload} />
      <FunSection ideasSt={ideasSt} ideasCount={ideasList?.ideas.length ?? 0} topIdeas={ideaTop}
        foodSt={foodSt} food={{ want: wantInfo ? { name: wantInfo.place.name, kind: wantInfo.place.kind, area: wantInfo.place.area, days: wantInfo.days } : null, been: placesBeenCount(places), total: places.length }}
        tripsSt={tripsSt} trip={trip} onOpenIdeas={() => setDrawer('ideas')} onRequestUnlock={onRequestUnlock}
        onRetryIdeas={ideas.reload} onRetryFood={food.reload} onRetryTrips={trips.reload} />
      {drawer === 'hhi' && <Drawer title="幸福指數詳情：雷達・30 天洞察・趨勢・六維度子系統" onClose={closeDrawer}>{hhiDetail}</Drawer>}
      {drawer === 'ideas' && pw && <Drawer title="想法庫：全部想法・類別・狀態・優先分怎麼算" onClose={closeDrawer}><IdeasPanel pw={pw} /></Drawer>}
      {drawer === 'ops' && pw && <Drawer title="HERMES 戰情室：推送健康・關係網路・管線・硬碟・排程・活動・容器・趨勢" onClose={closeDrawer}><PusherHealthPanel pw={pw} />{opsDetail}</Drawer>}
    </div>
  )
}
