// 首頁版面切換（2.88.0）：'v3'＝新版三塊（搜尋｜現在用得上｜STATUS），'classic'＝舊版首頁（九個區塊＋左側導覽）。
// 只記一個值在 localStorage；不記切換次數、不送任何 API。純函式，store 注入以便測試。

export const HOME_LAYOUT_KEY = 'hm-layout'
export type HomeLayout = 'v3' | 'classic'

/** 舊版首頁的下架日（頂欄開關旁的說明用） */
export const CLASSIC_REMOVAL_NOTE = '舊版首頁會在 2027-01-31 後移除'

export interface LayoutStore {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
}

/** 沒值、亂值、store 丟例外（私密模式、被封鎖）一律回 'v3' */
export function readHomeLayout(store: LayoutStore | null | undefined): HomeLayout {
  try {
    return store?.getItem(HOME_LAYOUT_KEY) === 'classic' ? 'classic' : 'v3'
  } catch {
    return 'v3'
  }
}

/** 寫入；丟例外時不炸，回傳是否寫入成功 */
export function writeHomeLayout(store: LayoutStore | null | undefined, v: HomeLayout): boolean {
  try {
    if (!store) return false
    store.setItem(HOME_LAYOUT_KEY, v)
    return true
  } catch {
    return false
  }
}

/** 取瀏覽器的 localStorage；取用本身會丟例外時回 null */
export function browserLayoutStore(): LayoutStore | null {
  try {
    return typeof window !== 'undefined' ? window.localStorage : null
  } catch {
    return null
  }
}
