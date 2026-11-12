import { createContext, useContext, useEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type ReactNode } from 'react'
import { claimState, isStuck, loadPending, MAX_CORRECTION_CHARS, overlay, postCorrection, savePending, settle, type ClaimOverlay, type CorrectionBody, type PendingItem, type PendingStore } from './knowledgeCorrections'
import { matchClaims, SECTION_LABEL, type Bullet, type BulletSection, type ParsedBody, type Topic, type TopicClaim } from './knowledgeView'

// 知識頁句子更正（2.85.0）：每條句子的「⋯」選單（不對／改寫／撤回）、「＋ 補一句」、送出後的蓋章／劃線／等待生效提示。
// 純函式在 knowledgeCorrections.ts 與 knowledgeView.ts；樣式在 portal.css 的 kn-ca-*。

export interface ClaimsCtl {
  now: Date
  byBid: ReadonlyMap<string, TopicClaim>
  overlay: ClaimOverlay
  /** 送出一筆更正；成功回 null，失敗回錯誤訊息（不進佇列） */
  send: (body: Omit<CorrectionBody, 'topicId'>) => Promise<string | null>
  /** 只清本機佇列，不送任何請求 */
  dismiss: (id: number) => void
}

const ClaimsContext = createContext<ClaimsCtl | null>(null)
export const ClaimsProvider = ClaimsContext.Provider
export const useClaims = (): ClaimsCtl | null => useContext(ClaimsContext)

function browserStore(): PendingStore | null {
  try {
    return window.localStorage
  } catch {
    return null
  }
}

/** 沒有帳本（t.claims 未定義）或沒解鎖時回 null：不顯示任何更正按鈕 */
export function useClaimsController(pw: string, t: Topic, parsed: ParsedBody | null, topics: readonly Topic[], now: Date): ClaimsCtl | null {
  const [pending, setPending] = useState<PendingItem[]>(() => loadPending(browserStore()))
  // feed 帶回 appliedCorrections 後自動移除
  useEffect(() => {
    setPending((prev) => {
      const next = settle(prev, topics)
      return next.length === prev.length ? prev : next
    })
  }, [topics])
  useEffect(() => { savePending(browserStore(), pending) }, [pending])
  const claims = t.claims
  const byBid = useMemo(() => (parsed && claims ? matchClaims(parsed, claims) : new Map<string, TopicClaim>()), [parsed, claims])
  const mine = useMemo(() => pending.filter((p) => p.topicId === t.id), [pending, t.id])
  const ov = useMemo(() => overlay(claims ?? [], mine), [claims, mine])
  if (!pw || !claims) return null
  const send: ClaimsCtl['send'] = async (body) => {
    try {
      const r = await postCorrection(pw, { topicId: t.id, ...body })
      const item: PendingItem = { id: r.id, topicId: t.id, claimId: body.claimId ?? null, kind: body.kind, section: body.section ?? null, text: body.text ?? null, at: Date.now() }
      setPending((prev) => [...prev, item])
      return null
    } catch (e) {
      return e instanceof Error && e.message ? e.message : '送出失敗，稍後再試'
    }
  }
  const dismiss = (id: number) => setPending((prev) => prev.filter((p) => p.id !== id))
  return { now, byBid, overlay: ov, send, dismiss }
}

/* ───────── 小元件 ───────── */

const charCount = (s: string): number => [...s].length

function ClaimEditor({ initial, label, submitLabel, onSubmit, onCancel }: {
  initial: string; label: string; submitLabel: string; onSubmit: (text: string) => Promise<string | null>; onCancel: () => void
}) {
  const [text, setText] = useState(initial)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const ref = useRef<HTMLInputElement>(null)
  useEffect(() => { ref.current?.focus() }, [])
  const trimmed = text.trim()
  const n = charCount(trimmed)
  const tooLong = n > MAX_CORRECTION_CHARS
  const canSend = !busy && n > 0 && !tooLong
  const submit = async () => {
    if (!canSend) return
    setBusy(true)
    const err = await onSubmit(trimmed)
    setBusy(false)
    if (err) setError(err)
  }
  const onKey = (e: ReactKeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' && !e.nativeEvent.isComposing) { e.preventDefault(); void submit() }
    else if (e.key === 'Escape') { e.preventDefault(); onCancel() }
  }
  return (
    <div className="kn-ca-editor">
      <input ref={ref} type="text" className="kn-ca-input" value={text} aria-label={label} aria-invalid={tooLong} onChange={(e) => setText(e.target.value.replace(/[\r\n]+/g, ' '))} onKeyDown={onKey} />
      <div className="kn-ca-editor-row">
        <span className="kn-ca-count" data-over={tooLong}>{n}／{MAX_CORRECTION_CHARS}</span>
        <button type="button" className="kn-btn kn-ca-small" disabled={!canSend} onClick={() => void submit()}>{busy ? '送出中…' : submitLabel}</button>
        <button type="button" className="kn-btn kn-ca-small kn-ca-small--quiet" onClick={onCancel}>取消</button>
      </div>
      {error && <p className="kn-ca-error" role="alert">{error}</p>}
    </div>
  )
}

