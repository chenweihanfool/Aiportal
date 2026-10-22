// 頁首的版本按鈕（點開版本歷程對話框）。
import { useCallback, useState } from 'react'
import { VersionHistoryDialog } from './VersionHistoryDialog'
import { COLOR, FONT } from './theme'
import { VERSION_HISTORY } from './versionHistory'

// 2.53.0：頂欄壓成單列，按鈕高度與帳號、⚙ 對齊（不再 marginTop）。
// Trigger lives in the header's right-hand block (see InstrumentPanelView) —
// the header had empty room and this used to be a cramped bottom-left
// popover (300px wide, 60vh scroll, small type) that was awkward to read.
// The panel itself is now a proper centered modal, sized for actually
// reading changelogs rather than squinting at a corner popover.
// 2026-10-09：內容改成 pf-cwh 那種時間軸（左版號日期、右標題可折疊，見 VersionHistoryDialog.tsx）。
export function VersionHistory() {
  const [expanded, setExpanded] = useState(false)
  const closeHistory = useCallback(() => setExpanded(false), [])
  const latest = VERSION_HISTORY[0]!
  return (
    <>
      <button type="button" className="tb-ver" onClick={() => setExpanded(true)} title="版本歷程" style={{
        display: 'inline-flex', alignItems: 'center', gap: '6px', background: COLOR.panel, border: `1px solid ${COLOR.line}`, borderRadius: '5px',
        padding: '0.3rem 0.6rem', cursor: 'pointer', fontFamily: FONT.mono, fontSize: '0.64rem', color: COLOR.steel, whiteSpace: 'nowrap', lineHeight: 1.2,
      }}>
        <span style={{ color: COLOR.amber, fontWeight: 600 }}>v{latest.version}</span>
        <span style={{ color: COLOR.steelDim }}>版本歷程 ▸</span>
      </button>
      {expanded && <VersionHistoryDialog entries={VERSION_HISTORY} onClose={closeHistory} />}
    </>
  )
}
