import { describe, expect, it } from 'vitest'
import { aiFromOf, internalHashOf, makeNav, routeLabel, type NavEnv } from './navBack'

function fakeEnv(startHash = '') {
  const log: string[] = []
  const e = { hash: startHash, state: null as unknown, pushed: 0, replaced: 0, backs: 0, fired: 0 }
  const env: NavEnv = {
    getHash: () => e.hash,
    getState: () => e.state,
    replaceState: (s) => { e.state = s; e.replaced++ },
    pushState: (s, h) => { e.state = s; e.hash = h; e.pushed++; log.push(h) },
    back: () => { e.backs++ },
    fireHashChange: () => { e.fired++ },
    collect: () => ({ scroll: { home: 321 }, restore: { 'omni.q': '地籍' } }),
  }
  return { e, env }
}

describe('routeLabel', () => {
  it('各路由的名稱', () => {
    expect(routeLabel('')).toBe('首頁')
    expect(routeLabel('#')).toBe('首頁')
    expect(routeLabel('#dossier')).toBe('卷宗索引')
    expect(routeLabel('#dossier/case/' + encodeURIComponent('王小明 案'))).toBe('卷宗：王小明 案')
    expect(routeLabel('#knowledge')).toBe('知識')
    expect(routeLabel('#knowledge/abc')).toBe('知識：abc')
    expect(routeLabel('#knowledge/abc/s1', { topic: (id) => (id === 'abc' ? '測量流程' : undefined) })).toBe('知識：測量流程')
    expect(routeLabel('#insight/i1')).toBe('心得')
    expect(routeLabel('#graph/timeline')).toBe('時間軸')
    expect(routeLabel('#graph/timeline/day/2026-11-24')).toBe('時間軸 2026-11-24')
    expect(routeLabel('#year')).toBe('年度回顧')
    expect(routeLabel('#year/2025')).toBe('年度回顧')
    expect(routeLabel('#food')).toBe('美食地圖')
    expect(routeLabel('#food/nearby')).toBe('美食地圖')
    expect(routeLabel('#trips')).toBe('遊記')
    expect(routeLabel('#trips/t1')).toBe('遊記')
    expect(routeLabel('#architecture')).toBe('知識庫架構')
    expect(routeLabel('#whatever')).toBe('上一頁')
  })
  it('面向用 dimensions 的名稱，未知面向退回上一頁', () => {
    expect(routeLabel('#dim/nope')).toBe('上一頁')
    expect(routeLabel('#dim/mind')).not.toBe('上一頁')
  })
})

describe('goto / goBack', () => {
  it('目標等於目前 hash 不動作', () => {
    const { e, env } = fakeEnv('#dossier')
    const nav = makeNav(env)
    expect(nav.goto('dossier')).toBe(false)
    expect(nav.goto('#dossier')).toBe(false)
    expect(e.pushed).toBe(0)
    expect(e.fired).toBe(0)
  })
  it('首頁的 # 與空字串視為同一個', () => {
    const { e, env } = fakeEnv('')
    expect(makeNav(env).goto('#')).toBe(false)
    expect(e.pushed).toBe(0)
  })
  it('跳頁：先在目前這筆存 aiNav，再 push 帶 aiFrom，並觸發 hashchange', () => {
    const { e, env } = fakeEnv('#insight/i1')
    e.state = { keep: 1 }
    const nav = makeNav(env)
    expect(nav.goto('knowledge/t1')).toBe(true)
    expect(e.replaced).toBe(1)
    expect(e.pushed).toBe(1)
    expect(e.hash).toBe('#knowledge/t1')
    expect(aiFromOf(e.state)).toEqual({ hash: '#insight/i1', label: '心得' })
    expect(e.fired).toBe(1)
  })
  it('replace 的那筆保留原 state 並加上 aiNav', () => {
    const { e, env } = fakeEnv('')
    e.state = { aiFrom: { hash: '#x', label: 'X' } }
    let saved: unknown = null
    const env2: NavEnv = { ...env, replaceState: (s) => { saved = s }, pushState: () => {} }
    makeNav(env2).goto('#dossier')
    expect(saved).toEqual({ aiFrom: { hash: '#x', label: 'X' }, aiNav: { scroll: { home: 321 }, restore: { 'omni.q': '地籍' } } })
  })
  it('goBack：有 aiFrom 就 history.back()，沒有就跳 fallback', () => {
    const a = fakeEnv('#dossier')
    a.e.state = { aiFrom: { hash: '', label: '首頁' } }
    makeNav(a.env).goBack('')
    expect(a.e.backs).toBe(1)
    expect(a.e.pushed).toBe(0)
    const b = fakeEnv('#dossier')
    makeNav(b.env).goBack('')
    expect(b.e.backs).toBe(0)
    expect(b.e.pushed).toBe(1)
    expect(b.e.hash).toBe('')
  })
})

describe('internalHashOf', () => {
  const a = (href: string | null, target = '') => ({ getAttribute: () => href, target })
  const ev = (o: Partial<{ button: number; metaKey: boolean; ctrlKey: boolean; shiftKey: boolean; altKey: boolean; defaultPrevented: boolean }> = {}) =>
    ({ button: 0, metaKey: false, ctrlKey: false, shiftKey: false, altKey: false, defaultPrevented: false, ...o })
  it('站內 #hash 左鍵才攔', () => {
    expect(internalHashOf(a('#dossier'), ev())).toBe('#dossier')
    expect(internalHashOf(a('#dossier'), ev({ ctrlKey: true }))).toBeNull()
    expect(internalHashOf(a('#dossier'), ev({ button: 1 }))).toBeNull()
    expect(internalHashOf(a('#dossier'), ev({ defaultPrevented: true }))).toBeNull()
    expect(internalHashOf(a('#dossier', '_blank'), ev())).toBeNull()
    expect(internalHashOf(a('https://x.test/'), ev())).toBeNull()
    expect(internalHashOf(a('#'), ev())).toBeNull()
    expect(internalHashOf(a(null), ev())).toBeNull()
  })
})
