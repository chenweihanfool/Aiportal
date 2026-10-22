// 頂欄（2.53.0）：原本約 115px 高的大標題區壓成一條約 52px 的單列——左＝識別與標題，右＝入口、帳號／登出、版本、管理後台。
// 使用者 2026-10-22：「首頁標題太寬了 浪費空間」。樣式在 portal.css 的 tb-*（沿用 ip-head 類別，e2e 以它量高度）。
// 手機：同一列放不下時右側自動換到第二列；頁首跟著內容捲走（不釘住）。
import { AccountBadge } from './AuthGate'
import { FoodMapPill } from './FoodMapPill'
import { VersionHistory } from './VersionHistory'

export function TopBar({ portals, legacy, onOpenAdmin }: {
  /** /api/sites 回來的子系統數；0＝還在連線（未解鎖時也是 0） */
  portals: number
  /** #legacy 舊版首頁：標題旁多一個「回到新首頁」 */
  legacy: boolean
  /** 開管理後台（以前是右下角浮動的 ⚙，會蓋住內容；改收進頂欄） */
  onOpenAdmin?: () => void
}) {
  return (
    <header className="ip-head tb">
      <div className="tb-brand">
        <span className="tb-mark" aria-hidden />
        <h1 className="tb-title">翰翰儀表板</h1>
        <span className="tb-tag ip-head-sub">Life Instrumentation</span>
        {legacy && (
          <a className="hm-legacy-back" href="#" onClick={e => { e.preventDefault(); window.location.hash = '' }} title="回到新首頁">
            <span className="hm-legacy-badge">舊版首頁</span>← 回到新首頁
          </a>
        )}
      </div>
      <div className="tb-right ip-head-right">
        <FoodMapPill />
        <span className="tb-portals ip-portals" title="可用的子系統數（解鎖後）">{portals > 0 ? `${portals} PORTALS` : 'CONNECTING...'}</span>
        <AccountBadge />
        <VersionHistory />
        {onOpenAdmin && <button type="button" className="tb-icon" onClick={onOpenAdmin} title="管理後台" aria-label="管理後台">⚙</button>}
      </div>
    </header>
  )
}
