import type { ReactNode } from 'react'
import { COLOR, FONT } from './theme'

export type GraphTab = 'universe' | 'timeline'

// 全頁殼：頂端「← 返回儀表板」＋兩個分頁（關係宇宙／時間軸）。原本內嵌在 RelationshipUniverse.tsx，
// 抽出來讓兩個分頁共用同一個頁首；分頁用 hash route 切換（#graph／#graph/timeline），跟既有路由同一套做法。
export function GraphShell({ tab, onBack, children }: { tab: GraphTab; onBack: () => void; children: ReactNode }) {
  const tabStyle = (active: boolean) => ({
    cursor: 'pointer', background: 'none', border: 'none', padding: '0.25rem 0.1rem', fontFamily: FONT.body,
    fontSize: '0.82rem', fontWeight: 600, color: active ? COLOR.amber : COLOR.steelDim,
    borderBottom: `2px solid ${active ? COLOR.amber : 'transparent'}`,
  } as const)
  return (
    <div style={{ position: 'fixed', inset: 0, background: COLOR.panelDeep, display: 'flex', flexDirection: 'column', zIndex: 200 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', padding: '0.7rem 1.2rem', borderBottom: `1px solid ${COLOR.line}`, flexWrap: 'wrap' }}>
        <span onClick={onBack} style={{ cursor: 'pointer', color: COLOR.amberDim, fontFamily: FONT.mono, fontSize: '0.72rem', letterSpacing: '0.04em' }}>← 返回儀表板</span>
        <nav aria-label="關係圖分頁" style={{ display: 'flex', gap: '1.1rem' }}>
          <button type="button" aria-current={tab === 'universe' ? 'page' : undefined} style={tabStyle(tab === 'universe')}
            onClick={() => { window.location.hash = '#graph' }}>事人物關係宇宙</button>
          <button type="button" aria-current={tab === 'timeline' ? 'page' : undefined} style={tabStyle(tab === 'timeline')}
            onClick={() => { window.location.hash = '#graph/timeline' }}>時間軸</button>
        </nav>
      </div>
      <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>{children}</div>
    </div>
  )
}
