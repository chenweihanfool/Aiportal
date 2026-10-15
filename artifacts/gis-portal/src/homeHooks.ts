// 新首頁（HomeBoard）用的小 hook：非同步讀取、現在時間、數字跑動。
import { useCallback, useEffect, useRef, useState } from 'react'

export interface AsyncState<T> {
  data: T | null
  /** 最近一次請求失敗了（data 仍是上一次成功的值，若有的話） */
  error: boolean
  /** 第一次請求還沒回來 */
  loading: boolean
  /** 上一次成功的時間（ms） */
  loadedAt: number | null
  reload: () => void
}

/** pw 為 null（未解鎖）時不發請求；失敗時保留上一次的資料（§2.4 error：保留上一次的值） */
export function useAsync<T>(pw: string | null, fetcher: (pw: string) => Promise<T>): AsyncState<T> {
  const [data, setData] = useState<T | null>(null)
  const [error, setError] = useState(false)
  const [loadedAt, setLoadedAt] = useState<number | null>(null)
  const [tick, setTick] = useState(0)
  useEffect(() => {
    if (!pw) { setData(null); setError(false); setLoadedAt(null); return }
    let cancelled = false
    fetcher(pw)
      .then((d) => { if (!cancelled) { setData(d); setError(false); setLoadedAt(Date.now()) } })
      .catch(() => { if (!cancelled) setError(true) })
    return () => { cancelled = true }
  }, [pw, fetcher, tick])
  const reload = useCallback(() => setTick((t) => t + 1), [])
  return { data, error, loading: !!pw && data === null && !error, loadedAt, reload }
}

/** 每分鐘更新一次的現在時間（讓「n 小時前」會自己走） */
export function useNow(everyMs = 60_000): Date {
  const [now, setNow] = useState(() => new Date())
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), everyMs)
    return () => clearInterval(id)
  }, [everyMs])
  return now
}

export const prefersReducedMotion = (): boolean =>
  typeof window !== 'undefined' && !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches

/** 數字從 0 跑到目標值；使用者設定「減少動態」時直接顯示 */
export function useCountUp(target: number | null, ms = 800): number | null {
  const [v, setV] = useState<number | null>(target)
  const first = useRef(true)
  useEffect(() => {
    if (target === null) { setV(null); return }
    if (prefersReducedMotion()) { setV(target); return }
    const from = first.current ? 0 : (v ?? 0)
    first.current = false
    let raf = 0
    const t0 = performance.now()
    const step = (t: number) => {
      const k = Math.min(1, (t - t0) / ms)
      setV(Math.round(from + (target - from) * (1 - Math.pow(1 - k, 3))))
      if (k < 1) raf = requestAnimationFrame(step)
    }
    raf = requestAnimationFrame(step)
    return () => cancelAnimationFrame(raf)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [target, ms])
  return v
}
