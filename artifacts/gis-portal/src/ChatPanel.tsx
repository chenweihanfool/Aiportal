// 入口網內建 HERMES 對話。純邏輯在 chatView.ts，網路在 chatApi.ts。
// 使用者 2026-10-30：「想法庫會蓋掉HERMES對話框 讓我不好複製貼上」——對話是獨立的浮動視窗，不佔抽屜，開著想法庫也能用。
import { useCallback, useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from 'react'
import { MarkdownView } from './MarkdownView'
import { answerApproval, fetchChatStatus, fetchMessages, fetchRun, newChat, readEvents, requestRestart, sendMessage, stopRun, type ChatStatus } from './chatApi'
import { applyEvent, applyStatus, emptyRun, parseSse, restartBusy, restartText, setPrefillTarget, tokenText, type RunView } from './chatView'

type Item = { key: string; role: 'user' | 'assistant' | 'divider'; content: string }

const POLL_MS = 2000
const STATUS_MS = 15_000

/** 浮動按鈕與視窗。關掉只是隱藏：回覆跑到一半不會中斷，對話內容也還在 */
export function ChatDock({ pw }: { pw: string }) {
  const [open, setOpen] = useState(false)
  const [mounted, setMounted] = useState(false)
  const [prefill, setPrefill] = useState<{ text: string; n: number } | null>(null)
  const show = () => { setMounted(true); setOpen(true) }
  useEffect(() => {
    setPrefillTarget((text) => { show(); setPrefill((p) => ({ text, n: (p?.n ?? 0) + 1 })) })
    return () => setPrefillTarget(null)
  }, [])
  return (
    <>
      <button type="button" className="hm-chat-fab" data-testid="chat-open" aria-label="和 HERMES 對話" aria-expanded={open} title="和 HERMES 對話" onClick={() => (open ? setOpen(false) : show())}>💬</button>
      {mounted && (
        <section className="ch-dock" data-testid="chat-dock" role="dialog" aria-label="HERMES 對話" hidden={!open}>
          <header className="ch-dock-head">
            <h2>HERMES 對話</h2>
            <button type="button" className="ch-btn" onClick={() => setOpen(false)} aria-label="收起對話">✕</button>
          </header>
          <ChatPanel pw={pw} prefill={prefill} />
        </section>
      )}
    </>
  )
}

export function ChatPanel({ pw, prefill }: { pw: string; prefill: { text: string; n: number } | null }) {
  const [status, setStatus] = useState<ChatStatus | null>(null)
  const [items, setItems] = useState<Item[]>([])
  const [input, setInput] = useState('')
  const [runId, setRunId] = useState<string | null>(null)
  const [run, setRun] = useState<RunView | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [confirming, setConfirming] = useState(false)
  const [lastTokens, setLastTokens] = useState<number | null>(null)
  const logRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const seq = useRef(0)
  const push = (role: Item['role'], content: string) => setItems((xs) => [...xs, { key: `n${++seq.current}`, role, content }])

  const loadStatus = useCallback(() => fetchChatStatus(pw).then(setStatus).catch(() => setStatus(null)), [pw])

  useEffect(() => {
    void loadStatus()
    fetchMessages(pw).then((ms) => setItems(ms.map((m) => ({ key: `m${m.id}`, role: m.role, content: m.content })))).catch(() => { /* 沒設定或連不上時由狀態列說明 */ })
  }, [pw, loadStatus])

  const restarting = restartBusy(status?.restart ?? null)
  useEffect(() => {
    const t = setInterval(() => { void loadStatus() }, restarting ? 3000 : STATUS_MS)
    return () => clearInterval(t)
  }, [loadStatus, restarting])

  useEffect(() => {
    if (!prefill) return
    setInput((s) => (s.trim() ? `${s}\n${prefill.text}` : prefill.text))
    inputRef.current?.focus()
  }, [prefill])

  useEffect(() => { logRef.current?.scrollTo({ top: logRef.current.scrollHeight }) }, [items, run])

  // 收尾：把這次回覆寫進對話紀錄
  useEffect(() => {
    if (!run?.done) return
    if (run.text) push('assistant', run.text)
    if (run.error) setError(run.error)
    setLastTokens(run.tokens)
    setRun(null)
    setRunId(null)
  }, [run])

  const follow = useCallback(async (id: string) => {
    let buffer = ''
    let cur = emptyRun()
    try {
      await readEvents(pw, id, (chunk) => {
        const { events, rest } = parseSse(buffer, chunk)
        buffer = rest
        cur = events.reduce(applyEvent, cur)
        setRun(cur)
      })
    } catch { /* 事件流只能讀一次：斷線就改查狀態 */ }
    for (let i = 0; !cur.done && i < 900; i++) {
      await new Promise((r) => setTimeout(r, POLL_MS))
      const st = await fetchRun(pw, id).catch(() => null)
      if (st) { cur = applyStatus(cur, st); setRun(cur) }
    }
  }, [pw])

  const send = async (e?: FormEvent) => {
    e?.preventDefault()
    const text = input.trim()
    if (!text || runId) return
    setError(null)
    setInput('')
    try {
      const r = await sendMessage(pw, text)
      if (r.isNew && items.length > 0) push('divider', '已開新對話')
      push('user', text)
      setRun(emptyRun())
      setRunId(r.runId)
      void follow(r.runId)
      void loadStatus()
    } catch (err) {
      setInput(text)
      setError((err as Error).message)
    }
  }

  const onKey = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); void send() }
  }

  const fresh = async () => {
    await newChat(pw).catch(() => undefined)
    setItems([])
    setLastTokens(null)
    void loadStatus()
  }

  const restart = async (mode: 'graceful' | 'force') => {
    setConfirming(false)
    setError(null)
    await requestRestart(pw, mode).catch((err: Error) => setError(err.message))
    void loadStatus()
  }

  const approve = (choice: 'once' | 'deny') => {
    if (!runId) return
    setRun((s) => (s ? { ...s, approval: null } : s))
    answerApproval(pw, runId, choice, run?.approval ?? null).catch((err: Error) => setError(err.message))
  }

  const restartNote = restartText(status?.restart ?? null, Date.now())
  const stuck = status?.restart?.status === 'timeout' || (status !== null && !status.gateway)
  const ready = status?.configured === true

  return (
    <div className="ch-root" data-testid="chat-panel">
      <div className="ch-bar">
        <span><span className="ch-dot" data-on={status ? String(status.gateway) : undefined} />Gateway {status === null ? '讀取中' : status.gateway ? '正常' : '沒有回應'}</span>
        {lastTokens !== null && <span title="這次回覆用掉的 token；每開新對話會回到基本量">本次 {tokenText(lastTokens)} tokens</span>}
        <span className="ch-bar-gap" />
        <button type="button" className="ch-btn" data-testid="chat-new" onClick={() => void fresh()} disabled={!!runId}>新對話</button>
        <button type="button" className="ch-btn" data-testid="chat-restart" onClick={() => setConfirming((x) => !x)} disabled={restarting}>重啟 Gateway</button>
      </div>
      {confirming && (
        <div className="ch-card" data-testid="chat-restart-confirm">
          <p style={{ margin: 0 }}>重啟期間 Telegram 與這裡的對話都會中斷，約 40 秒恢復。</p>
          <div className="ch-card-row">
            <button type="button" className="ch-btn" onClick={() => void restart('graceful')}>優雅重啟（等工作收尾）</button>
            <button type="button" className="ch-btn ch-btn--warn" onClick={() => void restart('force')}>強制重啟（中斷進行中的工作）</button>
            <button type="button" className="ch-btn" onClick={() => setConfirming(false)}>取消</button>
          </div>
        </div>
      )}
      {restartNote && <p className="ch-note" role="status" style={{ margin: 0 }}>{restartNote}{stuck && !restarting ? '。Gateway 卡住時可用強制重啟' : ''}</p>}
      {status && !ready && <p className="ch-note" style={{ margin: 0 }}>對話尚未設定：伺服器沒有 HERMES_API_KEY。重啟 Gateway 仍可使用。</p>}
      <div className="ch-log" ref={logRef} aria-live="polite">
        {items.length === 0 && !run && ready && <p className="ch-note" style={{ margin: 0 }}>閒置 {status.idleMinutes} 分鐘後，下一則訊息會自動開新對話。</p>}
        {items.map((m) => m.role === 'divider'
          ? <div key={m.key} className="ch-divider">— {m.content} —</div>
          : <div key={m.key} className={`ch-msg ch-msg--${m.role}`}>{m.role === 'assistant' ? <MarkdownView text={m.content} /> : m.content}</div>)}
        {run && (
          <>
            {run.tools.slice(-4).map((t, i) => <div key={i} className="ch-tool">{t}</div>)}
            <div className="ch-msg ch-msg--assistant" data-testid="chat-streaming">{run.text ? <MarkdownView text={run.text} /> : '思考中…'}</div>
            {run.approval && (
              <div className="ch-card" data-testid="chat-approval" role="alertdialog" aria-label="需要核准">
                <strong>HERMES 要執行這個操作，需要你核准</strong>
                {run.approval.description && <span>{run.approval.description}</span>}
                <code>{run.approval.command}</code>
                <div className="ch-card-row">
                  <button type="button" className="ch-btn" onClick={() => approve('once')}>允許一次</button>
                  <button type="button" className="ch-btn ch-btn--warn" onClick={() => approve('deny')}>拒絕</button>
                </div>
              </div>
            )}
          </>
        )}
      </div>
      {error && <p className="ch-note" role="alert" style={{ margin: 0, color: '#e0605a' }}>{error}</p>}
      <form className="ch-form" onSubmit={(e) => void send(e)}>
        <textarea ref={inputRef} className="ch-input" data-testid="chat-input" rows={3} value={input} onChange={(e) => setInput(e.target.value)} onKeyDown={onKey} placeholder="和 HERMES 說話（Enter 送出，Shift+Enter 換行）" aria-label="訊息" disabled={!ready} />
        {runId
          ? <button type="button" className="ch-btn ch-btn--warn" onClick={() => void stopRun(pw, runId)}>中止</button>
          : <button type="submit" className="ch-btn" disabled={!ready || !input.trim()}>送出</button>}
      </form>
    </div>
  )
}
