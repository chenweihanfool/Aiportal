// 主題模式（2.89.0）：'dark'｜'light'｜'system'（預設跟系統）。只記一個值在 localStorage（鍵 hm-theme）。
// dark／light 會把 document.documentElement.dataset.theme 設成該值；system 移除該屬性，交給 CSS 的 prefers-color-scheme。
// 純函式，store 與 root 注入以便測試。index.html 的 <head> 有一小段同邏輯的 inline script，渲染前先套用以免閃白。

export const THEME_KEY = 'hm-theme'
export type ThemeMode = 'dark' | 'light' | 'system'
export const THEME_MODES: readonly ThemeMode[] = ['dark', 'light', 'system'] as const
export const THEME_LABEL: Record<ThemeMode, string> = { dark: '深', light: '淺', system: '跟系統' }

export interface ThemeStore {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
}

export interface ThemeRoot {
  dataset: Record<string, string | undefined>
}

export function isThemeMode(v: unknown): v is ThemeMode {
  return v === 'dark' || v === 'light' || v === 'system'
}

/** 沒值、亂值、store 丟例外一律回 'system' */
export function readThemeMode(store: ThemeStore | null | undefined): ThemeMode {
  try {
    const v = store?.getItem(THEME_KEY)
    return isThemeMode(v) ? v : 'system'
  } catch {
    return 'system'
  }
}

/** 寫入；丟例外時不炸，回傳是否寫入成功 */
export function writeThemeMode(store: ThemeStore | null | undefined, mode: ThemeMode): boolean {
  try {
    if (!store) return false
    store.setItem(THEME_KEY, mode)
    return true
  } catch {
    return false
  }
}

/** 套用到 <html>：dark／light 設 data-theme，system 移除 */
export function applyThemeMode(root: ThemeRoot | null | undefined, mode: ThemeMode): void {
  if (!root) return
  if (mode === 'system') delete root.dataset.theme
  else root.dataset.theme = mode
}

/** 取瀏覽器的 localStorage；取用本身會丟例外時回 null */
export function browserThemeStore(): ThemeStore | null {
  try {
    return typeof window !== 'undefined' ? window.localStorage : null
  } catch {
    return null
  }
}
