// 首頁頂欄搜尋列（3.10.0）：`/` 只在「不是打字情境」時攔下來聚焦搜尋框。
// 純函式，讓「哪些元素會吃掉 `/`」的判斷可以單獨測；OmniSearch 的 keydown 直接呼叫。

export type HotkeyTarget = { tagName?: string; isContentEditable?: boolean } | null

export interface SearchHotkeyEvent {
  key: string
  ctrlKey: boolean
  metaKey: boolean
  altKey: boolean
  /** 原生 KeyboardEvent 的 target（EventTarget）或測試用的簡化物件 */
  target: EventTarget | HotkeyTarget
}

const EDITABLE_TAGS = new Set(['input', 'textarea', 'select'])

/** 按 `/` 且目標不是輸入框／textarea／select／contenteditable、也沒有修飾鍵時，才攔截。 */
export function shouldFocusSearch(e: SearchHotkeyEvent): boolean {
  if (e.key !== '/') return false
  if (e.ctrlKey || e.metaKey || e.altKey) return false
  const t = e.target as HotkeyTarget
  const tag = (t?.tagName ?? '').toLowerCase()
  if (EDITABLE_TAGS.has(tag)) return false
  if (t?.isContentEditable === true) return false
  return true
}
