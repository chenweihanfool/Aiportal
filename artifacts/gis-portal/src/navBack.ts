// 全站「回到原頁」（3.27.0）：站內跳頁都走 goto()，跳之前把目前這筆歷史補上捲動位置與登記過的狀態，
// 新那筆帶 aiFrom（來源 hash＋名稱）。目的頁的「‹ 回到 <來源>」＝history.back()，和瀏覽器上一頁是同一件事。
// 純邏輯（routeLabel、makeNav）可在沒有 DOM 的環境測；React／DOM 包裝在下半部。
import { useEffect, useRef, useState } from 'react'
import { dimensionOf } from './dimensions'

export interface AiFrom { hash: string; label: string }
export interface AiNavState { scroll?: Record<string, number>; restore?: Record<string, unknown> }
export interface NavNames { topic?: (id: string) => string | undefined; insight?: (id: string) => string | undefined }

const dec = (s: string): string => { try { return decodeURIComponent(s) } catch { return s } }

/** hash（含或不含 #）→ 使用者看得懂的頁名，給「‹ 回到 …」用 */
export function routeLabel(hash: string, names: NavNames = {}): string {
  let h = hash.startsWith('#') ? hash : '#' + hash
  const qi = h.indexOf('?')
  if (qi >= 0) h = h.slice(0, qi)
  if (h === '#' || h === '') return '首頁'
  if (h === '#dossier') return '卷宗索引'
  if (h.startsWith('#dossier/')) {
    const parts = h.slice('#dossier/'.length).split('/')
    if (parts.length >= 2 && parts[1]) return `卷宗：${dec(parts.slice(1).join('/'))}`
    return '卷宗索引'
  }
  if (h === '#knowledge') return '知識'
  if (h.startsWith('#knowledge/')) {
    const id = dec(h.slice('#knowledge/'.length).split('/')[0] ?? '')
    return `知識：${names.topic?.(id) ?? id}`
  }
  if (h === '#insight' || h.startsWith('#insight/')) return '心得'
  if (h.startsWith('#dim/')) {
    const d = dimensionOf(h.slice('#dim/'.length))
    return d ? d.label : '上一頁'
  }
  if (h === '#graph/timeline') return '時間軸'
  const tm = /^#graph\/timeline\/day\/([^/]+)$/.exec(h)
  if (tm) return `時間軸 ${dec(tm[1]!)}`
  if (h === '#year' || h.startsWith('#year/')) return '年度回顧'
  if (h === '#food' || h.startsWith('#food/')) return '美食地圖'
  if (h === '#trips' || h.startsWith('#trips/')) return '遊記'
  if (h === '#architecture') return '知識庫架構'
  return '上一頁'
}

const normHash = (h: string): string => (h === '' || h === '#' ? '' : h.startsWith('#') ? h : '#' + h)
const sameHash = (a: string, b: string): boolean => normHash(a) === normHash(b)

// ── 登記表（只有目前掛著的元件會登記；goto 時收集） ──
const scrollGetters = new Map<string, () => number | null>()
const stateGetters = new Map<string, () => unknown>()

export function collectNavState(): AiNavState {
  const scroll: Record<string, number> = {}
  scrollGetters.forEach((get, key) => { const v = get(); if (v !== null && Number.isFinite(v)) scroll[key] = v })
  const restore: Record<string, unknown> = {}
  stateGetters.forEach((get, key) => { restore[key] = get() })
  return { scroll, restore }
}

export interface NavEnv {
  getHash(): string
  getState(): unknown
  replaceState(state: unknown): void
  pushState(state: unknown, hash: string): void
  back(): void
  fireHashChange(): void
  collect(): AiNavState
}

const asObj = (s: unknown): Record<string, unknown> => (s && typeof s === 'object' ? (s as Record<string, unknown>) : {})

/** 把環境（location／history）抽成介面，方便用假物件測 */
export function makeNav(env: NavEnv, names?: () => NavNames) {
  const current = (): string => normHash(env.getHash())
  function goto(hash: string): boolean {
    const target = normHash(hash)
    const cur = current()
    if (target === cur) return false
    try { env.replaceState({ ...asObj(env.getState()), aiNav: env.collect() }) } catch { /* 存不進去就只少了還原 */ }
    const from: AiFrom = { hash: cur, label: routeLabel(cur, names?.()) }
    try { env.pushState({ aiFrom: from }, target) } catch { return false }
    env.fireHashChange()
    return true
  }
  function goBack(fallbackHash: string): void {
    if (aiFromOf(env.getState())) env.back()
    else goto(fallbackHash)
  }
  return { goto, goBack }
}

export function aiFromOf(state: unknown): AiFrom | null {
  const f = asObj(state).aiFrom
  if (f && typeof f === 'object' && typeof (f as AiFrom).hash === 'string' && typeof (f as AiFrom).label === 'string') return f as AiFrom
  return null
}

let customNames: () => NavNames = () => ({})
/** 讓有資料的元件（知識頁、心得）提供題名；沒登記就用 id */
export function setNavNames(fn: () => NavNames): void { customNames = fn }

