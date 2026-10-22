// 付費服務卡：Ollama、Claude Pro、JEV、Tavily、DeepSeek 一列一個，能自動讀到額度的直接顯示，其餘放連結。
// 首頁是一條細列（點開看詳情），詳情在抽屜：每個服務的用量與連結，下面接 Ollama 的走勢與「更新餘額」表單。
import { COLOR } from './theme'
import { HomeCard } from './HomeCard'
import { StateFrame, Skeleton } from './StateFrame'
import type { BlockStatus } from './homeView'
import { OllamaPanel } from './DesktopBoard'
import { buildServiceRows, type ServiceRow, type ServiceTone } from './paidServicesView'
import type { UsageData } from './boardApi'
import type { PaidServicesData } from './paidServicesView'

const TONE: Record<ServiceTone, string> = { ok: COLOR.ok, warn: COLOR.warn, crit: COLOR.crit, none: COLOR.steelDim }

export function PaidServicesSection({ st, usage, paid, onOpen, onRequestUnlock }: {
  st: BlockStatus
  usage: UsageData | null
  paid: PaidServicesData | null
  onOpen: () => void
  onRequestUnlock: () => void
}) {
  const rows = buildServiceRows({ usage, paid })
  return (
    <HomeCard id="sec-svc" className="hm-svc" head={false}>
      <StateFrame status={st} source="付費服務" onRequestUnlock={onRequestUnlock} skeleton={<Skeleton lines={1} />} className="hm-svc-frame">
        <button type="button" className="hm-svc-bar" onClick={onOpen} aria-haspopup="dialog" aria-label="付費服務用量與連結">
          <b className="hm-sys-name">付費服務</b>
          <span className="hm-svc-chips">
            {rows.map((r) => (
              <span key={r.id} className="hm-svc-chip" data-testid={`svc-chip-${r.id}`} title={`${r.name}：${r.line}`}>
                <i style={{ background: TONE[r.tone] }} aria-hidden />{r.name.split(' ')[0]}
              </span>
            ))}
          </span>
          <span className="hm-link">詳情 →</span>
        </button>
      </StateFrame>
    </HomeCard>
  )
}

function ServiceItem({ row }: { row: ServiceRow }) {
  return (
    <li className="hm-svc-row" data-testid={`svc-row-${row.id}`}>
      <i style={{ background: TONE[row.tone], boxShadow: row.tone === 'none' ? 'none' : `0 0 6px ${TONE[row.tone]}` }} aria-hidden />
      <b>{row.name}</b>
      <span className="hm-svc-line" style={{ color: row.tone === 'warn' || row.tone === 'crit' ? TONE[row.tone] : undefined }}>{row.line}</span>
      {row.live && <span className="hm-chip">自動讀取</span>}
      <a className="hm-link" href={row.href} target="_blank" rel="noopener noreferrer">開啟 ↗</a>
    </li>
  )
}

export function PaidServicesPanel({ pw, usage, paid }: { pw: string; usage: UsageData | null; paid: PaidServicesData | null }) {
  const rows = buildServiceRows({ usage, paid })
  return (
    <>
      <ul className="hm-svc-list">{rows.map((r) => <ServiceItem key={r.id} row={r} />)}</ul>
      <p className="hm-note" style={{ margin: '0.6rem 0 1rem' }}>
        只有 DeepSeek、Tavily 能用 API 金鑰直接讀額度（金鑰放在伺服器環境變數 <code>DEEPSEEK_API_KEY</code>、<code>TAVILY_API_KEY</code>，不會送到瀏覽器）。Ollama 沒有額度端點，餘額由你在下面輸入；Claude Pro、JEV 沒有用量 API，只能開連結看。
      </p>
      <OllamaPanel pw={pw} />
    </>
  )
}
