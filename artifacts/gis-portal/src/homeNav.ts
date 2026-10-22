// 首頁區塊註冊表：錨點導覽、捲動定位都由這張表產生。新增區塊 = 在這裡加一筆，再讓該區塊的 <section> 帶上同一個 id。
// 順序＝導覽順序（⑤ 系統異常時畫面上會移到 ① 下方，導覽順序不跟著動，免得按鈕位置跳來跳去）。
export interface HomeSectionDef {
  id: string
  label: string
  icon: string
}

export const HOME_SECTIONS: readonly HomeSectionDef[] = [
  { id: 'sec-today', label: '今天', icon: '☀️' },
  { id: 'sec-dims', label: '面向', icon: '🧭' },
  { id: 'sec-growth', label: '成長', icon: '🌱' },
  { id: 'sec-fun', label: '好玩的', icon: '🎲' },
  { id: 'sec-repos', label: '倉庫', icon: '📚' },
  { id: 'sec-sys', label: '系統', icon: '🖥️' },
  { id: 'sec-svc', label: '付費服務', icon: '💳' },
]

/** 目前高亮哪一個：視窗中可見的區塊裡，註冊表順序最前面的；都不可見時維持上一個。 */
export function activeSection(order: readonly string[], visible: ReadonlySet<string>, previous: string | null): string | null {
  for (const id of order) if (visible.has(id)) return id
  return previous
}
