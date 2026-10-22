import { useEffect, useRef, useState } from 'react'
import { HOME_SECTIONS, activeSection } from './homeNav'

// 首頁左側錨點導覽（≥1300px 是左側直排、較窄時是頂部橫排；樣式在 portal.css 的 hm-nav）。
// 點了捲到該區塊；目前看到哪一區由 IntersectionObserver 判斷（不監聽 scroll 事件）。
export function HomeNav() {
  const [active, setActive] = useState<string | null>(HOME_SECTIONS[0]?.id ?? null)
  const visible = useRef(new Set<string>())

  useEffect(() => {
    if (typeof IntersectionObserver === 'undefined') return
    const order = HOME_SECTIONS.map((s) => s.id)
    // 只看視窗上緣到約 60% 的範圍：區塊的上半部進了這段才算「正在看」
    const io = new IntersectionObserver((entries) => {
      for (const e of entries) {
        if (e.isIntersecting) visible.current.add(e.target.id)
        else visible.current.delete(e.target.id)
      }
      setActive((prev) => activeSection(order, visible.current, prev))
    }, { rootMargin: '-8% 0px -40% 0px' })
    for (const id of order) {
      const el = document.getElementById(id)
      if (el) io.observe(el)
    }
    return () => io.disconnect()
  }, [])

  const go = (id: string) => {
    const el = document.getElementById(id)
    if (!el) return
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    el.scrollIntoView({ behavior: reduce ? 'auto' : 'smooth', block: 'start' })
    setActive(id)
  }

  return (
    <nav className="hm-nav" aria-label="首頁區塊">
      {HOME_SECTIONS.map((s) => (
        <button key={s.id} type="button" className="hm-nav-item" data-active={active === s.id ? 'true' : undefined}
          aria-current={active === s.id ? 'location' : undefined} onClick={() => go(s.id)}>
          <span aria-hidden>{s.icon}</span><span className="hm-nav-label">{s.label}</span>
        </button>
      ))}
    </nav>
  )
}
