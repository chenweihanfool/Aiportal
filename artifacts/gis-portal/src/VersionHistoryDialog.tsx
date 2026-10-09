import { useEffect, useRef, useState } from 'react'
import { COLOR, FONT } from './theme'
import { CHANGE_TYPE_LABEL, changeType, filterVersions, type ChangeType, type VersionEntry } from './versionHistoryView'

// 版本歷程：時間軸版面（左＝版號與日期、中＝節點、右＝一行標題，點開看完整內容），照 pf-cwh 的「更新歷程」做，
// 配色改用入口網的儀表板色。上方可搜尋、依類型篩選、全部展開／收合。
const TYPE_COLOR: Record<ChangeType, string> = { major: '#c08cf0', minor: COLOR.amber, patch: COLOR.steelDim }

export function VersionHistoryDialog({ entries, onClose }: { entries: VersionEntry[]; onClose: () => void }) {
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set(entries[0] ? [entries[0].version] : []))
  const [query, setQuery] = useState('')
  const [type, setType] = useState<ChangeType | 'all'>('all')
  const searchRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    const prev = document.activeElement as HTMLElement | null
    searchRef.current?.focus()
    const onKey = (ev: KeyboardEvent) => { if (ev.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => { window.removeEventListener('keydown', onKey); prev?.focus?.() }
  }, [onClose])

  const list = filterVersions(entries, query, type)
  const allOpen = list.length > 0 && list.every(v => expanded.has(v.version))
  const toggle = (v: string) => setExpanded(prev => {
    const next = new Set(prev)
    if (next.has(v)) next.delete(v)
    else next.add(v)
    return next
  })

  return (
    <div className="vh-backdrop" onMouseDown={ev => { if (ev.target === ev.currentTarget) onClose() }}>
      <div className="vh-dialog" role="dialog" aria-modal="true" aria-label="版本歷程">
        <header className="vh-head">
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, flexWrap: 'wrap' }}>
            <span className="vh-dot" aria-hidden />
            <h2 style={{ margin: 0, fontFamily: FONT.display, fontSize: '1.1rem', color: COLOR.ink }}>版本歷程</h2>
            <span style={{ fontSize: '0.78rem', color: COLOR.steelDim }}>共 {entries.length} 版，目前 <b style={{ fontFamily: FONT.mono, color: COLOR.amber }}>v{entries[0]?.version}</b></span>
            <button type="button" className="vh-close" onClick={onClose} aria-label="關閉">✕</button>
          </div>
          <div className="vh-tools">
            <input ref={searchRef} value={query} onChange={ev => setQuery(ev.target.value)} placeholder="搜尋版本、日期、標題或內容…" className="vh-search" aria-label="搜尋版本歷程" />
            <div className="vh-seg" role="group" aria-label="依類型篩選">
              {(['all', 'major', 'minor', 'patch'] as const).map(t => (
                <button key={t} type="button" className={type === t ? 'is-on' : ''} onClick={() => setType(t)}>
                  {t === 'all' ? '全部' : CHANGE_TYPE_LABEL[t]}
                </button>
              ))}
            </div>
            <button type="button" className="vh-all" onClick={() => setExpanded(allOpen ? new Set() : new Set(list.map(v => v.version)))}>
              {allOpen ? '全部收合' : '全部展開'}
            </button>
          </div>
        </header>

        <div className="vh-body">
          {list.length === 0 ? <div style={{ padding: '4rem 0', textAlign: 'center', color: COLOR.steelDim, fontSize: '0.85rem' }}>沒有符合的版本紀錄</div> : (
            <ol className="vh-list">
              {list.map((v, i) => {
                const t = changeType(v.version)
                const open = expanded.has(v.version)
                const first = i === 0, last = i === list.length - 1
                return (
                  <li key={v.version} className="vh-row">
                    {/* 左：版號與日期 */}
                    <div className="vh-left">
                      <div className="vh-ver">v{v.version}</div>
                      <div className="vh-date">{v.date}</div>
                    </div>
                    {/* 中：時間軸線與節點 */}
                    <div className="vh-axis">
                      {!(first && last) && <span className="vh-line" style={{ top: first ? 15 : 0, ...(last ? { height: 15 } : { bottom: 0 }) }} />}
                      <span className="vh-node" style={{ background: TYPE_COLOR[t], boxShadow: `0 0 0 4px ${TYPE_COLOR[t]}33` }} />
                    </div>
                    {/* 右：標題一行，點開看完整內容 */}
                    <div className="vh-right">
                      <button type="button" className={`vh-title${open ? ' is-open' : ''}`} onClick={() => toggle(v.version)} aria-expanded={open}>
                        <span className="vh-badge" style={{ color: TYPE_COLOR[t], borderColor: TYPE_COLOR[t], background: `${TYPE_COLOR[t]}1f` }}>{CHANGE_TYPE_LABEL[t]}</span>
                        <span className="vh-summary">{v.summary}</span>
                        <span className="vh-chev" aria-hidden>▾</span>
                      </button>
                      {open && (
                        <ul className="vh-changes">
                          {v.changes.map((c, ci) => <li key={ci}>{c}</li>)}
                        </ul>
                      )}
                    </div>
                  </li>
                )
              })}
            </ol>
          )}
        </div>
      </div>
    </div>
  )
}