function ClaimMenu({ label, canWrong, canUndo, disabled, onWrong, onFix, onUndo }: {
  label: string; canWrong: boolean; canUndo: boolean; disabled: boolean; onWrong: () => void; onFix: () => void; onUndo: () => void
}) {
  const [open, setOpen] = useState(false)
  const wrap = useRef<HTMLSpanElement>(null)
  const btn = useRef<HTMLButtonElement>(null)
  useEffect(() => {
    if (!open) return
    const items = wrap.current?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')
    items?.[0]?.focus()
    const down = (e: MouseEvent) => { if (wrap.current && !wrap.current.contains(e.target as Node)) setOpen(false) }
    document.addEventListener('mousedown', down)
    return () => document.removeEventListener('mousedown', down)
  }, [open])
  const close = (refocus: boolean) => { setOpen(false); if (refocus) btn.current?.focus() }
  const onKey = (e: ReactKeyboardEvent<HTMLElement>) => {
    if (e.key === 'Escape') { e.preventDefault(); close(true); return }
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return
    const items = [...(wrap.current?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]') ?? [])]
    if (items.length === 0) return
    e.preventDefault()
    const i = items.indexOf(document.activeElement as HTMLButtonElement)
    const next = e.key === 'ArrowDown' ? (i + 1) % items.length : (i - 1 + items.length) % items.length
    items[next]?.focus()
  }
  const pick = (fn: () => void) => () => { close(false); fn() }
  return (
    <span className="kn-ca-menu" ref={wrap} onKeyDown={onKey} onBlur={(e) => { if (open && !wrap.current?.contains(e.relatedTarget as Node | null)) setOpen(false) }}>
      <button ref={btn} type="button" className="kn-ca-btn" aria-label={label} aria-haspopup="menu" aria-expanded={open} disabled={disabled} onClick={() => setOpen((v) => !v)}>⋯</button>
      {open && (
        <div className="kn-ca-pop" role="menu" aria-label="更正這一條">
          {canWrong && <button type="button" role="menuitem" className="kn-ca-item" onClick={pick(onWrong)}>✗ 這條不對</button>}
          <button type="button" role="menuitem" className="kn-ca-item" onClick={pick(onFix)}>✎ 改寫</button>
          {canUndo && <button type="button" role="menuitem" className="kn-ca-item" onClick={pick(onUndo)}>↺ 撤回我的更正</button>}
        </div>
      )}
    </span>
  )
}

function PendLine({ item, ctl }: { item: PendingItem; ctl: ClaimsCtl }) {
  if (isStuck(item, ctl.now)) {
    return (
      <p className="kn-ca-pend kn-ca-pend--stuck" role="status">
        還沒生效，可能對不到這一條
        <button type="button" className="kn-ca-link" onClick={() => ctl.dismiss(item.id)}>不再顯示</button>
      </p>
    )
  }
  return <p className="kn-ca-pend" role="status"><i aria-hidden="true" />已送出，約 10 分鐘後生效</p>
}

/* ───────── 一條句子 ───────── */

export interface ClaimView {
  /** 顯示用文字（已去掉標記；暫定改寫用新文字）；沒有 claim 時＝bullet 原文字 */
  text: string
  /** 暫定改寫：呼叫端應改用純文字顯示、不要拆結構 */
  override: boolean
  wrong: boolean
  /** 這次是剛送出的（播放蓋章／劃線動畫） */
  anim: boolean
}

/** 劃線＋淡色的外框（有誤時） */
export function ClaimText({ v, children }: { v: ClaimView; children: ReactNode }) {
  return <span className="kn-ca-text" data-wrong={v.wrong} data-anim={v.anim}>{children}</span>
}

export function ClaimRow({ bid, b, children }: { bid: string; b: Bullet; children: (v: ClaimView) => ReactNode }) {
  const ctl = useClaims()
  const claim = ctl?.byBid.get(bid)
  const [editing, setEditing] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  if (!ctl || !claim) return <>{children({ text: b.text, override: false, wrong: false, anim: false })}</>
  const st = claimState(b, claim, ctl.overlay.byClaim.get(claim.id), ctl.now)
  const plain = st.display.text
  const view: ClaimView = { text: plain, override: st.override, wrong: st.wrong, anim: !!st.pending }
  const run = async (kind: 'wrong' | 'undo') => {
    setBusy(true)
    setError(null)
    const err = await ctl.send({ kind, claimId: claim.id })
    setBusy(false)
    if (err) setError(err)
  }
  const stamp = st.pending ? (st.pending.kind === 'wrong' ? '有誤' : st.pending.kind === 'fix' ? '你說的算' : '已撤回') : null
  return (
    <div className="kn-ca-row" data-wrong={st.wrong} data-mine={st.mine} data-pending={st.pending?.kind ?? undefined}>
      {editing ? (
        <ClaimEditor
          initial={plain} label={`改寫：${[...plain].slice(0, 12).join('')}`} submitLabel="送出改寫"
          onCancel={() => setEditing(false)}
          onSubmit={async (text) => {
            const err = await ctl.send({ kind: 'fix', claimId: claim.id, text })
            if (!err) setEditing(false)
            return err
          }}
        />
      ) : (
        <>
          <div className="kn-ca-main">
            {children(view)}
            {(st.wrong || st.mine || st.fresh) && (
              <span className="kn-ca-tags">
                {st.wrong && <span className="kn-ca-tag kn-ca-tag--wrong">有誤{st.display.date ? ` ${st.display.date}` : ''}</span>}
                {st.mine && <span className="kn-ca-tag kn-ca-tag--mine" title="系統改版不會動這一條">📌 你更正的</span>}
                {st.fresh && <span className="kn-ca-tag kn-ca-tag--new">新</span>}
              </span>
            )}
          </div>
          <ClaimMenu
            label={`更正這一條：${[...plain].slice(0, 12).join('')}`}
            canWrong={!st.wrong} canUndo={st.canUndo} disabled={busy}
            onWrong={() => void run('wrong')} onFix={() => { setError(null); setEditing(true) }} onUndo={() => void run('undo')}
          />
          {stamp && <span className="kn-ca-stamp" data-kind={st.pending?.kind} aria-hidden="true">{stamp}</span>}
        </>
      )}
      {st.pending && !editing && <PendLine item={st.pending.item} ctl={ctl} />}
      {error && !editing && <p className="kn-ca-error" role="alert">{error}</p>}
    </div>
  )
}

/* ───────── 每節最後的「＋ 補一句」 ───────── */

export function AddClaim({ section }: { section: BulletSection }) {
  const ctl = useClaims()
  const [open, setOpen] = useState(false)
  if (!ctl || section === 'summary') return null
  const label = SECTION_LABEL[section]
  const adds = ctl.overlay.adds.get(label) ?? []
  return (
    <div className="kn-ca-add">
      {adds.map((p) => (
        <div key={p.id} className="kn-ca-row kn-ca-ghost" data-mine="true" data-pending="add">
          <div className="kn-ca-main">
            <span className="kn-ca-text">{p.text}</span>
            <span className="kn-ca-tags"><span className="kn-ca-tag kn-ca-tag--mine" title="系統改版不會動這一條">📌 你更正的</span></span>
          </div>
          <span className="kn-ca-stamp" data-kind="fix" aria-hidden="true">你說的算</span>
          <PendLine item={p} ctl={ctl} />
        </div>
      ))}
      {open ? (
        <ClaimEditor
          initial="" label={`補一句：${label}`} submitLabel="送出"
          onCancel={() => setOpen(false)}
          onSubmit={async (text) => {
            const err = await ctl.send({ kind: 'add', section: label, text })
            if (!err) setOpen(false)
            return err
          }}
        />
      ) : (
        <button type="button" className="kn-ca-addbtn" onClick={() => setOpen(true)}>＋ 補一句</button>
      )}
    </div>
  )
}
