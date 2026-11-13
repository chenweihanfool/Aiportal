import { useMemo, useState, type ReactNode } from 'react'
import { apiFetchHermesGraph } from './hermesGraphApi'
import { apiFetchRepos } from './repoApi'
import { HomeNav } from './HomeNav'
import { ChatDock } from './ChatPanel'
import { OmniSearch } from './OmniSearch'
import { prefillHermesChat } from './chatView'
import { ReposSection } from './RepoSection'
import { apiFetchPaidServices, apiFetchBoardPipeline, apiFetchBoardStatus, apiFetchIdeas, apiFetchUsage } from './boardApi'
import { apiFetchFood } from './foodApi'
import { apiFetchTrips } from './tripsApi'
import { biggestDrag, buildHhiBreakdown } from './boardView'
import { topIdeas as pickTopIdeas, statusCounts } from './ideasView'
import { Drawer, FEED_LABEL, IdeasPanel, PusherHealthPanel, pusherSummary } from './DesktopBoard'
import { dimHash } from './dimensionPage'
import { fetchHhiHistoryStrict } from './homeApi'
import { DIMENSIONS, dimensionSiteLinks } from './dimensions'
import type { SiteData } from './portalApi'
import { useAsync, useNow } from './homeHooks'
import { PaidServicesPanel, PaidServicesSection } from './PaidServices'
import { BriefSection, CompanionSection, DimensionsSection, FunSection, GrowthSection, SystemSection, TodaySection, YearHeat } from './HomeSections'
import { StateFrame } from './StateFrame'
import { StatusAside } from './StatusAside'
import { PushStatsPanel, SearchStatsPanel } from './StatsDrawers'
import { apiFetchTopicsData, fetchPushStats14, fetchRecentSearches, fetchSearchStats7 } from './statsApi'
import { serviceSummary, todayLine } from './statusAside'
import type { HomeLayout } from './homeLayout'
import { activityInsight, apiFetchCompanion, apiFetchPersonActions, bestMove } from './companion'
import { apiFetchDailyLife } from './milestones'
import { apiFetchReports, crowdOf, parseBrief, pickBrief } from './briefView'
import { apiFetchGantt } from './taskGantt'
import { apiFetchTopicNudges } from './topicNudges'
import { NowSection } from './NowSection'
import { nowReady } from './nowCards'
import {
  EXPECTED_EVERY_MIN, badFeedNames, dataEveryMinFor, dimensionSeries, blockState, buildHeatmap, greeting, hhiRecordedDays, hhiTrend, historyUpdatedAtMs, knowledgeStats, latestTrip, milestones,
  oldestWantPlace, placesBeenCount, systemLight, taipeiDate, todaySentence, yearProgress, type BlockStatus, type DimSeries,
} from './homeView'

// 新首頁（審計報告 §2.6 五段式）：① 今天 → ② 六個面向 → ③ 成長軌跡 → ④ 好玩的 → ⑤ 系統一顆燈（異常時移到 ① 下方）。
// 獨立元件，props 與 DesktopBoard 類似；2.36.0 起是預設首頁的主區（App.tsx 的 InstrumentPanelView，左側欄的工具連結保留），舊版 DesktopBoard 在 #legacy。
// 資料全部來自既有 API 與既有型別／函式，沒有任何示範值：拿不到就依 StateFrame 的狀態機顯示（未解鎖／載入中／空／過期／失敗）。

type DrawerKey = 'hhi' | 'ops' | 'ideas' | 'svc' | 'searchStats' | 'pushStats' | 'brief'

const fetchHistory365 = (pw: string) => fetchHhiHistoryStrict(pw, 365)
// 面向小卡的 30 天迷你線：另外要 days=30（後端的 components 欄位只保證在這個呼叫裡；接口還沒部署時沒有該欄位，就不畫線）
const fetchHistory30 = (pw: string) => fetchHhiHistoryStrict(pw, 30)

