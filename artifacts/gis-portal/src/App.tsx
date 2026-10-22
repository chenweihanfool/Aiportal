// 翰翰儀表板入口：解鎖狀態、網址路由（#graph／#food／#trips／#dim／#legacy）與指令面板。
import { useCallback, useEffect, useState } from 'react'
import { DimensionPage } from './DimensionPage'
import { FoodMapView } from './FoodMapView'
import { RelationshipUniverse } from './RelationshipUniverse'
import { ArchitectureView } from './ArchitectureView'
import { TimelineView } from './TimelineView'
import { TripsView } from './TripsView'
import { dimKeyFromHash } from './dimensionPage'
import { YearReview } from './YearReview'
import { yearFromHash } from './yearReview'
import { COLOR } from './theme'
import { CommandPalette } from './CommandPalette'
import { AdminAuthModal, AdminPanel, PasswordModal } from './Dialogs'
import { DimensionDetail, dimensionLinks } from './DimensionDetail'
import { InstrumentPanelView } from './InstrumentPanelView'
import { hhiTone } from './format'
import { UNLOCK_KEY, apiFetchDashboard, apiFetchSites, type DashboardSummary, type SiteData } from './portalApi'
import './portal.css'

/** #trips/<id> 的 id（網址編碼還原；格式壞掉就當作找不到） */
function tripIdFromHash(hash: string): string {
  try { return decodeURIComponent(hash.slice('#trips/'.length)) } catch { return hash.slice('#trips/'.length) }
}
// ─────────────────────────────────────────────
// App
// ─────────────────────────────────────────────
export default function App() {
  const [sites, setSites] = useState<SiteData[]>([])
  const [dashboard, setDashboard] = useState<DashboardSummary[]>([])
  const [unlockedPassword, setUnlockedPassword] = useState<string | null>(() => localStorage.getItem(UNLOCK_KEY))
  const unlocked = !!unlockedPassword
  const [modal, setModal] = useState<{ visible: boolean; pendingUrl: string }>({ visible: false, pendingUrl: '' })
  const [adminAuth, setAdminAuth] = useState(false)
  const [adminOpen, setAdminOpen] = useState(false)
  const [adminPassword, setAdminPassword] = useState('')
  // 全頁 3D 關係宇宙走 hash route（#graph），不是路徑 route——這個 SPA 沒
  // 有接路由庫，路徑 route 在 refresh/直接貼網址時需要伺服端 SPA fallback
  // 設定，hash 則完全是前端狀態，不需要動部署那端的反向代理規則。
  // #home（新首頁預覽時期分享出去的網址）已等同預設首頁：直接把網址的 hash 清掉，免得停在一個沒有意義的路由上
  const readHash = () => {
    const h = window.location.hash
    if (h === '#home') {
      try { window.history.replaceState(null, '', window.location.pathname + window.location.search) } catch { /* 取不到 history 就維持原網址 */ }
      return ''
    }
    return h
  }
  const [hashRoute, setHashRoute] = useState(readHash)
  useEffect(() => {
    const onHashChange = () => setHashRoute(readHash())
    window.addEventListener('hashchange', onHashChange)
    return () => window.removeEventListener('hashchange', onHashChange)
  }, [])

  // 面向對應的子系統連結（人生進度、健身追蹤、任務追蹤）：要解鎖才給；未解鎖或抓失敗就是空清單
  useEffect(() => {
    if (!unlockedPassword) { setSites([]); return }
    apiFetchSites(unlockedPassword)
      .then(data => { setSites(data) })
      .catch(() => { /* keep empty sites on error */ })
  }, [unlockedPassword])

  useEffect(() => {
    apiFetchDashboard(unlockedPassword)
      .then(({ summaries, unlocked }) => {
        setDashboard(summaries)
        if (unlockedPassword && !unlocked) {
          localStorage.removeItem(UNLOCK_KEY)
          setUnlockedPassword(null)
        }
      })
      .catch(() => { /* keep whatever we have */ })
  }, [unlockedPassword])

  const openUrl = useCallback((url: string, isPrivate: boolean) => {
    if (!isPrivate || unlocked) {
      window.open(url, '_blank', 'noopener,noreferrer')
    } else {
      setModal({ visible: true, pendingUrl: url })
    }
  }, [unlocked])

  const handleSiteClick = useCallback((site: SiteData) => {
    openUrl(site.links[0]?.url ?? '', site.isPrivate)
  }, [openUrl])

  const handleRequestUnlock = useCallback(() => {
    setModal({ visible: true, pendingUrl: '' })
  }, [])

  const handleModalSuccess = useCallback((password: string) => {
    setUnlockedPassword(password)
    setModal({ visible: false, pendingUrl: '' })
  }, [])

  const handleAdminAuthSuccess = useCallback((pw: string) => {
    setAdminPassword(pw)
    setAdminAuth(false)
    setAdminOpen(true)
  }, [])

  // 年度回顧（P2-1）：#year＝今年，#year/<年>＝指定的年；年份不合理就當首頁
  const reviewYear = yearFromHash(hashRoute, Number(new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Taipei', year: 'numeric' }).format(new Date())))
  if (reviewYear !== null) {
    return <YearReview year={reviewYear} unlocked={unlocked} unlockedPassword={unlockedPassword} toneOf={hhiTone} onRequestUnlock={handleRequestUnlock} />
  }
  if (hashRoute === '#graph') {
    return <RelationshipUniverse unlockedPassword={unlockedPassword} onBack={() => { window.location.hash = '' }} />
  }
  // 知識庫架構頁（2026-10-22）：分層架構圖＋L1～L5 即時狀態；入口在首頁「成長軌跡」與戰情室旁
  if (hashRoute === '#architecture') {
    return <ArchitectureView unlockedPassword={unlockedPassword} onBack={() => { window.location.hash = '' }} onRequestUnlock={handleRequestUnlock} />
  }
  if (hashRoute === '#graph/timeline') {
    return <TimelineView unlockedPassword={unlockedPassword} onBack={() => { window.location.hash = '' }} />
  }
  // 美食地圖（2026-10-15）：解鎖後讀知識庫的地點（/api/hermes-places），沒有資料才退回示範資料；入口見首頁按鈕與 ⌘K 輸入「美食」。
  if (hashRoute === '#food') {
    return <FoodMapView onBack={() => { window.location.hash = '' }} unlockedPassword={unlockedPassword} />
  }
  // 遊記（2026-10-15）：#trips 列表、#trips/<id> 單趟；兩者同一個元件，切換時不重抓資料
  if (hashRoute === '#trips') {
    return <TripsView tripId={null} unlockedPassword={unlockedPassword} />
  }
  if (hashRoute.startsWith('#trips/')) {
    return <TripsView tripId={tripIdFromHash(hashRoute)} unlockedPassword={unlockedPassword} />
  }

  return (
    <div style={{ width: '100vw', height: '100vh', background: COLOR.panelDeep, position: 'relative', overflow: 'hidden' }}>
      <InstrumentPanelView
        sites={sites}
        dashboard={dashboard}
        unlocked={unlocked}
        unlockedPassword={unlockedPassword}
        onSiteSelect={handleSiteClick}
        onRequestUnlock={handleRequestUnlock}
        legacy={hashRoute === '#legacy'}
      />

      <button
        onClick={() => setAdminAuth(true)}
        title="管理後台"
        style={{
          position: 'absolute', bottom: '1.5rem', right: '1.5rem', zIndex: 100,
          background: COLOR.panel, border: `1px solid ${COLOR.line}`, borderRadius: '5px',
          color: COLOR.steelDim, fontSize: '1rem', padding: '0.5rem 0.8rem', cursor: 'pointer', lineHeight: 1,
        }}
      >⚙</button>

      {(() => {
        const dimKey = dimKeyFromHash(hashRoute)
        if (!dimKey) return null
        const hhi = dashboard.find(d => d.subsystemId === 'hhi')
        return (
          <DimensionPage
            dimKey={dimKey} hhiData={hhi?.data ?? undefined} hhiFetchedAt={hhi?.fetchedAt ?? null} hhiError={hhi?.status === 'error'}
            unlocked={unlocked} unlockedPassword={unlockedPassword} toneOf={hhiTone} onRequestUnlock={handleRequestUnlock}
            detail={<DimensionDetail dimKey={dimKey} dashboard={dashboard} />} links={dimensionLinks(dimKey, sites, handleSiteClick)}
          />
        )
      })()}

      <CommandPalette
        sites={sites}
        unlocked={unlocked}
        onSelect={handleSiteClick}
        onNavigateGraph={() => { window.location.hash = 'graph' }}
      />

      {modal.visible && (
        <PasswordModal
          pendingUrl={modal.pendingUrl}
          onSuccess={handleModalSuccess}
          onCancel={() => setModal({ visible: false, pendingUrl: '' })}
        />
      )}

      {adminAuth && !adminOpen && (
        <AdminAuthModal onSuccess={handleAdminAuthSuccess} onCancel={() => setAdminAuth(false)} />
      )}

      {adminOpen && <AdminPanel adminPassword={adminPassword} onClose={() => setAdminOpen(false)} />}
    </div>
  )
}