const domEnv: NavEnv = {
  getHash: () => window.location.hash,
  getState: () => window.history.state,
  replaceState: (s) => window.history.replaceState(s, ''),
  pushState: (s, h) => window.history.pushState(s, '', h === '' ? window.location.pathname + window.location.search : h),
  back: () => window.history.back(),
  fireHashChange: () => window.dispatchEvent(new HashChangeEvent('hashchange')),
  collect: () => {
    const st = collectNavState()
    return st
  },
}
const dom = makeNav(domEnv, () => customNames())

/** 站內跳頁：hash 可含或不含 # */
export const goto = (hash: string): boolean => dom.goto(hash)
/** 有來源就 history.back()，否則跳 fallback（通常 ''＝首頁） */
export const goBack = (fallbackHash = ''): void => dom.goBack(fallbackHash)

/** 只改網址選取（不新增歷史）時用：保留 history.state，免得丟掉 aiFrom／aiNav */
export function replaceHashKeepState(hash: string): void {
  try { window.history.replaceState(window.history.state, '', hash) } catch { /* 取不到 history 就維持原網址 */ }
}

/** 是不是「純左鍵、無修飾鍵、站內 #hash」的連結點擊；回 hash 或 null（純函式，給攔截器與測試用） */
export function internalHashOf(a: { getAttribute(n: string): string | null; target?: string; hasAttribute?(n: string): boolean }, e: { button: number; metaKey: boolean; ctrlKey: boolean; shiftKey: boolean; altKey: boolean; defaultPrevented: boolean }): string | null {
  if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return null
  if (a.target && a.target !== '' && a.target !== '_self') return null
  if (a.hasAttribute?.('download')) return null
  const href = a.getAttribute('href')
  if (href === null || !href.startsWith('#') || href === '#') return null
  return href
}

/** 全域攔截站內 <a href="#…">，改走 goto()；回傳解除函式 */
export function installLinkInterceptor(): () => void {
  const onClick = (ev: MouseEvent) => {
    const t = ev.target as Element | null
    const a = t?.closest?.('a') as HTMLAnchorElement | null
    if (!a) return
    const hash = internalHashOf(a, ev)
    if (hash === null) return
    ev.preventDefault()
    if (hash === '#') { goto(''); return }
    goto(hash)
  }
  document.addEventListener('click', onClick, true)
  return () => document.removeEventListener('click', onClick, true)
}

// ── 還原 ──
const savedNav = (): AiNavState => asObj(asObj(window.history.state).aiNav) as AiNavState

/** 等內容夠高才捲回去（rAF 重試，約 90 幀） */
function restoreScrollTo(getEl: () => HTMLElement | null, top: number, cancelled: () => boolean): void {
  let frames = 0
  const step = () => {
    if (cancelled()) return
    const el = getEl()
    if (el) {
      el.scrollTop = top
      if (Math.abs(el.scrollTop - top) < 2) return
    } else if (top === 0) return
    if (++frames < 90) requestAnimationFrame(step)
  }
  step()
}

/** 視窗本身的捲動（key window）：路由切換時呼叫 */
export function restoreWindowScroll(): void {
  let top: number | undefined
  try { top = savedNav().scroll?.window } catch { top = undefined }
  if (typeof top !== 'number') return
  let frames = 0
  const step = () => {
    window.scrollTo(0, top!)
    if (Math.abs(window.scrollY - top!) >= 2 && ++frames < 90) requestAnimationFrame(step)
  }
  step()
}

/** 登記視窗捲動位置（App 掛一次） */
export function useWindowScrollRegistration(): void {
  useEffect(() => {
    scrollGetters.set('window', () => window.scrollY)
    return () => { scrollGetters.delete('window') }
  }, [])
}

/** 登記一個捲動容器：掛上時登記，從 history.state 還原；getEl 回傳要記錄的元素 */
export function useScrollRestore(key: string, getEl: () => HTMLElement | null): void {
  const ref = useRef(getEl)
  ref.current = getEl
  useEffect(() => {
    scrollGetters.set(key, () => ref.current()?.scrollTop ?? null)
    let dead = false
    let top: number | undefined
    try { top = savedNav().scroll?.[key] } catch { top = undefined }
    if (typeof top === 'number' && top > 0) restoreScrollTo(() => ref.current(), top, () => dead)
    return () => { dead = true; scrollGetters.delete(key) }
  }, [key])
}

/** 像 useState，但初值優先讀 history.state 裡存的還原值，並登記給 goto 收集 */
export function useRestorable<T>(key: string, initial: T): [T, (v: T | ((p: T) => T)) => void] {
  const [v, setV] = useState<T>(() => {
    try {
      const r = savedNav().restore
      if (r && Object.prototype.hasOwnProperty.call(r, key)) return r[key] as T
    } catch { /* 取不到就用預設 */ }
    return initial
  })
  const latest = useRef(v)
  latest.current = v
  useEffect(() => {
    stateGetters.set(key, () => latest.current)
    return () => { stateGetters.delete(key) }
  }, [key])
  return [v, setV]
}
