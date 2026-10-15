import type { ReactNode } from 'react'
import { formatAge, formatDuration, type BlockStatus } from './homeView'

// 統一狀態機的呈現元件（審計報告 §2.4）：每個資料區塊都包一層，依 blockState() 的結果顯示
// 未解鎖／載入中／資料累積中／空／過期／太久沒更新／失敗；正常時原樣顯示 children。
// 樣式在 portal.css 的 hm-frame／hm-skel／hm-badge。

/** 骨架（灰條），載入中與未解鎖的背景都用它，不寫「載入中…」 */
export function Skeleton({ lines = 3 }: { lines?: number }) {
  return (
    <div className="hm-skel" aria-hidden>
      {Array.from({ length: lines }, (_, i) => <i key={i} style={{ width: `${88 - i * 14}%` }} />)}
    </div>
  )
}

export interface StateFrameProps {
  status: BlockStatus
  children: ReactNode
  /** 資料來源名稱：dead 時寫「已 n 天沒有更新：<來源>」 */
  source: string
  skeleton?: ReactNode
  /** empty 時顯示的內容（可含連結）；沒給就用預設文字 */
  empty?: ReactNode
  pendingText?: string
  /** error 且沒有上一次的值時顯示 */
  errorText?: string
  onRequestUnlock?: () => void
  onRetry?: () => void
  className?: string
}

export function StateFrame({ status, children, source, skeleton, empty, pendingText, errorText, onRequestUnlock, onRetry, className }: StateFrameProps) {
  const cls = `hm-frame hm-frame--${status.state}${className ? ` ${className}` : ''}`
  const ghost = skeleton ?? <Skeleton />
  switch (status.state) {
    case 'locked':
      return (
        <div className={cls} data-state="locked">
          <div className="hm-ghost" aria-hidden>{ghost}</div>
          {onRequestUnlock
            ? <button type="button" className="hm-lock" onClick={onRequestUnlock}>🔒 解鎖後顯示</button>
            : <span className="hm-lock" role="status">🔒 解鎖後顯示</span>}
        </div>
      )
    case 'loading':
      return <div className={cls} data-state="loading" aria-busy="true" aria-label={`${source}載入中`}>{ghost}</div>
    case 'pending':
      return <div className={cls} data-state="pending"><p className="hm-note">{pendingText ?? '資料累積中'}</p></div>
    case 'empty':
      return <div className={cls} data-state="empty"><div className="hm-note">{empty ?? '目前沒有資料'}</div></div>
    case 'dead':
      return (
        <div className={cls} data-state="dead">
          <div className="hm-dead"><b>—</b><span>已 {formatDuration(status.ageMin ?? 0)}沒有更新：{source}</span></div>
        </div>
      )
    case 'error':
      if (status.keepLastValue) {
        return (
          <div className={cls} data-state="error-keep">
            <span className="hm-badge hm-badge--warn" role="status" title={`${source}更新失敗，顯示的是上一次的值`}>更新失敗・上次的值</span>
            <div className="hm-faded">{children}</div>
          </div>
        )
      }
      return (
        <div className={cls} data-state="error">
          <p className="hm-note hm-note--bad">{errorText ?? `${source}暫時無法取得`}</p>
          {onRetry && <button type="button" className="hm-retry" onClick={onRetry}>重試</button>}
        </div>
      )
    case 'stale':
      return (
        <div className={cls} data-state="stale">
          <span className="hm-badge hm-badge--stale" role="status" title={`${source}超過預期的更新間隔`}>資料 {formatAge(status.ageMin ?? 0)}</span>
          <div className="hm-faded">{children}</div>
        </div>
      )
    default:
      return <div className={cls} data-state="fresh">{children}</div>
  }
}
