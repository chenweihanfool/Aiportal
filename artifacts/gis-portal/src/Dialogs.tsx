// 解鎖、管理後台的對話框。
import { useState } from 'react'
import { COLOR, FONT } from './theme'
import { UNLOCK_KEY, apiExportData, apiVerifyPassword, type SiteData, type SiteLink } from './portalApi'

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

const inputSt: React.CSSProperties = {
  padding: '0.55rem 0.7rem', background: COLOR.panelDeep, border: `1px solid ${COLOR.line}`, borderRadius: '4px',
  color: COLOR.ink, fontSize: '0.8rem', fontFamily: FONT.body, outline: 'none', boxSizing: 'border-box', width: '100%',
}

function FormField({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ marginBottom: '14px' }}>
      <div style={{ fontSize: '0.68rem', color: COLOR.steelDim, letterSpacing: '0.08em', marginBottom: '6px' }}>{label}</div>
      {children}
    </div>
  )
}

const BLANK_FORM = (): Omit<SiteData, 'id' | 'worldXZ'> => ({
  name: '', subtitle: '', links: [{ label: '進入系統', url: '' }], isPrivate: false, subsystemId: null,
})

interface AdminPanelProps {
  sites: SiteData[]
  adminPassword: string
  onAdd: (data: Omit<SiteData, 'id'>) => Promise<void>
  onEdit: (id: string, data: Partial<Omit<SiteData, 'id'>>) => Promise<void>
  onDelete: (id: string) => Promise<void>
  onClose: () => void
}

