// 手機頁首的美食及旅遊地圖入口膠囊（電腦版從好玩的／⌘K 進）。
// 2026-10-22：手動維護的「工具連結」（公領域／私領域）整區拿掉，改由首頁的 GitHub 倉庫索引取代。
import { COLOR } from './theme'

// 首頁入口：美食及旅遊地圖（#food）。之前只有 ⌘K 能進，手機沒有這個鍵，首頁上看不到。
export function FoodMapPill() {
  return (
    <a
      href="#food"
      className="fm-entry-pill"
      data-testid="food-entry-pill"
      onClick={e => { e.preventDefault(); window.location.hash = 'food' }}
      style={{
        display: 'inline-flex', alignItems: 'center', gap: '0.4rem', textDecoration: 'none', cursor: 'pointer',
        padding: '0.35rem 0.8rem', borderRadius: '999px', fontSize: '0.78rem', fontWeight: 700,
        background: 'rgba(245,166,35,0.14)', border: `1px solid ${COLOR.amberDim}`, color: COLOR.amber, whiteSpace: 'nowrap',
      }}
    >🍜🧭 美食及旅遊地圖 →</a>
  )
}
