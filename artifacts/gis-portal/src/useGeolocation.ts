import { useCallback, useEffect, useRef, useState } from 'react'
import { distanceM, type LatLng } from './foodMap'

// 📍 瀏覽器定位（只在使用者按下「附近」之後才會要權限；位置不送到任何伺服器）。
// 走路時 watchPosition 會一直回報，位置沒移動超過 15 公尺就不更新畫面，省電也避免清單一直跳。

export type GeoState = 'idle' | 'asking' | 'on' | 'denied' | 'unavailable' | 'error'
export interface Geo { state: GeoState; pos: LatLng | null; accuracyM: number | null; message: string | null; start: () => void; stop: () => void }

const MOVE_EPS_M = 15

export function useGeolocation(): Geo {
  const [state, setState] = useState<GeoState>('idle')
  const [pos, setPos] = useState<LatLng | null>(null)
  const [accuracyM, setAcc] = useState<number | null>(null)
  const [message, setMessage] = useState<string | null>(null)
  const watchId = useRef<number | null>(null)
  const last = useRef<LatLng | null>(null)

  const stop = useCallback(() => {
    if (watchId.current !== null && typeof navigator !== 'undefined') navigator.geolocation?.clearWatch(watchId.current)
    watchId.current = null
    last.current = null
    setState('idle'); setPos(null); setAcc(null); setMessage(null)
  }, [])

  const start = useCallback(() => {
    if (typeof navigator === 'undefined' || !navigator.geolocation) {
      setState('unavailable'); setMessage('這個瀏覽器不支援定位'); return
    }
    if (typeof window !== 'undefined' && window.isSecureContext === false) {
      setState('unavailable'); setMessage('定位只能在 https 網址使用'); return
    }
    if (watchId.current !== null) return
    setState('asking'); setMessage(null)
    watchId.current = navigator.geolocation.watchPosition(
      (g) => {
        const next = { lat: g.coords.latitude, lng: g.coords.longitude }
        if (!last.current || distanceM(last.current, next) >= MOVE_EPS_M) { last.current = next; setPos(next) }
        setAcc(Number.isFinite(g.coords.accuracy) ? Math.round(g.coords.accuracy) : null)
        setState('on'); setMessage(null)
      },
      (e) => {
        if (e.code === 1) { setState('denied'); setMessage('瀏覽器沒有允許定位：請在網站設定把「位置」改成允許，再按一次'); }
        else if (e.code === 2) { setState('error'); setMessage('目前抓不到位置（室內或訊號差），移到窗邊再試') }
        else { setState('error'); setMessage('定位逾時，請再按一次') }
        if (e.code === 1 && watchId.current !== null) { navigator.geolocation.clearWatch(watchId.current); watchId.current = null }
      },
      { enableHighAccuracy: true, maximumAge: 10_000, timeout: 20_000 },
    )
  }, [])

  useEffect(() => () => { if (watchId.current !== null) navigator.geolocation?.clearWatch(watchId.current) }, [])
  return { state, pos, accuracyM, message, start, stop }
}
