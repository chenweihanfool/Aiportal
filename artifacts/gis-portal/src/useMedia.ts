// 螢幕尺寸判斷（版面排列由 portal.css 的 media query 決定，這裡只決定要不要展開）。
import { useEffect, useState } from 'react'

// 桌面版（寬螢幕）版面：≥1100px 時工具連結改放左側常駐側欄、預設展開。
// 只用來決定「要不要展開／要不要多顯示副標題」；版面排列本身由 portal.css 的 media query 決定。
const DESKTOP_QUERY = '(min-width: 1100px)'
// 首頁儀表板（DesktopBoard）出現的尺寸：要跟 portal.css 的 .ip-board-wrap media query 同一組條件
export const BOARD_QUERY = '(min-width: 1100px) and (min-height: 640px)'
// 新首頁（HomeBoard）一個畫面放得下的尺寸：側欄佔掉約 240–320px，主區要夠寬才塞得下五段，比舊版多要求 ≥1300px（portal.css 的 .hm-wrap 同一組條件）
export const HOME_QUERY = '(min-width: 1300px) and (min-height: 640px)'
export function useMedia(query: string): boolean {
  const [d, setD] = useState(() => typeof window !== 'undefined' && window.matchMedia(query).matches)
  useEffect(() => {
    const mq = window.matchMedia(query)
    const on = () => setD(mq.matches)
    on()
    mq.addEventListener('change', on)
    return () => mq.removeEventListener('change', on)
  }, [query])
  return d
}
export function useIsDesktop(): boolean {
  return useMedia(DESKTOP_QUERY)
}
