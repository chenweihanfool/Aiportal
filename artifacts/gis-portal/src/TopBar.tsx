// 頂欄（2.53.0）：原本約 115px 高的大標題區壓成一條約 52px 的單列——左＝識別與標題，右＝入口、帳號／登出、版本、管理後台。
// 使用者 2026-10-22：「首頁標題太寬了 浪費空間」。樣式在 portal.css 的 tb-*（沿用 ip-head 類別，e2e 以它量高度）。
// 手機：同一列放不下時右側自動換到第二列；頁首跟著內容捲走（不釘住）。
import { useState } from 'react'
import { AccountBadge } from './AuthGate'
import { FoodMapPill } from './FoodMapPill'
import { VersionHistory } from './VersionHistory'
import { CLASSIC_REMOVAL_NOTE, type HomeLayout } from './homeLayout'
import { THEME_LABEL, THEME_MODES, applyThemeMode, browserThemeStore, readThemeMode, writeThemeMode, type ThemeMode } from './themeMode'

/** 深／淺／跟系統 三段切換（2.89.0）：存 localStorage hm-theme，dark／light 設 <html data-theme>，system 移除。 */
function ThemeToggle() {
  const [mode, setMode] = useState<ThemeMode>(() => readThemeMode(browserThemeStore()))
  const pick = (m: ThemeMode) => {
    setMode(m)
    writeThemeMode(browserThemeStore(), m)
    applyThemeMode(document.documentElement, m)
  }
  return (
    <div className="tb-seg" role="group" aria-label="外觀" data-testid="theme-toggle">
      {THEME_MODES.map(m => (
        <button key={m} type="button" className="tb-seg-btn" data-mode={m} aria-pressed={mode === m} onClick={() => pick(m)}>{THEME_LABEL[m]}</button>
      ))}
    </div>
  )
}

export function TopBar({ portals, legacy, onOpenAdmin, layout, onToggleLayout }: {
  /** /api/sites 回來的子系統數；0＝還在連線（未解鎖時也是 0） */
  portals: number
  /** #legacy 舊版首頁：標題旁多一個「回到新首頁」 */
  legacy: boolean
  /** 開管理後台（以前是右下角浮動的 ⚙，會蓋住內容；改收進頂欄） */
  onOpenAdmin?: () => void
  /** 目前的首頁版面；與 onToggleLayout 一起給時，頂欄多一個「舊版首頁」開關（#legacy 頁不給） */
  layout?: HomeLayout
  onToggleLayout?: () => void
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
        {layout && onToggleLayout && (
          <button type="button" className="tb-layout" data-testid="hm-layout-toggle" aria-pressed={layout === 'classic'} onClick={onToggleLayout} title={CLASSIC_REMOVAL_NOTE}>
            <span className="tb-layout-ic" aria-hidden>↺</span><span className="tb-layout-tx">舊版首頁</span>
          </button>
        )}
        <ThemeToggle />
        <FoodMapPill />
        <span className="tb-portals ip-portals" title="可用的子系統數（解鎖後）">{portals > 0 ? `${portals} PORTALS` : 'CONNECTING...'}</span>
        <AccountBadge />
        <VersionHistory />
        {onOpenAdmin && <button type="button" className="tb-icon" onClick={onOpenAdmin} title="管理後台" aria-label="管理後台">⚙</button>}
      </div>
    </header>
  )
}
