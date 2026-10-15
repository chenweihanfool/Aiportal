// 全站指令面板（⌘K／Ctrl+K）。
import { useEffect, useRef, useState } from 'react'
import { COLOR, FONT } from './theme'
import { type SiteData } from './portalApi'

// ─────────────────────────────────────────────
// 全站指令面板（⌘K / Ctrl+K）——工具連結原本的搜尋框只在展開「工具連結」
// 區塊時看得到、用得到，要先滾到那一區才能搜；這裡另外開一個任何時候都能
// 用快捷鍵叫出來的全域搜尋，搜的是同一份 `sites`（工具連結＋六維度裡有連
// 結的四個子系統本來就是同一份資料，不用另外處理），加一個永遠列在最前
// 面、可以直接跳關係宇宙的捷徑項目。關係宇宙頁面自己的人/事/案/物搜尋不
// 在這裡整合——那份資料只在進到 #graph 才會抓，這裡沒有必要為了指令面板
// 多發一次通常用不到的請求，改成 RelationshipUniverse.tsx 自己接
// ⌘K/Ctrl+K 去 focus 它既有的搜尋框（見該檔案）。
// ─────────────────────────────────────────────

export function CommandPalette({
  sites,
  unlocked,
  onSelect,
  onNavigateGraph,
}: {
  sites: SiteData[]
  unlocked: boolean
  onSelect: (site: SiteData) => void
  onNavigateGraph: () => void
}) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        setOpen(o => !o)
      } else if (e.key === 'Escape') {
        setOpen(false)
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [])

  useEffect(() => {
    if (!open) return
    setQuery('')
    const t = setTimeout(() => inputRef.current?.focus(), 0)
    return () => clearTimeout(t)
  }, [open])

  if (!open) return null

  const q = query.trim().toLowerCase()
  const matches = q.length === 0 ? sites : sites.filter(s => s.name.toLowerCase().includes(q) || s.subtitle.toLowerCase().includes(q))
  const graphKeywords = ['圖', '關係', '宇宙', 'graph']
  const showGraphShortcut = q.length === 0 || graphKeywords.some(k => k.toLowerCase().includes(q) || q.includes(k))
  const foodKeywords = ['美食', '吃', '餐廳', '地圖', '旅遊', '附近', 'food']
  const showFoodShortcut = q.length === 0 || foodKeywords.some(k => k.includes(q) || q.includes(k))
  const tripKeywords = ['遊記', '旅遊', '行程', 'trip']
  const showTripsShortcut = q.length === 0 || tripKeywords.some(k => k.includes(q) || q.includes(k))
  const legacyKeywords = ['舊版首頁', '舊首頁', '舊版', 'legacy']
  const showLegacyShortcut = q.length === 0 || legacyKeywords.some(k => k.includes(q) || q.includes(k))

  const rowStyle: React.CSSProperties = {
    display: 'flex', alignItems: 'center', gap: '10px', padding: '0.6rem 0.9rem',
    cursor: 'pointer', borderRadius: '5px',
  }

  return (
    <div
      style={{ position: 'fixed', inset: 0, zIndex: 10000, display: 'flex', justifyContent: 'center', paddingTop: '12vh', background: 'rgba(10,11,14,0.75)' }}
      onClick={e => { if (e.target === e.currentTarget) setOpen(false) }}
    >
      <div style={{
        width: 'min(560px, calc(100% - 2.4rem))', maxHeight: '64vh', display: 'flex', flexDirection: 'column',
        background: COLOR.panel, border: `1px solid ${COLOR.line}`, borderRadius: '8px', boxShadow: '0 20px 60px rgba(0,0,0,0.6)', overflow: 'hidden',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.7rem', padding: '0.8rem 1rem', borderBottom: `1px solid ${COLOR.line}`, flexShrink: 0 }}>
          <span style={{ color: COLOR.amber, fontFamily: FONT.mono, fontSize: '0.9rem' }}>⌘</span>
          <input
            ref={inputRef} value={query} onChange={e => setQuery(e.target.value)} autoComplete="off"
            placeholder="搜尋工具連結，或輸入「圖」跳到關係宇宙…"
            style={{ flex: 1, background: 'transparent', border: 'none', outline: 'none', color: COLOR.ink, fontFamily: FONT.body, fontSize: '0.9rem' }}
          />
          <span style={{ fontFamily: FONT.mono, fontSize: '0.6rem', color: COLOR.steelDim, flexShrink: 0 }}>ESC</span>
        </div>
        <div style={{ overflowY: 'auto', padding: '0.4rem' }}>
          {showGraphShortcut && (
            <div
              onClick={() => { onNavigateGraph(); setOpen(false) }}
              style={{ ...rowStyle, background: 'rgba(245,166,35,0.08)' }}
            >
              <span style={{ color: COLOR.amber }}>◈</span>
              <span style={{ color: COLOR.amber, fontSize: '0.82rem', flex: 1 }}>展開完整關係宇宙</span>
              <span style={{ color: COLOR.amberDim, fontFamily: FONT.mono, fontSize: '0.68rem' }}>→</span>
            </div>
          )}
          {showFoodShortcut && (
            <div
              onClick={() => { window.location.hash = 'food'; setOpen(false) }}
              style={{ ...rowStyle, background: 'rgba(245,166,35,0.05)' }}
            >
              <span style={{ color: COLOR.amber }}>🍜</span>
              <span style={{ color: COLOR.amber, fontSize: '0.82rem', flex: 1 }}>美食及旅遊地圖（原型・示範資料）</span>
              <span style={{ color: COLOR.amberDim, fontFamily: FONT.mono, fontSize: '0.68rem' }}>→</span>
            </div>
          )}
          {showTripsShortcut && (
            <div
              onClick={() => { window.location.hash = 'trips'; setOpen(false) }}
              style={{ ...rowStyle, background: 'rgba(245,166,35,0.05)' }}
            >
              <span style={{ color: COLOR.amber }}>📖</span>
              <span style={{ color: COLOR.amber, fontSize: '0.82rem', flex: 1 }}>遊記（每日紀錄・示範資料）</span>
              <span style={{ color: COLOR.amberDim, fontFamily: FONT.mono, fontSize: '0.68rem' }}>→</span>
            </div>
          )}
          {showLegacyShortcut && (
            <div
              onClick={() => { window.location.hash = 'legacy'; setOpen(false) }}
              style={{ ...rowStyle, background: 'rgba(245,166,35,0.05)' }}
            >
              <span style={{ color: COLOR.amber }}>🏠</span>
              <span style={{ color: COLOR.amber, fontSize: '0.82rem', flex: 1 }}>舊版首頁（退路）</span>
              <span style={{ color: COLOR.amberDim, fontFamily: FONT.mono, fontSize: '0.68rem' }}>→</span>
            </div>
          )}
          {matches.length === 0 ? (
            <div style={{ textAlign: 'center', color: COLOR.steelDim, fontSize: '0.75rem', padding: '1.5rem 0' }}>找不到符合「{query}」的工具</div>
          ) : matches.map(s => {
            const locked = s.isPrivate && !unlocked
            return (
              <div key={s.id} onClick={() => { onSelect(s); setOpen(false) }} style={rowStyle}>
                <span style={{ color: locked ? COLOR.warn : COLOR.steelDim, fontSize: '0.8rem', flexShrink: 0 }}>{locked ? '🔒' : '○'}</span>
                <span style={{ color: COLOR.ink, fontSize: '0.82rem', flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{s.name}</span>
                <span style={{ color: COLOR.steelDim, fontSize: '0.68rem', flexShrink: 0, maxWidth: '40%', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{s.subtitle}</span>
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}
