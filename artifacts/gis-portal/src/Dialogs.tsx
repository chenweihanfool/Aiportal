// 管理後台（匯出資料）的對話框。2026-11-14 起密碼解鎖拿掉，只剩這一個對話框。
import { useState } from 'react'
import { CV, FONT } from './theme'
import { apiExportData } from './portalApi'

// 管理後台（2026-10-22 起只剩「匯出資料」：手動維護的工具連結拿掉了，入口改由 GitHub 倉庫索引取代）。
// 個人資料備份——HHI/心智/社交/生活從容歷史一鍵下載成 JSON，自架 DB 之外留一份可攜複本。
export function AdminPanel({ adminPassword, onClose }: { adminPassword: string; onClose: () => void }) {
  const [exporting, setExporting] = useState(false)
  const [apiError, setApiError] = useState('')

  const handleExport = async () => {
    setExporting(true)
    setApiError('')
    try {
      const blob = await apiExportData(adminPassword)
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `aiportal-export-${new Date().toISOString().slice(0, 10)}.json`
      document.body.appendChild(a)
      a.click()
      a.remove()
      URL.revokeObjectURL(url)
    } catch {
      setApiError('匯出失敗，請再試一次')
    } finally {
      setExporting(false)
    }
  }

  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 8888, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(10,11,14,0.9)' }}
      onClick={e => { if (e.target === e.currentTarget) onClose() }}>
      <div style={{ width: '420px', maxWidth: '95vw', background: CV.panel, border: `1px solid ${CV.line}`, borderRadius: '8px', padding: '1.8rem 2rem', color: CV.ink, fontFamily: FONT.body }}>
        <div style={{ fontFamily: FONT.mono, fontSize: '0.62rem', color: CV.amberDim, letterSpacing: '0.2em', textTransform: 'uppercase', marginBottom: '6px' }}>⚙ 管理後台</div>
        <div style={{ fontSize: '1.1rem', fontWeight: 600, marginBottom: '1.2rem' }}>資料匯出</div>
        <p style={{ margin: '0 0 1.2rem', fontSize: '0.78rem', lineHeight: 1.6, color: CV.steel }}>把幸福指數、心智、社交、生活從容的歷史下載成一個 JSON 檔，當作資料庫之外的備份。</p>
        {apiError && (
          <div style={{ marginBottom: '14px', padding: '0.6rem 0.8rem', background: 'color-mix(in srgb, var(--c-crit) 10%, transparent)', border: `1px solid ${CV.crit}`, borderRadius: '4px', fontSize: '0.72rem', color: CV.crit }}>{apiError}</div>
        )}
        <div style={{ display: 'flex', gap: '10px' }}>
          <button onClick={onClose} style={{ flex: 1, padding: '0.6rem', background: 'transparent', border: `1px solid ${CV.line}`, borderRadius: '5px', color: CV.steel, fontSize: '0.78rem', cursor: 'pointer', fontFamily: FONT.body }}>關閉</button>
          <button onClick={() => { void handleExport() }} disabled={exporting}
            style={{ flex: 2, padding: '0.6rem', background: 'color-mix(in srgb, var(--c-accent) 10%, transparent)', border: `1px solid ${CV.amberDim}`, borderRadius: '5px', color: CV.amber, fontSize: '0.78rem', fontWeight: 600, cursor: exporting ? 'default' : 'pointer', fontFamily: FONT.body, opacity: exporting ? 0.6 : 1 }}
          >{exporting ? '匯出中…' : '匯出資料 ⤓'}</button>
        </div>
      </div>
    </div>
  )
}
