import { useEffect, useState } from 'react'
import { COLOR, FONT } from './theme'
import { apiFetchAttachment } from './attachmentApi'
import { attachmentKind } from './docContent'
import { pathBase } from './markdownLite'

// 附件預覽視窗：圖片直接顯示、PDF 用瀏覽器內建檢視器（行動裝置不支援內嵌時用「另開分頁」）、文字顯示前段。
// 純唯讀；其他類型（docx、xlsx…）不預覽，只說明原因。
const TEXT_LIMIT = 200_000

type State =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'image' | 'pdf'; url: string }
  | { status: 'text'; text: string; truncated: boolean }

export function AttachmentViewer({ password, path, onClose }: { password: string; path: string; onClose: () => void }) {
  const [state, setState] = useState<State>({ status: 'loading' })
  const kind = attachmentKind(path)

  useEffect(() => {
    if (kind === 'other') { setState({ status: 'error', message: '這種檔案類型不提供預覽（檔案仍在 vault 的附件資料夾）。' }); return }
    const ctl = new AbortController()
    let objectUrl: string | null = null
    setState({ status: 'loading' })
    apiFetchAttachment(password, path, ctl.signal).then(async res => {
      if (ctl.signal.aborted) return
      if (!res.ok) { setState({ status: 'error', message: res.message }); return }
      if (kind === 'text') {
        const full = await res.blob.text()
        if (!ctl.signal.aborted) setState({ status: 'text', text: full.slice(0, TEXT_LIMIT), truncated: full.length > TEXT_LIMIT })
        return
      }
      objectUrl = URL.createObjectURL(res.blob)
      setState({ status: kind, url: objectUrl })
    })
    return () => { ctl.abort(); if (objectUrl) URL.revokeObjectURL(objectUrl) }
  }, [password, path, kind])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const name = pathBase(path)
  return (
    <div role="dialog" aria-label={`附件預覽：${name}`} onClick={onClose}
      style={{ position: 'fixed', inset: 0, zIndex: 10000, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(10,11,14,0.88)', padding: '12px' }}>
      <div onClick={e => e.stopPropagation()} style={{
        display: 'flex', flexDirection: 'column', width: 'min(960px, 100%)', maxHeight: '100%', background: COLOR.panel,
        border: `1px solid ${COLOR.lineBright}`, borderRadius: 6, overflow: 'hidden',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px', padding: '8px 12px', borderBottom: `1px solid ${COLOR.line}` }}>
          <span title={path} style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: COLOR.ink, fontSize: '0.82rem' }}>📎 {name}</span>
          {state.status === 'pdf' && (
            <a href={state.url} target="_blank" rel="noopener noreferrer" style={{ color: COLOR.amber, fontSize: '0.74rem', fontFamily: FONT.mono }}>另開分頁</a>
          )}
          <button onClick={onClose} aria-label="關閉" style={{ background: 'none', border: `1px solid ${COLOR.line}`, color: COLOR.steel, borderRadius: 4, padding: '2px 10px', cursor: 'pointer' }}>關閉</button>
        </div>
        <div style={{ overflow: 'auto', minHeight: 0, flex: 1, padding: state.status === 'pdf' ? 0 : '12px' }}>
          {state.status === 'loading' && <div style={{ color: COLOR.steel, fontSize: '0.8rem' }}>載入附件中…</div>}
          {state.status === 'error' && <div style={{ color: COLOR.warn, fontSize: '0.8rem', lineHeight: 1.6 }}>{state.message}</div>}
          {state.status === 'image' && <img src={state.url} alt={name} style={{ display: 'block', maxWidth: '100%', maxHeight: '78vh', margin: '0 auto', objectFit: 'contain' }} />}
          {state.status === 'pdf' && <iframe src={state.url} title={name} style={{ display: 'block', width: '100%', height: '78vh', border: 0, background: '#fff' }} />}
          {state.status === 'text' && (
            <>
              <pre style={{ margin: 0, whiteSpace: 'pre-wrap', wordBreak: 'break-word', fontFamily: FONT.mono, fontSize: '0.76rem', lineHeight: 1.65, color: COLOR.steel }}>{state.text}</pre>
              {state.truncated && <div style={{ color: COLOR.warn, fontSize: '0.72rem', marginTop: '8px' }}>檔案過長，這裡只顯示前段。</div>}
            </>
          )}
        </div>
      </div>
    </div>
  )
}
