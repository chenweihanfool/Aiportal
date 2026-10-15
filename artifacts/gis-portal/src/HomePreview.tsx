import type { ReactNode } from 'react'
import { COLOR, FONT } from './theme'
import { HomeBoard } from './HomeBoard'

// 新首頁預覽頁（#home）：頁首標「預覽版」與回到目前首頁的連結，內容就是 HomeBoard。
// 目前的首頁完全沒動；使用者看過截圖同意後，才把 HomeBoard 換成預設首頁。
export function HomePreview({ unlocked, unlockedPassword, hhiData, hhiFetchedAt, hhiError, toneOf, onRequestUnlock, hhiDetail, opsDetail }: {
  unlocked: boolean
  unlockedPassword: string | null
  hhiData: Record<string, unknown> | undefined
  hhiFetchedAt?: string | null
  hhiError?: boolean
  toneOf: (s: number) => { color: string; label: string }
  onRequestUnlock: () => void
  hhiDetail: ReactNode
  opsDetail: ReactNode
}) {
  return (
    <div className="hm-page" style={{ background: COLOR.panelDeep }}>
      <header className="hm-topbar">
        <h1 style={{ fontFamily: FONT.display }}>翰翰儀表板 <span>新首頁</span></h1>
        <span className="hm-preview-badge" title="這是新首頁的預覽，現在的首頁沒有被取代">預覽版</span>
        <a className="hm-back" href="#" onClick={(e) => { e.preventDefault(); window.location.hash = '' }}>← 回到目前首頁</a>
      </header>
      <main className="hm-scroll" aria-label="新首頁預覽">
        <HomeBoard unlocked={unlocked} unlockedPassword={unlockedPassword} hhiData={hhiData} hhiFetchedAt={hhiFetchedAt} hhiError={hhiError} toneOf={toneOf}
          onRequestUnlock={onRequestUnlock} hhiDetail={hhiDetail} opsDetail={opsDetail} />
      </main>
    </div>
  )
}
