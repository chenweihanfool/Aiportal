// 解鎖、管理後台（匯出資料）的對話框。
import { useState } from 'react'
import { COLOR, FONT } from './theme'
import { UNLOCK_KEY, apiExportData, apiVerifyPassword } from './portalApi'

// ─────────────────────────────────────────────
// Password / Admin dialogs — same structure/logic as before, restyled to
// the instrument-panel palette.
// ─────────────────────────────────────────────
export function PasswordModal({
  pendingUrl,
  onSuccess,
  onCancel,
}: {
  pendingUrl: string
  onSuccess: (password: string) => void
  onCancel: () => void
}) {
  const [input, setInput] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setLoading(true)
    const token = await apiVerifyPassword(input)
    setLoading(false)
    if (token) {
      localStorage.setItem(UNLOCK_KEY, token)
      if (pendingUrl) window.open(pendingUrl, '_blank', 'noopener,noreferrer')
      onSuccess(token)
    } else {
      setError('密碼錯誤，請再試一次')
      setInput('')
    }
  }

  return (
    <div
      style={{ position: 'fixed', inset: 0, zIndex: 9999, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(10,11,14,0.82)' }}
      onClick={e => { if (e.target === e.currentTarget) onCancel() }}
    >
      <div style={{ background: COLOR.panel, border: `1px solid ${COLOR.line}`, borderRadius: '8px', padding: '2.2rem 2.4rem', width: '340px', color: COLOR.ink, fontFamily: FONT.body, boxShadow: '0 12px 40px rgba(0,0,0,0.5)' }}>
        <div style={{ fontFamily: FONT.mono, fontSize: '0.62rem', color: COLOR.amberDim, letterSpacing: '0.2em', textTransform: 'uppercase', marginBottom: '14px' }}>🔒 私領域網站</div>
        <div style={{ fontSize: '1.15rem', fontWeight: 600, marginBottom: '8px' }}>輸入密碼</div>
        <div style={{ fontSize: '0.75rem', color: COLOR.steelDim, marginBottom: '1.6rem', lineHeight: 1.6 }}>此為私領域網站，請輸入密碼以繼續。<br />本裝置驗證後將不再詢問。</div>
        <form onSubmit={e => { void handleSubmit(e) }}>
          <input
            type="password" value={input} autoFocus placeholder="••••••" disabled={loading}
            onChange={e => { setInput(e.target.value); setError('') }}
            style={{
              width: '100%', padding: '0.7rem 0.9rem', background: COLOR.panelDeep,
              border: `1px solid ${error ? COLOR.crit : COLOR.line}`, borderRadius: '5px', color: COLOR.ink,
              fontSize: '0.9rem', fontFamily: FONT.mono, outline: 'none', boxSizing: 'border-box', letterSpacing: '0.18em',
            }}
          />
          {error && <div style={{ fontSize: '0.72rem', color: COLOR.crit, marginTop: '8px' }}>{error}</div>}
          <div style={{ display: 'flex', gap: '10px', marginTop: '18px' }}>
            <button type="button" onClick={onCancel} style={{ flex: 1, padding: '0.65rem', background: 'transparent', border: `1px solid ${COLOR.line}`, borderRadius: '5px', color: COLOR.steel, fontSize: '0.78rem', cursor: 'pointer', fontFamily: FONT.body }}>取消</button>
            <button type="submit" disabled={loading} style={{ flex: 2, padding: '0.65rem', background: 'rgba(245,166,35,0.1)', border: `1px solid ${COLOR.amberDim}`, borderRadius: '5px', color: COLOR.amber, fontSize: '0.78rem', fontWeight: 600, cursor: 'pointer', fontFamily: FONT.body, opacity: loading ? 0.6 : 1 }}>
              {loading ? '驗證中…' : '確認進入'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

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
      <div style={{ width: '420px', maxWidth: '95vw', background: COLOR.panel, border: `1px solid ${COLOR.line}`, borderRadius: '8px', padding: '1.8rem 2rem', color: COLOR.ink, fontFamily: FONT.body }}>
        <div style={{ fontFamily: FONT.mono, fontSize: '0.62rem', color: COLOR.amberDim, letterSpacing: '0.2em', textTransform: 'uppercase', marginBottom: '6px' }}>⚙ 管理後台</div>
        <div style={{ fontSize: '1.1rem', fontWeight: 600, marginBottom: '1.2rem' }}>資料匯出</div>
        <p style={{ margin: '0 0 1.2rem', fontSize: '0.78rem', lineHeight: 1.6, color: COLOR.steel }}>把幸福指數、心智、社交、生活從容的歷史下載成一個 JSON 檔，當作資料庫之外的備份。</p>
        {apiError && (
          <div style={{ marginBottom: '14px', padding: '0.6rem 0.8rem', background: 'rgba(226,88,79,0.1)', border: `1px solid ${COLOR.crit}`, borderRadius: '4px', fontSize: '0.72rem', color: COLOR.crit }}>{apiError}</div>
        )}
        <div style={{ display: 'flex', gap: '10px' }}>
          <button onClick={onClose} style={{ flex: 1, padding: '0.6rem', background: 'transparent', border: `1px solid ${COLOR.line}`, borderRadius: '5px', color: COLOR.steel, fontSize: '0.78rem', cursor: 'pointer', fontFamily: FONT.body }}>關閉</button>
          <button onClick={() => { void handleExport() }} disabled={exporting}
            style={{ flex: 2, padding: '0.6rem', background: 'rgba(245,166,35,0.1)', border: `1px solid ${COLOR.amberDim}`, borderRadius: '5px', color: COLOR.amber, fontSize: '0.78rem', fontWeight: 600, cursor: exporting ? 'default' : 'pointer', fontFamily: FONT.body, opacity: exporting ? 0.6 : 1 }}
          >{exporting ? '匯出中…' : '匯出資料 ⤓'}</button>
        </div>
      </div>
    </div>
  )
}

export function AdminAuthModal({ onSuccess, onCancel }: { onSuccess: (pw: string) => void; onCancel: () => void }) {
  const [input, setInput] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setLoading(true)
    const token = await apiVerifyPassword(input)
    setLoading(false)
    if (token) {
      onSuccess(token)
    } else {
      setError('通行碼錯誤')
      setInput('')
    }
  }

  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 9000, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(10,11,14,0.82)' }}
      onClick={e => { if (e.target === e.currentTarget) onCancel() }}>
      <div style={{ background: COLOR.panel, border: `1px solid ${COLOR.line}`, borderRadius: '8px', padding: '2rem 2.2rem', width: '320px', color: COLOR.ink, fontFamily: FONT.body }}>
        <div style={{ fontFamily: FONT.mono, fontSize: '0.62rem', color: COLOR.amberDim, letterSpacing: '0.2em', textTransform: 'uppercase', marginBottom: '12px' }}>⚙ 管理後台</div>
        <div style={{ fontSize: '1rem', fontWeight: 600, marginBottom: '20px' }}>輸入通行碼</div>
        <form onSubmit={e => { void handleSubmit(e) }}>
          <input type="password" value={input} autoFocus placeholder="••••••••" disabled={loading}
            onChange={e => { setInput(e.target.value); setError('') }}
            style={{ width: '100%', padding: '0.6rem 0.8rem', background: COLOR.panelDeep, border: `1px solid ${error ? COLOR.crit : COLOR.line}`, borderRadius: '5px', color: COLOR.ink, fontSize: '0.85rem', fontFamily: FONT.mono, outline: 'none', boxSizing: 'border-box', letterSpacing: '0.18em' }} />
          {error && <div style={{ fontSize: '0.72rem', color: COLOR.crit, marginTop: '8px' }}>{error}</div>}
          <div style={{ display: 'flex', gap: '10px', marginTop: '16px' }}>
            <button type="button" onClick={onCancel} style={{ flex: 1, padding: '0.55rem', background: 'transparent', border: `1px solid ${COLOR.line}`, borderRadius: '5px', color: COLOR.steel, fontSize: '0.75rem', cursor: 'pointer', fontFamily: FONT.body }}>取消</button>
            <button type="submit" disabled={loading} style={{ flex: 2, padding: '0.55rem', background: 'rgba(245,166,35,0.1)', border: `1px solid ${COLOR.amberDim}`, borderRadius: '5px', color: COLOR.amber, fontSize: '0.75rem', fontWeight: 600, cursor: 'pointer', fontFamily: FONT.body, opacity: loading ? 0.6 : 1 }}>{loading ? '驗證中…' : '進入'}</button>
          </div>
        </form>
      </div>
    </div>
  )
}
