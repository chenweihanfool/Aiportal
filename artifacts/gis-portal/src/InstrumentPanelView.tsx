// 入口網首頁：頁首、左側欄、主區（新首頁或舊版首頁）與兩個抽屜的內容。
import { AccountBadge } from './AuthGate'
import { DesktopBoard } from './DesktopBoard'
import { HomeBoard } from './HomeBoard'
import { COLOR, FONT } from './theme'
import { DimensionGauge, MindIndexCard, SUMMARY_BODIES, SocialIndexCard } from './DimensionCards'
import { HappinessHeroCard } from './HappinessHero'
import { FoodMapPill, ToolLinksZone } from './ToolLinks'
import { VersionHistory } from './VersionHistory'
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
}: {
  sites: SiteData[]
  dashboard: DashboardSummary[]
  unlocked: boolean
  unlockedPassword: string | null
  onSiteSelect: (site: SiteData) => void
  onRequestUnlock: () => void
  /** #legacy 舊版首頁：主區改畫原樣的 DesktopBoard（2.36.0 起預設首頁是 HomeBoard，舊版留作退路） */
  legacy?: boolean
}) {
  const publicSites = sites.filter(s => !s.isPrivate)
  const privateSites = sites.filter(s => s.isPrivate)

  // 有摘要的四個子系統（pf-cwh 等）在「六維度」卡上顯示儀表，連結本身仍列在工具連結的「私領域」裡——
  // 原本手機版把它們從工具連結拿掉、只留在六維度卡上，改用儀表板後六維度收進抽屜，私領域連結就整串不見了。
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
      <div className="ip-head" style={{
        position: 'relative', flexShrink: 0, padding: '1.4rem 2rem 1.1rem', borderBottom: `2px solid ${COLOR.line}`,
        display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', gap: '1.5rem', flexWrap: 'wrap',
      }}>
        <div>
          <div className="hm-titlerow">
          <h1 style={{ fontFamily: FONT.display, fontWeight: 800, fontSize: 'clamp(1.6rem, 4vw, 2.3rem)', margin: 0, lineHeight: 1, color: COLOR.ink, animation: 'header-flicker 12s infinite' }}>
            翰翰儀表板
          </h1>
          {legacy && (
            <a className="hm-legacy-back" href="#" onClick={e => { e.preventDefault(); window.location.hash = '' }} title="回到新首頁">
              <span className="hm-legacy-badge">舊版首頁</span>← 回到新首頁
            </a>
          )}
          </div>
          <span className="ip-head-sub" style={{ fontFamily: FONT.latin, fontSize: '0.62rem', letterSpacing: '0.2em', color: COLOR.amber, textTransform: 'uppercase', marginTop: '0.3rem', display: 'block' }}>
            Life Instrumentation · 即時遙測面板
          </span>
        </div>
        <div className="ip-head-right" style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: '0.2rem' }}>
          <FoodMapPill />
          <div className="ip-portals" style={{ fontFamily: FONT.mono, fontSize: '0.66rem', color: COLOR.steelDim, textAlign: 'right', lineHeight: 1.6 }}>
            {sites.length > 0 ? `${sites.length} PORTALS AVAILABLE` : 'CONNECTING...'}
          </div>
          <AccountBadge />
          <VersionHistory />
        </div>
      </div>

      <div className="ip-scroll" style={{ flex: 1, overflowY: 'auto', overflowX: 'hidden', padding: '1.4rem 1.6rem 5rem' }}>
        <div className="ip-layout">
          <aside className="ip-aside">
        <ToolLinksZone privateSites={privateSites} publicSites={publicSites} unlocked={unlocked} onSelect={onSiteSelect} />

          </aside>
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
                hhiError={hhiSummary?.status === 'error'} toneOf={hhiTone} onRequestUnlock={onRequestUnlock} hhiDetail={hhiDetail} opsDetail={opsDetail}
              />
            )}
          </div>

          </div>
        </div>

        {!boardOn && (
        <div style={{ marginTop: '1.4rem', paddingTop: '1rem', borderTop: `1px solid ${COLOR.line}`, display: 'flex', justifyContent: 'space-between', flexWrap: 'wrap', gap: '0.6rem', fontFamily: FONT.mono, fontSize: '0.6rem', color: COLOR.steelDim, letterSpacing: '0.06em' }}>
            <span>AIPORTAL · INSTRUMENT PANEL</span>
            <span>🔐 PRIVATE REQUIRES PASSWORD</span>
          </div>
        )}
      </div>
    </div>
  )
}
