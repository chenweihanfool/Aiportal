import { createContext, useContext, useEffect, useRef, useState, type ImgHTMLAttributes } from 'react'

// ─────────────────────────────────────────────
// 帶憑證的圖片。入口網自己的相片（網址 `/api/media/…`，後端 routes/hermesMedia.ts）要登入後才給，
// 而 <img src> 帶不了 x-admin-password，所以用 fetch 取成 Blob 再轉 object URL（同 AttachmentViewer 的作法）。
// Google 登入者靠 cookie（同源 fetch 自動帶），解鎖碼則放在 MediaAuthContext。
// 不是 `/api/` 開頭的網址（外部 https 圖、示範用 data: 圖）照一般 <img> 走，不經 fetch。
// 捲到附近才抓（IntersectionObserver，提早 300px）：遊記一天可能有幾十張，不要一打開就全抓。
// ─────────────────────────────────────────────

const API_BASE = import.meta.env.BASE_URL ?? '/'
// 載入中／失敗時的 1×1 透明圖：保持 <img> 的版面，底色由 CSS 負責
const BLANK = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7'

/** 解鎖碼；Google 登入者留空（cookie 負責） */
export const MediaAuthContext = createContext<string>('')

export const isProtectedMediaUrl = (u: string) => u.startsWith('/api/')

/** `/api/media/…/x.webp` → 同資料夾的縮圖 `x-t.webp`；不是這種網址就原樣回傳（卡片封面用縮圖就夠，不必載 1600px） */
export function thumbOf(u: string): string {
  return /^\/api\/media\/.+\.webp$/.test(u) && !u.endsWith('-t.webp') ? u.replace(/\.webp$/, '-t.webp') : u
}

type Props = Omit<ImgHTMLAttributes<HTMLImageElement>, 'src'> & { src: string; fallbackSrc?: string }

export function AuthImage({ src, fallbackSrc, alt = '', ...rest }: Props) {
  const pw = useContext(MediaAuthContext)
  const protectedUrl = isProtectedMediaUrl(src)
  const ref = useRef<HTMLImageElement>(null)
  const [near, setNear] = useState(!protectedUrl || typeof IntersectionObserver === 'undefined')
  const [blobUrl, setBlobUrl] = useState<string | null>(null)
  const [tryFallback, setTryFallback] = useState(false)
  const [failed, setFailed] = useState(false)
  const effective = tryFallback && fallbackSrc ? fallbackSrc : src

  useEffect(() => { setTryFallback(false); setFailed(false); setBlobUrl(null) }, [src])

  useEffect(() => {
    if (near || !protectedUrl) return
    const el = ref.current
    if (!el) return
    const io = new IntersectionObserver(es => { if (es.some(e => e.isIntersecting)) { setNear(true); io.disconnect() } }, { rootMargin: '300px' })
    io.observe(el)
    return () => io.disconnect()
  }, [near, protectedUrl, src])

  const fetchUrl = isProtectedMediaUrl(effective)
  useEffect(() => {
    if (!near || !fetchUrl) return
    const ctl = new AbortController()
    let objectUrl: string | null = null
    ;(async () => {
      try {
        const r = await fetch(`${API_BASE}${effective.slice(1)}`, { headers: pw ? { 'x-admin-password': pw } : {}, signal: ctl.signal })
        if (!r.ok) throw new Error(String(r.status))
        objectUrl = URL.createObjectURL(await r.blob())
        setBlobUrl(objectUrl)
      } catch {
        if (ctl.signal.aborted) return
        if (fallbackSrc && !tryFallback) setTryFallback(true)
        else setFailed(true)
      }
    })()
    return () => { ctl.abort(); if (objectUrl) URL.revokeObjectURL(objectUrl) }
  }, [near, fetchUrl, effective, pw, fallbackSrc, tryFallback])

  const shown = fetchUrl ? (blobUrl ?? BLANK) : effective
  return (
    <img ref={ref} src={shown} alt={alt} data-media-state={fetchUrl ? (failed ? 'failed' : blobUrl ? 'ready' : 'loading') : 'plain'}
      onError={fetchUrl ? undefined : () => { if (fallbackSrc && !tryFallback) setTryFallback(true) }} {...rest} />
  )
}
