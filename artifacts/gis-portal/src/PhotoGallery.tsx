import { useEffect, useState } from 'react'
import type { FoodPhoto } from './foodMap'
import { COLOR, FONT } from './theme'

// ─────────────────────────────────────────────
// 相片牆＋燈箱（美食地圖與遊記共用）。原本在 FoodMapView.tsx 裡叫 Gallery，抽出來後行為不變。
// 點縮圖開燈箱；←／→ 換張、Esc 關閉（攔在捕捉階段，不會一起關掉外面的面板）。
// resetKey 換了（例如換一家店、換一個條目）就把燈箱收起來。
// ─────────────────────────────────────────────

export function PhotoGallery({ photos, label, resetKey }: { photos: FoodPhoto[]; label: string; resetKey: string }) {
  const [open, setOpen] = useState<number | null>(null)
  useEffect(() => { setOpen(null) }, [resetKey])
  useEffect(() => {
    if (open === null) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.stopImmediatePropagation(); setOpen(null) }
      else if (e.key === 'ArrowRight') setOpen(i => (i === null ? i : (i + 1) % photos.length))
      else if (e.key === 'ArrowLeft') setOpen(i => (i === null ? i : (i - 1 + photos.length) % photos.length))
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [open, photos.length])
  if (photos.length === 0) return null
  const cur = open !== null ? photos[open] : null
  return (
    <>
      <div className="fm-gallery" aria-label={`${label} 的相片`}>
        {photos.map((ph, i) => (
          <button key={ph.url} type="button" className="fm-thumb" onClick={() => setOpen(i)} aria-label={`放大第 ${i + 1} 張相片`}>
            <img src={ph.thumb ?? ph.url} alt={ph.caption ?? `${label} 相片 ${i + 1}`} loading="lazy" decoding="async" />
          </button>
        ))}
      </div>
      {cur && (
        <div className="fm-lightbox" role="dialog" aria-modal="true" aria-label="相片檢視" onClick={() => setOpen(null)}>
          <img src={cur.url} alt={cur.caption ?? label} onClick={e => e.stopPropagation()} />
          <div className="fm-lightbox-cap" onClick={e => e.stopPropagation()}>
            {cur.caption ?? label}{cur.takenAt ? ` · ${cur.takenAt}` : ''} · {open! + 1}/{photos.length}
            <button type="button" onClick={() => setOpen(null)} style={{ marginLeft: 12, fontFamily: FONT.mono, fontSize: '0.68rem', padding: '4px 10px', borderRadius: 999, cursor: 'pointer', color: COLOR.steel, background: 'transparent', border: `1px solid ${COLOR.steel}`, whiteSpace: 'nowrap' }}>關閉</button>
          </div>
        </div>
      )}
    </>
  )
}
