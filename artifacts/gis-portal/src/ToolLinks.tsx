// 左側欄／頁面下方的工具連結區與美食及旅遊地圖入口。
import { useState } from 'react'
import { COLOR, FONT } from './theme'
import { SubLabel, Unit } from './panelUi'
import { type SiteData } from './portalApi'
import { useIsDesktop } from './useMedia'

// ─────────────────────────────────────────────
// 工具連結 — private plain-link sites (no dashboard summary) merged with all
// public sites into one searchable, collapsible control panel.
// ─────────────────────────────────────────────

function SwitchTile({ site, unlocked, onSelect, showSubtitle = false }: { site: SiteData; unlocked: boolean; onSelect: (site: SiteData) => void; showSubtitle?: boolean }) {
  const isLocked = site.isPrivate && !unlocked
  return (
    <div
      onClick={() => onSelect(site)}
      style={{
        position: 'relative', background: COLOR.panelRaised, border: `1px solid ${COLOR.line}`, borderRadius: '5px',
        padding: '0.8rem 0.9rem', display: 'flex', alignItems: 'center', gap: '0.6rem', cursor: 'pointer',
      }}
    >
      <span style={{
        width: '24px', height: '13px', borderRadius: '7px', background: COLOR.panelDeep, border: `1px solid ${COLOR.lineBright}`,
        position: 'relative', flexShrink: 0,
      }}>
        <span style={{
          position: 'absolute', top: '1px', width: '9px', height: '9px', borderRadius: '50%',
          background: isLocked ? COLOR.steelDim : (site.isPrivate ? COLOR.amber : COLOR.ok),
          boxShadow: isLocked ? 'none' : `0 0 5px ${site.isPrivate ? COLOR.amber : COLOR.ok}`,
          left: isLocked ? '1px' : '10px', transition: 'left 0.15s',
        }} />
      </span>
      <span style={{ fontFamily: FONT.mono, fontSize: '0.76rem', color: COLOR.ink, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
        {isLocked && '🔒 '}{site.name}
      </span>
      {showSubtitle && site.subtitle && (
        <span style={{ marginLeft: 'auto', paddingLeft: '0.5rem', fontSize: '0.66rem', color: COLOR.steelDim, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flexShrink: 100, minWidth: 0 }}>
          {site.subtitle}
        </span>
      )}
    </div>
  )
}

// 首頁入口：美食及旅遊地圖（#food）。之前只有 ⌘K 能進，手機沒有這個鍵，首頁上看不到。
export function FoodMapPill() {
  return (
    <a
      href="#food"
      className="fm-entry-pill"
      data-testid="food-entry-pill"
      onClick={e => { e.preventDefault(); window.location.hash = 'food' }}
      style={{
        display: 'inline-flex', alignItems: 'center', gap: '0.4rem', textDecoration: 'none', cursor: 'pointer',
        padding: '0.35rem 0.8rem', borderRadius: '999px', fontSize: '0.78rem', fontWeight: 700,
        background: 'rgba(245,166,35,0.14)', border: `1px solid ${COLOR.amberDim}`, color: COLOR.amber, whiteSpace: 'nowrap',
      }}
    >🍜🧭 美食及旅遊地圖 →</a>
  )
}

export function FoodMapEntry() {
  return (
    <a
      href="#food"
      data-testid="food-entry"
      onClick={e => { e.preventDefault(); window.location.hash = 'food' }}
      style={{
        display: 'flex', alignItems: 'center', gap: '0.9rem', textDecoration: 'none', cursor: 'pointer',
        padding: '0.85rem 1rem', marginBottom: '1.1rem', borderRadius: '8px',
        background: 'linear-gradient(135deg, rgba(245,166,35,0.14), rgba(47,128,255,0.10))',
        border: `1px solid ${COLOR.amberDim}`, color: COLOR.ink,
      }}
    >
      <span aria-hidden style={{ fontSize: '1.15rem', lineHeight: 1, letterSpacing: '-0.1em' }}>🍜🧭</span>
      <span style={{ display: 'flex', flexDirection: 'column', gap: '0.2rem', minWidth: 0, flex: 1 }}>
        <b style={{ fontSize: '0.92rem', color: COLOR.amber, whiteSpace: 'nowrap' }}>美食及旅遊地圖</b>
        <span style={{ fontSize: '0.72rem', color: COLOR.steel, lineHeight: 1.5 }}>想吃、想去的地方都在這 · 📍 找附近由近到遠</span>
      </span>
      <span aria-hidden style={{ color: COLOR.amber, fontSize: '1.1rem' }}>→</span>
    </a>
  )
}

export function ToolLinksZone({
  privateSites,
  publicSites,
  unlocked,
  onSelect,
}: {
  privateSites: SiteData[]
  publicSites: SiteData[]
  unlocked: boolean
  onSelect: (site: SiteData) => void
}) {
  const desktop = useIsDesktop()
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const q = query.trim().toLowerCase()
  const searchActive = q.length > 0
  const matches = (s: SiteData) => !searchActive || s.name.toLowerCase().includes(q) || s.subtitle.toLowerCase().includes(q)
  const filteredPrivate = privateSites.filter(matches)
  const filteredPublic = publicSites.filter(matches)
  const total = privateSites.length + publicSites.length
  const totalMatched = filteredPrivate.length + filteredPublic.length
  const isOpen = desktop || open || searchActive

  return (
    <Unit title="工具連結 · Control Panel" className="ip-tools">
      {!desktop && <div
        onClick={() => setOpen(o => !o)}
        style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer', marginBottom: '1rem', marginTop: '-0.4rem' }}
      >
        <span style={{ display: 'inline-block', transition: 'transform 0.2s ease', transform: isOpen ? 'rotate(90deg)' : 'rotate(0deg)', color: COLOR.amberDim, fontSize: '0.8rem' }}>▶</span>
        <span style={{ fontSize: '0.78rem', color: COLOR.steel }}>{isOpen ? '收起連結列表' : '展開連結列表'}</span>
        <span style={{ fontFamily: FONT.mono, fontSize: '0.68rem', color: COLOR.steelDim }}>{searchActive ? `${totalMatched} / ${total}` : `${total} 個`}</span>
      </div>}

      <div style={{ display: 'flex', alignItems: 'center', gap: '0.7rem', background: COLOR.panelDeep, border: `1px solid ${COLOR.line}`, borderRadius: '4px', padding: '0.55rem 0.9rem', marginBottom: '1.1rem' }}>
        <span style={{ color: COLOR.amber, fontFamily: FONT.mono, fontSize: '0.85rem' }}>◎</span>
        <input
          type="text" value={query} onChange={e => setQuery(e.target.value)} placeholder="搜尋工具名稱…" autoComplete="off"
          style={{ flex: 1, background: 'transparent', border: 'none', outline: 'none', color: COLOR.amber, fontFamily: FONT.mono, fontSize: '0.9rem' }}
        />
      </div>

      {isOpen && (
        <>
          {filteredPrivate.length > 0 && (
            <div style={{ marginBottom: '1.1rem' }}>
              <SubLabel>私領域</SubLabel>
              <div className="ip-switch-grid" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))', gap: '0.7rem' }}>
                {filteredPrivate.map(s => <SwitchTile key={s.id} site={s} unlocked={unlocked} onSelect={onSelect} showSubtitle={desktop} />)}
              </div>
            </div>
          )}
          {filteredPublic.length > 0 && (
            <div>
              <SubLabel>公領域</SubLabel>
              <div className="ip-switch-grid" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))', gap: '0.7rem' }}>
                {filteredPublic.map(s => <SwitchTile key={s.id} site={s} unlocked={unlocked} onSelect={onSelect} showSubtitle={desktop} />)}
              </div>
            </div>
          )}
          {searchActive && totalMatched === 0 && (
            <div style={{ textAlign: 'center', color: COLOR.steelDim, fontSize: '0.75rem', padding: '1.5rem 0' }}>找不到符合「{query}」的工具</div>
          )}
          {!searchActive && total === 0 && (
            <div style={{ textAlign: 'center', color: COLOR.steelDim, fontSize: '0.75rem', padding: '1.5rem 0' }}>No Data</div>
          )}
        </>
      )}
    </Unit>
  )
}
