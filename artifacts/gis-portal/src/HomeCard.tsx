import type { CSSProperties, ReactNode } from 'react'
import { sectionDef } from './homeNav'

// 首頁區塊卡片（2.53.0）：每個區塊都用它包——id、aria-label、標題列（圖示＋名稱＋右側動作）都從 homeNav.ts 的 HOME_SECTIONS 註冊表帶出來，
// 新增區塊只要在註冊表加一筆、內容包一層 <HomeCard id="…">，導覽、捲動定位、標題樣式就一致。
// head={false}：細列型的區塊（系統燈、付費服務）與「今天」自己排版，不畫標題列。
export function HomeCard({ id, className, right, head = true, children, style, data }: {
  id: string
  /** 區塊自己的類別（hm-today、hm-dimsec…），排版位置（grid-area）由它決定 */
  className: string
  /** 標題列右側：連結、計數、說明 */
  right?: ReactNode
  head?: boolean
  children: ReactNode
  style?: CSSProperties
  /** 額外的 data-* 屬性（例如系統燈的 data-level） */
  data?: Record<string, string>
}) {
  const def = sectionDef(id)
  const dataAttrs = Object.fromEntries(Object.entries(data ?? {}).map(([k, v]) => [`data-${k}`, v]))
  return (
    <section id={id} className={`hm-card ${className}`} aria-label={def.title} style={style} {...dataAttrs}>
      {head && (
        <h2 className="hm-h">
          <span className="hm-h-icon" aria-hidden>{def.icon}</span>{def.title}
          {right && <span className="hm-h-right">{right}</span>}
        </h2>
      )}
      {children}
    </section>
  )
}
