import type { ReactNode } from 'react'
import { CV, FONT } from './theme'

export type GraphTab = 'dossier' | 'timeline'

// 全頁殼：頂端「← 返回儀表板」＋分頁（卷宗、時間軸）。原本內嵌在關係圖頁，
// 抽出來讓分頁共用同一個頁首；分頁用 hash route 切換（#dossier／#graph/timeline），跟既有路由同一套做法。
export function GraphShell({ tab, onBack, extra, children }: { tab: GraphTab; onBack: () => void; extra?: ReactNode; children: ReactNode }) {
  const tabStyle = (active: boolean) => ({
    cursor: 'pointer', background: 'none', border: 'none', padding: '0.25rem 0.1rem', fontFamily: FONT.body,
    fontSize: '0.82rem', fontWeight: 600, color: active ? CV.amber : CV.steelDim,
    borderBottom: `2px solid ${active ? CV.amber : 'transparent'}`,
  } as const)
  return (
    <div style={{ position: 'fixed', inset: 0, background: CV.panelDeep, display: 'flex', flexDirection: 'column', zIndex: 200 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', padding: '0.7rem 1.2rem', borderBottom: `1px solid ${CV.line}`, flexWrap: 'wrap' }}>
        <span onClick={onBack} style={{ cursor: 'pointer', color: CV.amberDim, fontFamily: FONT.mono, fontSize: '0.72rem', letterSpacing: '0.04em' }}>← 返回儀表板</span>
        <nav aria-label="關係圖分頁" style={{ display: 'flex', gap: '1.1rem' }}>
          <button type="button" aria-current={tab === 'dossier' ? 'page' : undefined} style={tabStyle(tab === 'dossier')}
            onClick={() => { window.location.hash = '#dossier' }}>卷宗</button>
          <button type="button" aria-current={tab === 'timeline' ? 'page' : undefined} style={tabStyle(tab === 'timeline')}
            onClick={() => { window.location.hash = '#graph/timeline' }}>時間軸</button>
        </nav>
        {extra}
      </div>
      <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>{children}</div>
    </div>
  )
}
