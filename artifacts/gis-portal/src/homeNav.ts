// 首頁區塊註冊表：錨點導覽、捲動定位、區塊卡片的標題列（HomeCard）都由這張表產生。
// 新增區塊 = 在這裡加一筆，再用 <HomeCard id="…"> 包住該區塊的內容（id、aria-label、圖示與標題自動帶上）。
// 順序＝導覽順序（⑤ 系統異常時畫面上會移到 ① 下方，導覽順序不跟著動，免得按鈕位置跳來跳去）。
export interface HomeSectionDef {
  id: string
  /** 導覽按鈕上的短名 */
  label: string
  icon: string
  /** 區塊卡片標題列的完整名稱（HomeCard） */
  title: string
}

export const HOME_SECTIONS: readonly HomeSectionDef[] = [
  { id: 'sec-today', label: '今天', icon: '☀️', title: '今天' },
  { id: 'sec-dims', label: '面向', icon: '🧭', title: '六個面向' },
  { id: 'sec-growth', label: '成長', icon: '🌱', title: '成長軌跡' },
  { id: 'sec-fun', label: '好玩的', icon: '🎲', title: '好玩的' },
  { id: 'sec-repos', label: '倉庫', icon: '📚', title: '倉庫索引' },
  { id: 'sec-sys', label: '系統', icon: '🖥️', title: '系統' },
  { id: 'sec-svc', label: '付費服務', icon: '💳', title: '付費服務' },
]

/** 目前高亮哪一個：視窗中可見的區塊裡，註冊表順序最前面的；都不可見時維持上一個。 */
export function activeSection(order: readonly string[], visible: ReadonlySet<string>, previous: string | null): string | null {
  for (const id of order) if (visible.has(id)) return id
  return previous
}

/** 依 id 取區塊定義；id 不在註冊表裡會丟錯（寫錯 id 在開發時就看得到，而不是導覽默默少一顆） */
export function sectionDef(id: string): HomeSectionDef {
  const d = HOME_SECTIONS.find((s) => s.id === id)
  if (!d) throw new Error(`首頁區塊 ${id} 不在 HOME_SECTIONS 註冊表裡`)
  return d
}