export function HomeBoard({ unlocked, unlockedPassword, hhiData, hhiFetchedAt, hhiError, toneOf, onRequestUnlock, hhiDetail, opsDetail, sites, layout = 'v3' }: {
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
  /** 面向對應的子系統連結（/api/sites，要解鎖才有內容） */
  sites: SiteData[]
  /** 'v3'＝新版三塊（搜尋｜現在用得上｜STATUS）；'classic'＝舊版首頁（九個區塊＋左側導覽，DOM 與 2.87.0 相同） */
  layout?: HomeLayout
}) {
  const pw = unlocked && unlockedPassword ? unlockedPassword : null
  const now = useNow()
  const nowMs = now.getTime()
  const todayIso = taipeiDate(now)
  const [drawer, setDrawer] = useState<DrawerKey | null>(null)
  const v3 = layout === 'v3'
  // 最近搜尋的詞帶回搜尋框：n 每點一次加 1（OmniSearch 的 seed 介面）
  const [seed, setSeed] = useState({ q: '', n: 0 })

  const history = useAsync(pw, fetchHistory365)
  const history30 = useAsync(pw, fetchHistory30)
  const graph = useAsync(pw, apiFetchHermesGraph)
  const ideas = useAsync(pw, apiFetchIdeas)
  const food = useAsync(pw, apiFetchFood)
  const trips = useAsync(pw, apiFetchTrips)
  const pipeline = useAsync(pw, apiFetchBoardPipeline)
  const status = useAsync(pw, apiFetchBoardStatus)
  const pushers = status.data?.pushers
  const usage = useAsync(pw, apiFetchUsage)
  const paid = useAsync(pw, apiFetchPaidServices)
  const repos = useAsync(pw, apiFetchRepos)
  const companion = useAsync(pw, apiFetchCompanion)
  const personActions = useAsync(pw, apiFetchPersonActions)
  const dailyLife = useAsync(pw, apiFetchDailyLife)
  const reports = useAsync(pw, apiFetchReports)
  const gantt = useAsync(pw, apiFetchGantt)
  // 主題知識推播（給「現在用得上」區塊；失敗或沒資料時就沒有卡片，不併進既有區塊的狀態）
  const nudges = useAsync(pw, apiFetchTopicNudges)
  // STATUS 右欄（v3）才用的讀取：舊版首頁不發這些請求
  const pwV3 = v3 ? pw : null
  const topicsFeed = useAsync(pwV3, apiFetchTopicsData)
  const searchStats = useAsync(pwV3, fetchSearchStats7)
  const pushStats = useAsync(pwV3, fetchPushStats14)
  const recent = useAsync(pwV3, fetchRecentSearches)

  const dimLinks = useMemo(() => dimensionSiteLinks(sites), [sites])
  const breakdown = useMemo(() => buildHhiBreakdown(hhiData), [hhiData])
  const histData = history.data ?? []
  const trend = useMemo(() => hhiTrend(histData, todayIso, breakdown?.displayed ?? null), [histData, todayIso, breakdown])

  // ── 每面向 30 天迷你線：失敗、沒有 components、有效點不到 2 個，都靜靜地維持數值條（沒有錯誤提示）──
  const sparkSeries = useMemo(() => {
    if (!history30.data) return null
    const m: Record<string, DimSeries | null> = {}
    for (const d of DIMENSIONS) m[d.key] = dimensionSeries(history30.data, d.key, todayIso)
    return m
  }, [history30.data, todayIso])

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
    updatedAtMs: kbData?.computedAt ? Date.parse(kbData.computedAt) : null, expectedEveryMin: dataEveryMinFor(pushers, 'hermes-graph', EXPECTED_EVERY_MIN.graph),
  })
  const ideasList = ideas.data
  const ideaTop = useMemo(() => (ideasList ? pickTopIdeas(ideasList.ideas, ideasList.top) : []), [ideasList])
  const ideasSt = blockState({
    unlocked: on, loading: ideas.loading, error: ideas.error, hasData: !!ideasList, empty: !!ideasList && (!ideasList.available || ideaTop.length === 0), nowMs,
    expectedEveryMin: dataEveryMinFor(pushers, 'hermes-ideas', EXPECTED_EVERY_MIN.ideas),
  })
  const places = food.data?.places ?? []
  const wantEat = useMemo(() => oldestWantPlace(places, now, 'eat'), [places, now])
  const wantGo = useMemo(() => oldestWantPlace(places, now, 'go'), [places, now])
  const foodSt = blockState({
    unlocked: on, loading: food.loading, error: food.error, hasData: !!food.data, empty: !!food.data && places.length === 0, nowMs,
    expectedEveryMin: EXPECTED_EVERY_MIN.food,
  })
  const tripList = trips.data?.trips ?? []
  const trip = useMemo(() => latestTrip(tripList), [tripList])
  const tripsSt = blockState({
    unlocked: on, loading: trips.loading, error: trips.error, hasData: !!trips.data, empty: !!trips.data && !trip, nowMs,
    expectedEveryMin: dataEveryMinFor(pushers, 'hermes-trips', EXPECTED_EVERY_MIN.trips),
  })

  // ── ① 的趨勢說明與那一句話 ──
  const historyUsable = histBase.state === 'fresh' || histBase.state === 'stale'
  const trendNote = history.loading ? '趨勢載入中'
    : history.error && !history.data ? '趨勢暫時無法取得'
    : historyUsable && trend.historyDays < 2 ? `資料累積中：再 ${2 - trend.historyDays} 天會畫出趨勢`
    : !historyUsable && histBase.state !== 'pending' ? '趨勢暫時無法取得'
    : null
  const sentence = todaySentence({ trend, rows: breakdown?.rows ?? [], trendKnown: trendNote === null })
  // 提醒設定沒讀到時不點名（companion 傳 null → 一般建議），免得建議聯絡「不再提醒」的人
  const move = useMemo(() => bestMove(breakdown?.rows ?? [], personActions.data ? companion.data : null, personActions.data ?? [], todayIso), [breakdown, companion.data, personActions.data, todayIso])
  const insight = useMemo(() => activityInsight(histData, dailyLife.data), [histData, dailyLife.data])
  const brief = useMemo(() => pickBrief(reports.data, todayIso), [reports.data, todayIso])
  const briefParsed = useMemo(() => (brief ? parseBrief(brief.bodyMd, brief.date) : null), [brief])
  const briefCrowd = useMemo(() => (brief ? crowdOf(gantt.data, brief.date) : null), [gantt.data, brief])
  const briefSt = blockState({ unlocked: on, loading: reports.loading, error: reports.error, hasData: reports.data !== null, empty: !brief, nowMs })
  const companionSt = blockState({
    unlocked: on, loading: companion.loading, error: companion.error, hasData: !!companion.data, nowMs,
    updatedAtMs: companion.data ? Date.parse(companion.data.computedAt) : null, expectedEveryMin: 10,
  })

  // ── 里程碑（八組門檻；資料來源不可得的整組略過）──
  const miles = useMemo(() => milestones({
    events: kb.events, people: kb.people, concepts: kb.concepts, methods: kb.methods,
    ideasDone: ideasList ? statusCounts(ideasList.ideas).done : null,
    placesBeen: food.data ? placesBeenCount(places) : null,
    // 還沒出發的計畫中不算「遊記」
    trips: trips.data ? trips.data.trips.filter((t) => t.status !== 'planned').length : null,
    hhiDays: history.data ? hhiRecordedDays(history.data) : null,
  }), [kb, ideasList, food.data, places, trips.data, history.data])

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
  // ⑥ 付費服務：Ollama 用量與額度端點任一回來就顯示；兩邊都還沒回來才是載入中（付費端點失敗不影響首頁，該列自己顯示原因）
  const svcSt = blockState({ unlocked: on, loading: usage.loading && paid.loading, error: false, hasData: !(usage.loading && paid.loading), nowMs })
  // 倉庫索引：伺服器 30 分鐘更新一次，所以 30 分鐘是預期間隔；GitHub 抓不到時伺服器會回舊快取，這裡依 fetchedAt 判斷新舊
  const reposSt = blockState({
    unlocked: on, loading: repos.loading, error: repos.error, hasData: !!repos.data, empty: !!repos.data && repos.data.repos.length === 0, nowMs,
    updatedAtMs: repos.data ? Date.parse(repos.data.fetchedAt) : null, expectedEveryMin: 30,
  })
  const alert = on && (light.level === 'warn' || light.level === 'crit')

  const g = greeting(now)
  const dateLabel = new Intl.DateTimeFormat('zh-TW', { timeZone: 'Asia/Taipei', month: 'numeric', day: 'numeric', weekday: 'short' }).format(now)
  const closeDrawer = () => setDrawer(null)

  // 全站搜尋（2.86.0）：工具連結沿用原指令面板的做法——解鎖後才有 sites，直接開第一個連結
  const openSite = (site: SiteData) => { const url = site.links[0]?.url; if (url) window.open(url, '_blank', 'noopener,noreferrer') }

  // ── 新版首頁（v3）：搜尋框｜現在用得上｜STATUS 右欄。舊區塊整併去處見 docs 規格 S2：今天→STATUS 盒頭與標題列上方一行、明日報告→抽屜、
  //    陪伴→歷年今天變卡片／洞察進幸福指數抽屜、成長軌跡→幸福指數抽屜與 STATUS、倉庫→戰情室抽屜、系統與付費服務與六個面向→STATUS ──
  const hasComponents = (h: ReadonlyArray<{ components?: unknown }> | null) => !!h && h.some((x) => !!x.components)
  const dimHistory = hasComponents(history30.data) ? history30.data : hasComponents(history.data) ? history.data : null
  const svc = serviceSummary({ usage: usage.data, paid: paid.data, usageError: usage.error, paidError: paid.error })
  const wantLine = (w: typeof wantEat) => (w ? { name: w.place.name, kind: w.place.kind, area: w.place.area, days: w.days } : null)

  if (v3) {
    const openIdeas = () => { if (on) setDrawer('ideas'); else onRequestUnlock() }
    const insightBlock = (
      <div className="st-dsec" data-testid="activity-insight">
        <h3 className="hm-h3">🔍 什麼事讓你變好</h3>
        {insight.lines.length > 0 && <ul className="hm-comp-list">{insight.lines.map((l) => <li key={l}>{l}</li>)}</ul>}
        {insight.pending !== '' && <p className="hm-muted">{insight.pending}</p>}
      </div>
    )
    const growthBlock = (
      <div className="st-dsec" data-testid="st-hhi-growth">
        <h3 className="hm-h3">🌱 成長軌跡</h3>
        <StateFrame status={heatSt} source="幸福指數歷史" onRequestUnlock={onRequestUnlock} onRetry={history.reload}
          pendingText={`資料累積中：有紀錄的日子還不到 2 天（目前 ${heat.withData} 天）`}>
          <YearHeat heat={heat} toneOf={toneOf} />
        </StateFrame>
        <div className="hm-sub">里程碑</div>
        <ul className="hm-miles" aria-label="里程碑">
          {miles.badges.length === 0
            ? <li className="hm-muted">{miles.next ? '還沒有達成的里程碑' : '資料累積到門檻才會出現（只列算得出來的）'}</li>
            : miles.badges.map((m) => <li key={m.id} className="hm-mile" title={m.detail}><span aria-hidden>{m.icon}</span>{m.title}</li>)}
        </ul>
        {miles.next && <p className="hm-note"><span aria-hidden>{miles.next.icon}</span> {miles.next.text}（{Math.round(miles.next.ratio * 100)}%）</p>}
      </div>
    )
    return (
      <div className="st-root" data-sys={alert ? 'alert' : 'ok'} data-testid="st-root">
        {alert && (
          <button type="button" className="st-alert" data-testid="st-alert" data-level={light.level} onClick={() => setDrawer('ops')} aria-haspopup="dialog">
            <span aria-hidden>⚠</span><span className="st-alert-t">{light.headline}</span><span className="st-alert-go">戰情室 →</span>
          </button>
        )}
        <OmniSearch
          pw={pw} sites={sites} onSelectSite={openSite} seed={seed}
          onOpenIdeas={openIdeas}
          onOpenChat={(text) => { if (on) prefillHermesChat(text ?? ''); else onRequestUnlock() }}
          onRequestUnlock={onRequestUnlock} />
        <div className="st-home">
          <NowSection pw={pw} nowMs={nowMs} todayIso={todayIso} nudges={nudges.data} companion={companion.data} personActions={personActions.data} sourcesSettled={nowReady([nudges, companion, personActions])}
            briefInfo={brief ? { date: brief.date, summary: briefParsed?.tip ?? (briefParsed && briefParsed.tasks.length > 0 ? `${briefParsed.tasks.length} 件要注意的事` : brief.label) } : null}
            onActionsChange={personActions.reload}
            todayLine={on && breakdown ? todayLine(sentence, move) : null} onOpenBrief={() => setDrawer('brief')} />
          <StatusAside
            on={on} now={now} todayIso={todayIso} onRequestUnlock={onRequestUnlock}
            hhiSt={hhiSt} breakdown={breakdown} dimHistory={dimHistory} onOpenHhi={() => setDrawer('hhi')}
            topics={topicsFeed} searchStats={searchStats} pushStats={pushStats}
            onOpenSearchStats={() => setDrawer('searchStats')} onOpenPushStats={() => setDrawer('pushStats')}
            sysSt={sysSt} light={light} onOpenOps={() => setDrawer('ops')}
            svcSt={svcSt} svc={svc} onOpenSvc={() => setDrawer('svc')}
            recent={recent.data ?? []} onPickRecent={(q) => setSeed((x) => ({ q, n: x.n + 1 }))}
            ideasSt={ideasSt} topIdea={ideaTop[0] ?? null} foodSt={foodSt} wantEat={wantLine(wantEat)} wantGo={wantLine(wantGo)}
            tripsSt={tripsSt} trip={trip} onOpenIdeas={openIdeas} />
        </div>
        {drawer === 'hhi' && <Drawer title="幸福指數詳情：活動洞察・雷達・30 天洞察・趨勢・六維度子系統・成長軌跡" onClose={closeDrawer}>{insightBlock}{hhiDetail}{growthBlock}</Drawer>}
        {drawer === 'ideas' && pw && <Drawer title="想法庫：全部想法・類別・狀態・優先分怎麼算" onClose={closeDrawer}><IdeasPanel pw={pw} /></Drawer>}
        {drawer === 'svc' && pw && <Drawer title="付費服務：用量與連結・Ollama 更新餘額" onClose={() => { closeDrawer(); usage.reload() }}><PaidServicesPanel pw={pw} usage={usage.data} paid={paid.data} /></Drawer>}
        {drawer === 'searchStats' && pw && <Drawer title="搜尋統計：近 14 天" onClose={closeDrawer}><SearchStatsPanel pw={pw} /></Drawer>}
        {drawer === 'pushStats' && pw && <Drawer title="推送統計：近 14 天" onClose={closeDrawer}><PushStatsPanel pw={pw} /></Drawer>}
        {drawer === 'brief' && pw && <Drawer title="明日報告" onClose={closeDrawer}><BriefSection st={briefSt} brief={brief} parsed={briefParsed} crowd={briefCrowd} onRequestUnlock={onRequestUnlock} onRetry={reports.reload} /></Drawer>}
        {pw && <ChatDock pw={pw} />}
        {drawer === 'ops' && pw && (
          <Drawer title="HERMES 戰情室：推送健康・關係網路・管線・硬碟・排程・活動・容器・趨勢・倉庫" onClose={closeDrawer}>
            <PusherHealthPanel pw={pw} />{opsDetail}
            <div className="st-dsec" data-testid="st-ops-repos"><ReposSection st={reposSt} data={repos.data} now={now} onRequestUnlock={onRequestUnlock} onRetry={repos.reload} /></div>
          </Drawer>
        )}
      </div>
    )
  }

  return (
    <>
    <OmniSearch
      pw={pw} sites={sites} onSelectSite={openSite}
      onOpenIdeas={() => { if (on) setDrawer('ideas'); else onRequestUnlock() }}
      onOpenChat={(text) => { if (on) prefillHermesChat(text ?? ''); else onRequestUnlock() }}
      onRequestUnlock={onRequestUnlock} />
    <NowSection pw={pw} nowMs={nowMs} todayIso={todayIso} nudges={nudges.data} companion={companion.data} personActions={personActions.data} sourcesSettled={nowReady([nudges, companion, personActions])}
      briefInfo={brief ? { date: brief.date, summary: briefParsed?.tip ?? (briefParsed && briefParsed.tasks.length > 0 ? `${briefParsed.tasks.length} 件要注意的事` : brief.label) } : null}
      onActionsChange={personActions.reload} />
    <div className="hm-layout">
    <HomeNav onOpenIdeas={() => { if (on) setDrawer('ideas'); else onRequestUnlock() }} />
    <div className="hm-root" data-sys={alert ? 'alert' : 'ok'}>
      <TodaySection greetingText={g.text} part={g.part} dateLabel={dateLabel} st={hhiSt} breakdown={breakdown} trend={trend} trendNote={trendNote} sentence={sentence} move={move}
        year={yearProgress(now)} toneOf={toneOf} onOpen={() => setDrawer('hhi')} onRequestUnlock={onRequestUnlock}
        system={on && sysSt.state === 'fresh' ? light : null} onOpenSystem={() => setDrawer('ops')} />
      <SystemSection st={sysSt} light={light} onOpen={() => setDrawer('ops')} onRequestUnlock={onRequestUnlock} />
      <PaidServicesSection st={svcSt} usage={usage.data} paid={paid.data} onOpen={() => setDrawer('svc')} onRequestUnlock={onRequestUnlock} />
      <BriefSection st={briefSt} brief={brief} parsed={briefParsed} crowd={briefCrowd} onRequestUnlock={onRequestUnlock} onRetry={reports.reload} />
      <DimensionsSection st={hhiSt} breakdown={breakdown} series={sparkSeries} links={dimLinks} onOpen={(key) => { window.location.hash = dimHash(key) }} onRequestUnlock={onRequestUnlock} />
      <CompanionSection st={companionSt} data={companion.data} insight={insight} onRequestUnlock={onRequestUnlock} onRetry={companion.reload} pw={pw} today={todayIso} actions={personActions.data ?? undefined} onActionsChange={personActions.reload} actionsReady={personActions.data !== null} />
      <GrowthSection histSt={heatSt} heat={heat} heatPending={`資料累積中：有紀錄的日子還不到 2 天（目前 ${heat.withData} 天）`}
        kbSt={kbSt} kb={kb} milestones={miles} toneOf={toneOf} onRequestUnlock={onRequestUnlock} onRetryHistory={history.reload} onRetryKb={graph.reload} />
      <FunSection ideasSt={ideasSt} ideasCount={ideasList?.ideas.length ?? 0} topIdeas={ideaTop}
        foodSt={foodSt} food={{ wantEat: wantEat ? { name: wantEat.place.name, kind: wantEat.place.kind, area: wantEat.place.area, days: wantEat.days } : null, wantGo: wantGo ? { name: wantGo.place.name, kind: wantGo.place.kind, area: wantGo.place.area, days: wantGo.days } : null, been: placesBeenCount(places), total: places.length }}
        tripsSt={tripsSt} trip={trip} onOpenIdeas={() => setDrawer('ideas')} onRequestUnlock={onRequestUnlock}
        onRetryIdeas={ideas.reload} onRetryFood={food.reload} onRetryTrips={trips.reload} />
      <ReposSection st={reposSt} data={repos.data} now={now} onRequestUnlock={onRequestUnlock} onRetry={repos.reload} />
      {drawer === 'hhi' && <Drawer title="幸福指數詳情：雷達・30 天洞察・趨勢・六維度子系統" onClose={closeDrawer}>{hhiDetail}</Drawer>}
      {drawer === 'ideas' && pw && <Drawer title="想法庫：全部想法・類別・狀態・優先分怎麼算" onClose={closeDrawer}><IdeasPanel pw={pw} /></Drawer>}
      {drawer === 'svc' && pw && <Drawer title="付費服務：用量與連結・Ollama 更新餘額" onClose={() => { closeDrawer(); usage.reload() }}><PaidServicesPanel pw={pw} usage={usage.data} paid={paid.data} /></Drawer>}
      {pw && <ChatDock pw={pw} />}
      {drawer === 'ops' && pw && <Drawer title="HERMES 戰情室：推送健康・關係網路・管線・硬碟・排程・活動・容器・趨勢" onClose={closeDrawer}><PusherHealthPanel pw={pw} />{opsDetail}</Drawer>}
    </div>
    </div>
    </>
  )
}