export function AdminPanel({ sites, adminPassword, onAdd, onEdit, onDelete, onClose }: AdminPanelProps) {
  const [editing, setEditing] = useState<SiteData | null>(null)
  const [adding, setAdding] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null)
  const [form, setForm] = useState(BLANK_FORM())
  const [busy, setBusy] = useState(false)
  const [apiError, setApiError] = useState('')
  const [exporting, setExporting] = useState(false)

  // 個人資料備份——HHI/心智/社交/生活從容歷史 + 工具連結清單一鍵下載成
  // JSON，自架 DB 之外留一份可攜複本。放在管理後台而不是隨處可見的按
  // 鈕，因為這是維護性質的動作，跟站點 CRUD 同一個心智模型。
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

  const openEdit = (s: SiteData) => {
    setEditing(s); setAdding(false); setApiError('')
    setForm({ name: s.name, subtitle: s.subtitle, links: s.links.map(l => ({ ...l })), isPrivate: s.isPrivate, subsystemId: s.subsystemId })
  }
  const openAdd = () => {
    setAdding(true); setEditing(null); setApiError('')
    setForm(BLANK_FORM())
  }
  const closeForm = () => { setEditing(null); setAdding(false); setApiError('') }

  const handleDelete = async (id: string) => {
    setBusy(true)
    try {
      await onDelete(id)
      setConfirmDelete(null)
      if (editing?.id === id) closeForm()
    } catch {
      setApiError('刪除失敗，請再試一次')
    } finally {
      setBusy(false)
    }
  }

  const handleSave = async () => {
    const links = form.links.filter(l => l.url.trim())
    if (!form.name.trim() || links.length === 0) return
    setBusy(true)
    setApiError('')
    try {
      const subsystemId = form.subsystemId?.trim() || null
      if (adding) {
        // worldXZ used to place a landmark in the (now removed) 3D city view
        // — no visual meaning left, but portal_sites still has the column,
        // so a constant placeholder satisfies the schema without carrying
        // over the old position-pool logic.
        await onAdd({ name: form.name.trim(), subtitle: form.subtitle.trim(), links, worldXZ: [0, 0], isPrivate: form.isPrivate, subsystemId })
      } else if (editing) {
        await onEdit(editing.id, { name: form.name.trim(), subtitle: form.subtitle.trim(), links, isPrivate: form.isPrivate, subsystemId })
      }
      closeForm()
    } catch {
      setApiError('儲存失敗，請再試一次')
    } finally {
      setBusy(false)
    }
  }

  const setLink = (idx: number, field: keyof SiteLink, val: string) =>
    setForm(f => { const links = f.links.map((l, i) => i === idx ? { ...l, [field]: val } : l); return { ...f, links } })

  const addLink = () => setForm(f => ({ ...f, links: [...f.links, { label: '', url: '' }] }))
  const removeLink = (idx: number) => setForm(f => ({ ...f, links: f.links.filter((_, i) => i !== idx) }))

  const showForm = adding || editing !== null

  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 8888, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(10,11,14,0.9)' }}>
      <div style={{ width: '680px', maxWidth: '95vw', maxHeight: '88vh', overflowY: 'auto', background: COLOR.panel, border: `1px solid ${COLOR.line}`, borderRadius: '8px', padding: '1.8rem 2rem', color: COLOR.ink, fontFamily: FONT.body }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '1.6rem' }}>
          <div>
            <div style={{ fontFamily: FONT.mono, fontSize: '0.62rem', color: COLOR.amberDim, letterSpacing: '0.2em', textTransform: 'uppercase', marginBottom: '6px' }}>⚙ 管理後台</div>
            <div style={{ fontSize: '1.1rem', fontWeight: 600 }}>網站管理</div>
          </div>
          <div style={{ display: 'flex', gap: '8px' }}>
            <button
              onClick={() => { void handleExport() }} disabled={exporting}
              style={{ background: 'transparent', border: `1px solid ${COLOR.amberDim}`, borderRadius: '4px', color: COLOR.amber, padding: '0.4rem 1rem', cursor: exporting ? 'default' : 'pointer', fontSize: '0.78rem', fontFamily: FONT.body, opacity: exporting ? 0.6 : 1 }}
            >{exporting ? '匯出中…' : '匯出資料 ⤓'}</button>
            <button onClick={onClose} style={{ background: 'transparent', border: `1px solid ${COLOR.line}`, borderRadius: '4px', color: COLOR.steel, padding: '0.4rem 1rem', cursor: 'pointer', fontSize: '0.78rem', fontFamily: FONT.body }}>關閉</button>
          </div>
        </div>

        {apiError && (
          <div style={{ marginBottom: '14px', padding: '0.6rem 0.8rem', background: 'rgba(226,88,79,0.1)', border: `1px solid ${COLOR.crit}`, borderRadius: '4px', fontSize: '0.72rem', color: COLOR.crit }}>{apiError}</div>
        )}

        <div style={{ display: 'flex', gap: '12px', marginBottom: '16px' }}>
          <div style={{ fontSize: '0.68rem', color: COLOR.steel, display: 'flex', alignItems: 'center', gap: '6px' }}>
            <span style={{ width: '8px', height: '8px', borderRadius: '50%', background: COLOR.ok, display: 'inline-block' }} /> 公領域
          </div>
          <div style={{ fontSize: '0.68rem', color: COLOR.amberDim, display: 'flex', alignItems: 'center', gap: '6px' }}>
            <span style={{ width: '8px', height: '8px', borderRadius: '50%', background: COLOR.amber, display: 'inline-block' }} /> 私領域
          </div>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', marginBottom: '16px' }}>
          {sites.map(s => (
            <div key={s.id}>
              <div style={{
                display: 'flex', alignItems: 'center', gap: '12px', padding: '0.7rem 1rem',
                background: editing?.id === s.id ? COLOR.panelRaised2 : COLOR.panelRaised,
                border: `1px solid ${editing?.id === s.id ? COLOR.lineBright : COLOR.line}`,
                borderRadius: confirmDelete === s.id ? '5px 5px 0 0' : '5px',
              }}>
                <span style={{
                  fontSize: '0.62rem', padding: '2px 7px', borderRadius: '3px', whiteSpace: 'nowrap',
                  background: s.isPrivate ? 'rgba(245,166,35,0.12)' : 'rgba(95,191,122,0.12)',
                  color: s.isPrivate ? COLOR.amber : COLOR.ok,
                  border: `1px solid ${s.isPrivate ? COLOR.amberDim : COLOR.ok}`,
                }}>{s.isPrivate ? '私' : '公'}</span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: '0.85rem', fontWeight: 500, color: COLOR.ink, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{s.name}</div>
                  <div style={{ fontFamily: FONT.mono, fontSize: '0.66rem', color: COLOR.steelDim, marginTop: '2px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{s.links[0]?.url}</div>
                </div>
                <button onClick={() => openEdit(s)} disabled={busy} style={{ padding: '0.35rem 0.7rem', background: 'rgba(154,164,182,0.08)', border: `1px solid ${COLOR.line}`, borderRadius: '4px', color: COLOR.steel, fontSize: '0.7rem', cursor: 'pointer', fontFamily: FONT.body, whiteSpace: 'nowrap' }}>編輯</button>
                <button onClick={() => setConfirmDelete(confirmDelete === s.id ? null : s.id)} disabled={busy} style={{ padding: '0.35rem 0.7rem', background: 'rgba(226,88,79,0.08)', border: `1px solid ${COLOR.crit}`, borderRadius: '4px', color: COLOR.crit, fontSize: '0.7rem', cursor: 'pointer', fontFamily: FONT.body, whiteSpace: 'nowrap' }}>刪除</button>
              </div>
              {confirmDelete === s.id && (
                <div style={{ display: 'flex', alignItems: 'center', gap: '10px', padding: '0.6rem 1rem', background: 'rgba(226,88,79,0.06)', border: `1px solid ${COLOR.crit}`, borderTop: 'none', borderRadius: '0 0 5px 5px' }}>
                  <span style={{ flex: 1, fontSize: '0.72rem', color: COLOR.crit }}>確定刪除「{s.name}」？</span>
                  <button onClick={() => setConfirmDelete(null)} style={{ padding: '0.3rem 0.7rem', background: 'transparent', border: `1px solid ${COLOR.line}`, borderRadius: '4px', color: COLOR.steel, fontSize: '0.7rem', cursor: 'pointer', fontFamily: FONT.body }}>取消</button>
                  <button onClick={() => { void handleDelete(s.id) }} disabled={busy} style={{ padding: '0.3rem 0.7rem', background: 'rgba(226,88,79,0.16)', border: `1px solid ${COLOR.crit}`, borderRadius: '4px', color: COLOR.crit, fontSize: '0.7rem', fontWeight: 600, cursor: 'pointer', fontFamily: FONT.body }}>確定刪除</button>
                </div>
              )}
            </div>
          ))}
        </div>

        {!showForm && (
          <button onClick={openAdd} disabled={busy} style={{ width: '100%', padding: '0.65rem', background: 'rgba(95,191,122,0.06)', border: `1px dashed ${COLOR.ok}`, borderRadius: '5px', color: COLOR.ok, fontSize: '0.78rem', cursor: 'pointer', fontFamily: FONT.body, letterSpacing: '0.06em' }}>＋ 新增網站</button>
        )}

        {showForm && (
          <div style={{ marginTop: '12px', padding: '1.3rem 1.4rem', background: COLOR.panelRaised, border: `1px solid ${COLOR.line}`, borderRadius: '5px' }}>
            <div style={{ fontSize: '0.78rem', fontWeight: 600, color: COLOR.ink, marginBottom: '1.1rem' }}>{adding ? '新增網站' : '編輯網站'}</div>

            <FormField label="名稱"><input value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} placeholder="系統名稱" style={inputSt} /></FormField>
            <FormField label="副標題（選填）"><input value={form.subtitle} onChange={e => setForm(f => ({ ...f, subtitle: e.target.value }))} placeholder="English subtitle" style={inputSt} /></FormField>

            <FormField label="領域設定">
              <div style={{ display: 'flex', gap: '8px' }}>
                {([false, true] as const).map(priv => (
                  <button key={String(priv)} onClick={() => setForm(f => ({ ...f, isPrivate: priv }))}
                    style={{
                      padding: '0.4rem 1rem',
                      background: form.isPrivate === priv ? (priv ? 'rgba(245,166,35,0.14)' : 'rgba(95,191,122,0.12)') : COLOR.panelDeep,
                      border: `1px solid ${form.isPrivate === priv ? (priv ? COLOR.amber : COLOR.ok) : COLOR.line}`,
                      borderRadius: '4px',
                      color: form.isPrivate === priv ? (priv ? COLOR.amber : COLOR.ok) : COLOR.steelDim,
                      fontSize: '0.72rem', cursor: 'pointer', fontFamily: FONT.body,
                    }}>
                    {priv ? '🔒 私領域' : '🌐 公領域'}
                  </button>
                ))}
              </div>
            </FormField>

            <FormField label="儀表板摘要來源 ID（選填）">
              <input value={form.subsystemId ?? ''} onChange={e => setForm(f => ({ ...f, subsystemId: e.target.value }))} placeholder="例如 pf-cwh，留空則顯示為一般連結卡" style={inputSt} />
            </FormField>

            <div style={{ marginBottom: '14px' }}>
              <div style={{ fontSize: '0.68rem', color: COLOR.steelDim, letterSpacing: '0.08em', marginBottom: '8px' }}>連結</div>
              {form.links.map((link, idx) => (
                <div key={idx} style={{ display: 'flex', gap: '8px', marginBottom: '8px' }}>
                  <input value={link.label} onChange={e => setLink(idx, 'label', e.target.value)} placeholder="按鈕文字" style={{ ...inputSt, width: '100px', flex: '0 0 100px' }} />
                  <input value={link.url} onChange={e => setLink(idx, 'url', e.target.value)} placeholder="https://..." style={{ ...inputSt, flex: 1 }} />
                  {form.links.length > 1 && (
                    <button onClick={() => removeLink(idx)} style={{ background: 'none', border: `1px solid ${COLOR.crit}`, borderRadius: '4px', color: COLOR.crit, padding: '0 10px', cursor: 'pointer', fontSize: '1rem', fontFamily: FONT.body, flexShrink: 0 }}>×</button>
                  )}
                </div>
              ))}
              {form.links.length < 3 && (
                <button onClick={addLink} style={{ fontSize: '0.68rem', color: COLOR.steel, background: 'none', border: 'none', cursor: 'pointer', padding: '2px 0', fontFamily: FONT.body, letterSpacing: '0.04em' }}>＋ 新增連結</button>
              )}
            </div>

            <div style={{ display: 'flex', gap: '10px', marginTop: '20px' }}>
              <button onClick={closeForm} disabled={busy} style={{ flex: 1, padding: '0.6rem', background: 'transparent', border: `1px solid ${COLOR.line}`, borderRadius: '5px', color: COLOR.steel, fontSize: '0.78rem', cursor: 'pointer', fontFamily: FONT.body }}>取消</button>
              <button onClick={() => { void handleSave() }} disabled={busy} style={{ flex: 2, padding: '0.6rem', background: 'rgba(95,191,122,0.1)', border: `1px solid ${COLOR.ok}`, borderRadius: '5px', color: COLOR.ok, fontSize: '0.78rem', fontWeight: 600, cursor: 'pointer', fontFamily: FONT.body, opacity: busy ? 0.6 : 1 }}>{busy ? '儲存中…' : '儲存'}</button>
            </div>
          </div>
        )}
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
