import { useState } from 'react'
import { apiCreatePin } from './pushTriggersApi'
import { mdLabel, pinDateRange, pinDateValid, pinDueOptions, taipeiDate, type PinTarget } from './pushTriggers'

// 📌 需要時提醒我：按下展開「明天早上／下週一／自訂日期」，送出後到那天首頁推送卡出現一張釘選卡。
// 閱讀面板與卷宗頁頁首共用；樣式 pt- 前綴在 portal.css。

export function PinButton({ pw, target }: { pw: string | null; target: PinTarget | null }) {
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<{ text: string; err: boolean } | null>(null)
  const [custom, setCustom] = useState('')
  if (!pw || !target) return null

  const today = taipeiDate(Date.now())
  const opts = pinDueOptions(today)
  const range = pinDateRange(today)

  const submit = async (date: string) => {
    if (busy) return
    if (!pinDateValid(date, today)) { setMsg({ text: '日期要在今天到一年內。', err: true }); return }
    setBusy(true)
    setMsg(null)
    try {
      await apiCreatePin(pw, target, date)
      setMsg({ text: `已排好：${mdLabel(date)} 會提醒你`, err: false })
    } catch {
      setMsg({ text: '排提醒失敗，請稍後再試。', err: true })
    } finally {
      setBusy(false)
    }
  }

  return (
    <span className="pt-pin">
      <button type="button" className="pt-pin-btn" aria-expanded={open} onClick={() => setOpen((o) => !o)}>📌 需要時提醒我</button>
      {open && (
        <div className="pt-menu" role="group" aria-label="選提醒日期">
          {opts.map((o) => (
            <button key={o.id} type="button" className="pt-opt" disabled={busy} onClick={() => void submit(o.date)}>{o.label}（{mdLabel(o.date)}）</button>
          ))}
          <input type="date" className="pt-date" aria-label="自訂提醒日期" min={range.min} max={range.max} value={custom} onChange={(e) => setCustom(e.target.value)} />
          <button type="button" className="pt-go" disabled={busy || !custom} onClick={() => void submit(custom)}>提醒我</button>
          {msg && <p className={`pt-msg${msg.err ? ' pt-err' : ''}`} role="status">{msg.text}</p>}
        </div>
      )}
    </span>
  )
}
