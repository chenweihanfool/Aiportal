import { useEffect, useMemo, useRef, useState } from 'react'
import { COLOR } from './theme'
import { FOOD_STATUS_ICON, FOOD_STATUS_LABEL, coverPhoto, type FoodPlace, type FoodStatus } from './foodMap'

// ─────────────────────────────────────────────
// 🗺️ 美食／旅遊地圖的真底圖（MapLibre GL）。
// 底圖預設是 OpenFreeMap 的公開向量圖磚（不用金鑰、不用帳單）；要換成別的來源，
// 建置時設 VITE_FOOD_MAP_STYLE=<style.json 網址> 即可，元件不用改。
// 標記以「封面相片」為主：有相片的店顯示圓形縮圖＋狀態色外框，沒有相片的顯示狀態圖示。
// maplibre-gl 用動態 import：沒開美食地圖頁的人不會下載它；WebGL 不能用時呼叫 onFail，
// 由上層退回無底圖的 SVG 示意圖。
// ─────────────────────────────────────────────

export const BASEMAP_STYLE: string =
  (import.meta.env.VITE_FOOD_MAP_STYLE as string | undefined) || 'https://tiles.openfreemap.org/styles/liberty'

const STATUS_COLOR: Record<FoodStatus, string> = {
  want: COLOR.amber, visited: COLOR.ok, favorite: '#f06292', skip: COLOR.steelDim,
}

function markerEl(p: FoodPlace, on: boolean): HTMLButtonElement {
  const c = STATUS_COLOR[p.status]
  const photo = coverPhoto(p)
  const size = photo ? (on ? 58 : 44) : (on ? 34 : 26)
  const el = document.createElement('button')
  el.type = 'button'
  el.setAttribute('aria-label', `${p.name}（${FOOD_STATUS_LABEL[p.status]}）`)
  el.title = p.name
  Object.assign(el.style, {
    width: `${size}px`, height: `${size}px`, borderRadius: '50%', padding: '0', cursor: 'pointer',
    border: `3px solid ${c}`, boxShadow: on ? `0 0 0 3px ${c}55, 0 4px 14px rgba(0,0,0,.5)` : '0 2px 8px rgba(0,0,0,.45)',
    background: photo ? `#222 center / cover no-repeat url("${photo.replace(/"/g, '%22')}")` : COLOR.panelRaised,
    color: COLOR.ink, fontSize: photo ? '0' : '0.8rem', lineHeight: '1', opacity: p.status === 'skip' ? '0.65' : '1',
    transition: 'width .15s, height .15s',
  } as Partial<CSSStyleDeclaration>)
  if (!photo) el.textContent = FOOD_STATUS_ICON[p.status]
  return el
}

interface Props {
  places: FoodPlace[]
  selected: string | null
  onSelect: (id: string) => void
  onFail: () => void
}

// 只用到的 maplibre 型別面；避免在這裡 import 型別造成同步載入整包
interface GLMap {
  remove(): void
  fitBounds(b: [[number, number], [number, number]], o: Record<string, unknown>): void
  easeTo(o: Record<string, unknown>): void
  getZoom(): number
  addControl(c: unknown, pos?: string): void
  resize(): void
}
interface GLMarker { remove(): void; getElement(): HTMLElement }

export function FoodMapGL({ places, selected, onSelect, onFail }: Props) {
  const box = useRef<HTMLDivElement>(null)
  const mapRef = useRef<GLMap | null>(null)
  const libRef = useRef<{ Marker: new (o: { element: HTMLElement }) => GLMarker & { setLngLat(l: [number, number]): GLMarker & { addTo(m: GLMap): GLMarker } } } | null>(null)
  const markers = useRef<Map<string, GLMarker>>(new Map())
  const selectRef = useRef(onSelect)
  selectRef.current = onSelect
  const failRef = useRef(onFail)
  failRef.current = onFail
  const mapped = useMemo(() => places.filter(p => p.lat !== null && p.lng !== null), [places])
  const [ready, setReady] = useState(false)

  // 建立地圖（一次）
  useEffect(() => {
    let dead = false
    ;(async () => {
      try {
        const [lib] = await Promise.all([import('maplibre-gl'), import('maplibre-gl/dist/maplibre-gl.css')])
        if (dead || !box.current) return
        const ML = (lib as unknown as { default?: typeof lib }).default ?? lib
        const map = new ML.Map({
          container: box.current, style: BASEMAP_STYLE, center: [121.0, 24.2], zoom: 7, attributionControl: false, cooperativeGestures: true,
        }) as unknown as GLMap
        map.addControl(new ML.AttributionControl({ compact: true }), 'bottom-right')
        map.addControl(new ML.NavigationControl({ showCompass: false }), 'top-right')
        mapRef.current = map
        libRef.current = ML as unknown as typeof libRef.current
        setReady(true)
      } catch {
        if (!dead) failRef.current()
      }
    })()
    return () => {
      dead = true
      markers.current.forEach(m => m.remove())
      markers.current.clear()
      mapRef.current?.remove()
      mapRef.current = null
    }
  }, [])

  // 標記：places 或 selected 變動就重畫
  useEffect(() => {
    const map = mapRef.current
    const lib = libRef.current
    if (!map || !lib) return
    markers.current.forEach(m => m.remove())
    markers.current.clear()
    for (const p of mapped) {
      const on = p.id === selected
      const el = markerEl(p, on)
      el.style.zIndex = on ? '10' : '1'
      el.addEventListener('click', e => { e.stopPropagation(); selectRef.current(p.id) })
      const m = new lib.Marker({ element: el }).setLngLat([p.lng as number, p.lat as number]).addTo(map)
      markers.current.set(p.id, m)
    }
  }, [mapped, selected, ready])

  // 範圍：清單變動時框住所有點；選取時飛過去
  useEffect(() => {
    const map = mapRef.current
    if (!map || mapped.length === 0) return
    let w = 180, s = 90, e = -180, n = -90
    for (const p of mapped) {
      w = Math.min(w, p.lng as number); e = Math.max(e, p.lng as number)
      s = Math.min(s, p.lat as number); n = Math.max(n, p.lat as number)
    }
    map.fitBounds([[w, s], [e, n]], { padding: 60, maxZoom: 14, duration: 500 })
  }, [mapped, ready])

  useEffect(() => {
    const map = mapRef.current
    if (!map || !selected) return
    const p = mapped.find(x => x.id === selected)
    if (p) map.easeTo({ center: [p.lng as number, p.lat as number], zoom: Math.max(map.getZoom(), 13), duration: 450 })
  }, [selected, mapped])

  const unmapped = places.length - mapped.length
  return (
    <div className="fm-map" style={{ position: 'relative', border: `1px solid ${COLOR.line}`, borderRadius: 10, overflow: 'hidden', background: COLOR.panel }}>
      <div ref={box} style={{ position: 'absolute', inset: 0 }} role="region" aria-label="美食地圖" />
      {unmapped > 0 && (
        <div style={{ position: 'absolute', left: 10, bottom: 8, zIndex: 2, background: 'rgba(20,22,28,.85)', borderRadius: 6, padding: '3px 8px', fontSize: '0.64rem', color: COLOR.warn }}>
          {unmapped} 家還沒有座標（只在清單）
        </div>
      )}
    </div>
  )
}
