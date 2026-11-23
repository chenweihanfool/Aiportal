// 目的頁左上角的「‹ 回到 <來源>」：有來源（history.state.aiFrom）就顯示，按了＝history.back()；沒有就顯示 fallback（原本的「← 首頁」之類）。
import { useEffect, useState, type ReactNode } from 'react'
import { aiFromOf, type AiFrom } from './navBack'

const read = (): AiFrom | null => { try { return aiFromOf(window.history.state) } catch { return null } }

export function useAiFrom(): AiFrom | null {
  const [from, setFrom] = useState<AiFrom | null>(read)
  useEffect(() => {
    const f = () => setFrom(read())
    f()
    window.addEventListener('hashchange', f)
    window.addEventListener('popstate', f)
    return () => { window.removeEventListener('hashchange', f); window.removeEventListener('popstate', f) }
  }, [])
  return from
}

export function BackToOrigin({ fallback = null, className }: { fallback?: ReactNode; className?: string }) {
  const from = useAiFrom()
  if (!from) return <>{fallback}</>
  return (
    <button type="button" className={`nav-back${className ? ' ' + className : ''}`} data-testid="back-origin"
      onClick={() => window.history.back()} aria-label={`回到${from.label}`}>‹ 回到 {from.label}</button>
  )
}
