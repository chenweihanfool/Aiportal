// 入口網首頁：頁首、主區（新首頁或舊版首頁）與兩個抽屜的內容。
import { DesktopBoard } from './DesktopBoard'
import { HomeBoard } from './HomeBoard'
import { COLOR } from './theme'
import { DimensionGauge, MindIndexCard, SUMMARY_BODIES, SocialIndexCard } from './DimensionCards'
import { HappinessHeroCard } from './HappinessHero'
import { TopBar } from './TopBar'
import { HermesWarRoomSection } from './WarRoom'
import { hhiTone } from './format'
import { SubLabel } from './panelUi'
import { type DashboardSummary, type SiteData } from './portalApi'
import { BOARD_QUERY, useMedia } from './useMedia'

// ─────────────────────────────────────────────
// Instrument Panel View — top-level layout
// ─────────────────────────────────────────────
export function InstrumentPanelView({
  sites,
  dashboard,
  unlocked,
  unlockedPassword,
  onSiteSelect,
  onRequestUnlock,
  legacy = false,
  onOpenAdmin,
}: {
  sites: SiteData[]
  dashboard: DashboardSummary[]
  unlocked: boolean
  unlockedPassword: string | null
  onSiteSelect: (site: SiteData) => void
  onRequestUnlock: () => void
  /** #legacy 舊版首頁：主區改畫原樣的 DesktopBoard（2.36.0 起預設首頁是 HomeBoard，舊版留作退路） */
  legacy?: boolean
  /** 開管理後台（頂欄的 ⚙） */
  onOpenAdmin?: () => void
}) {
  const privateSites = sites.filter(s => s.isPrivate)

  // 有摘要的四個子系統（pf-cwh 等）在「六維度」卡上顯示儀表，連結（人生進度、健身追蹤、任務追蹤）
  // 2026-10-22 起也放在首頁六個面向卡上；工具連結區已拿掉。
  const richSites = privateSites.filter(s => {
    const summary = s.subsystemId ? dashboard.find(d => d.subsystemId === s.subsystemId) : undefined
    return !!(summary && SUMMARY_BODIES[summary.subsystemId])
  })
  const HHI_SITE_PRIORITY: Record<string, number> = { 'pf-cwh': 0, fitnessforge: 1, vikunja: 2, travel: 3 }
  richSites.sort((a, b) => (HHI_SITE_PRIORITY[a.subsystemId ?? ''] ?? 99) - (HHI_SITE_PRIORITY[b.subsystemId ?? ''] ?? 99))
  const hhiSummary = dashboard.find(d => d.subsystemId === 'hhi')
  // 電腦版儀表板要一個畫面放得下，頁尾只在手機、窄／矮視窗（頁面本來就要捲動）顯示
  // 新首頁改成可捲動（2026-10-22），頁尾一律顯示；只有舊版 #legacy 仍是一個畫面不捲動
  const boardOn = useMedia(BOARD_QUERY) && legacy

  const dimsGrid = (
    <div className="ip-dim-row" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: '1rem' }}>
      {richSites.map(s => {
        const summary = dashboard.find(d => d.subsystemId === s.subsystemId)!
        return <DimensionGauge key={s.id} site={s} summary={summary} hhiSummary={hhiSummary} unlocked={unlocked} onSelect={onSiteSelect} />
      })}
      <MindIndexCard
        summary={dashboard.find(d => d.subsystemId === 'mind-index')}
        hhiSummary={hhiSummary}
        unlocked={unlocked}
        onSelect={onRequestUnlock}
      />
      <SocialIndexCard
        summary={dashboard.find(d => d.subsystemId === 'social-index')}
        hhiSummary={hhiSummary}
        unlocked={unlocked}
        onSelect={onRequestUnlock}
      />
    </div>
  )

  // 抽屜內容：新舊首頁共用同一份（幸福指數詳情、HERMES 戰情室）
  const hhiDetail = (
    <>
      <HappinessHeroCard summary={hhiSummary} unlocked={unlocked} unlockedPassword={unlockedPassword} onRequestUnlock={onRequestUnlock} />
      <div style={{ marginTop: '1.4rem' }}>
        <SubLabel>六維度子系統（點卡片可前往該系統）</SubLabel>
        {dimsGrid}
      </div>
    </>
  )
  const opsDetail = <HermesWarRoomSection unlocked={unlocked} unlockedPassword={unlockedPassword} onRequestUnlock={onRequestUnlock} />

  return (
    <div className="ip-shell" style={{ width: '100%', height: '100%', position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', overflow: 'hidden', background: COLOR.panelDeep }}>
      <TopBar portals={sites.length} legacy={legacy} onOpenAdmin={onOpenAdmin} />

      <div className="ip-scroll" style={{ flex: 1, overflowY: 'auto', overflowX: 'hidden', padding: 'var(--sp-4) var(--sp-5) var(--sp-6)' }}>
        <div className="ip-layout">
          <div className="ip-main">
        {/* 預設首頁（2.36.0 起）：HomeBoard 五段式；電腦版一個畫面放得下（含左側欄），手機、窄／矮視窗上下堆疊（portal.css 的 hm-*）。
            #legacy 舊版首頁：原樣的 DesktopBoard。兩者共用同一份抽屜內容與 .ip-board-wrap 的高度算法。 */}
          <div className={`ip-board-wrap${legacy ? '' : ' hm-wrap'}`}>
            {legacy ? (
              <DesktopBoard
                unlocked={unlocked} unlockedPassword={unlockedPassword} hhiData={hhiSummary?.data ?? undefined} toneOf={hhiTone} onRequestUnlock={onRequestUnlock}
                hhiDetail={hhiDetail} opsDetail={opsDetail}
              />
            ) : (
              <HomeBoard
                unlocked={unlocked} unlockedPassword={unlockedPassword} hhiData={hhiSummary?.data ?? undefined} hhiFetchedAt={hhiSummary?.fetchedAt ?? null}
                hhiError={hhiSummary?.status === 'error'} toneOf={hhiTone} onRequestUnlock={onRequestUnlock} hhiDetail={hhiDetail} opsDetail={opsDetail} sites={sites}
              />
            )}
          </div>

          </div>
        </div>

        {!boardOn && (
        <div className="ip-foot">
            <span>AIPORTAL · INSTRUMENT PANEL</span>
            <span>🔐 PRIVATE REQUIRES PASSWORD</span>
          </div>
        )}
      </div>
    </div>
  )
}
