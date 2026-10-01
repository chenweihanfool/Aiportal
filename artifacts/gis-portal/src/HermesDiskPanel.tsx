// 戰情室「硬碟容量」：VPS 容量有限、知識庫會一直長，所以不只看「現在用了幾 %」，
// 還要看「長多快、哪一塊在長、照這個速度幾天後寫滿」。
// 資料：快照的 disks／storage、後端算好的 diskForecast（讀取時用歷史現算）、每日歷史的已用 GB。
import { COLOR, FONT } from './theme'
import {
  describeForecast, formatBytes, formatSignedBytes, pickBaseline, storageShares,
  type DiskAlertLevel, type DiskForecastInfo, type StorageItem,
} from './diskView'

export interface DiskInfo { drive: string; percentUsed: number; freeGb: number; totalGb: number }
export interface DiskHistoryPoint {
  date: string
  diskUsedGb: number | null
  diskFreeGb: number | null
  diskTotalGb: number | null
  storage: StorageItem[] | null
}

const TONE: Record<'ok' | 'warn' | 'crit' | 'dim', string> = { ok: COLOR.ok, warn: COLOR.warn, crit: COLOR.crit, dim: COLOR.steelDim }

function levelTone(level: DiskAlertLevel): string {
  return level === 'crit' ? COLOR.crit : level === 'warn' ? COLOR.warn : COLOR.ok
}

function UsedChart({ points }: { points: Array<{ date: string; value: number }> }) {
  if (points.length < 2) {
    return <div style={{ fontSize: '0.7rem', color: COLOR.steelDim, padding: '0.4rem 0' }}>每天累積一筆，至少兩天後這裡會出現「已用空間」曲線</div>
  }
  const w = 100
  const h = 70
  const padY = 8
  const vals = points.map(p => p.value)
  const lo = Math.min(...vals)
  const hi = Math.max(...vals)
  const range = hi - lo || 1
  const coords = points.map((p, i) => [(i / (points.length - 1)) * w, padY + (h - padY * 2) - ((p.value - lo) / range) * (h - padY * 2)] as const)
  const line = coords.map(([x, y], i) => `${i === 0 ? 'M' : 'L'}${x.toFixed(2)},${y.toFixed(2)}`).join(' ')
  const last = coords[coords.length - 1]!
  return (
    <div>
      <svg width="100%" height={h} viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" style={{ display: 'block' }} role="img" aria-label="已用空間趨勢">
        <path d={`${line} L${last[0].toFixed(2)},${h} L0,${h} Z`} fill={COLOR.amber} fillOpacity={0.12} stroke="none" />
        <path d={line} fill="none" stroke={COLOR.amber} strokeWidth={1.4} vectorEffect="non-scaling-stroke" />
        <circle cx={last[0]} cy={last[1]} r={2} fill={COLOR.amber} vectorEffect="non-scaling-stroke" />
      </svg>
      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.62rem', fontFamily: FONT.mono, color: COLOR.steelDim, marginTop: '4px' }}>
        <span>{points[0]!.date}</span>
        <span>{lo.toFixed(1)}～{hi.toFixed(1)} GB</span>
        <span>{points[points.length - 1]!.date}</span>
      </div>
    </div>
  )
}

export function HermesDiskPanel({
  disk, storage, forecast, level, history,
}: {
  disk: DiskInfo | null
  storage: StorageItem[]
  forecast: DiskForecastInfo | null
  level: DiskAlertLevel
  history: DiskHistoryPoint[] | null
}) {
  if (!disk) return <div style={{ fontSize: '0.7rem', color: COLOR.steelDim, padding: '0.6rem 0' }}>尚未取得磁碟資料</div>

  const usedGb = disk.totalGb - disk.freeGb
  const f = describeForecast(forecast)
  const hist = history ?? []
  const today = hist.length > 0 ? hist[hist.length - 1]!.date : null
  const baseline = today ? pickBaseline(hist, today, 7) : null
  const baselineDays = baseline && today ? Math.round((Date.parse(`${today}T00:00:00Z`) - Date.parse(`${baseline.date}T00:00:00Z`)) / 86_400_000) : null
  const shares = storageShares(storage, usedGb * 1e9, baseline?.storage ?? null)
  const chartPoints = hist.filter((h): h is DiskHistoryPoint & { diskUsedGb: number } => h.diskUsedGb !== null).map(h => ({ date: h.date, value: h.diskUsedGb }))

  return (
    <div>
      <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'baseline', gap: '0.4rem 1.2rem', marginBottom: '0.5rem' }}>
        <span style={{ fontFamily: FONT.mono, fontSize: '1.3rem', fontWeight: 600, color: levelTone(level), fontVariantNumeric: 'tabular-nums' }}>
          {Math.round(disk.percentUsed)}%
        </span>
        <span style={{ fontFamily: FONT.mono, fontSize: '0.74rem', color: COLOR.ink }}>
          已用 {usedGb.toFixed(1)} / {disk.totalGb.toFixed(1)} GB · 剩 {disk.freeGb.toFixed(1)} GB
        </span>
        <span style={{ fontFamily: FONT.mono, fontSize: '0.62rem', color: COLOR.steelDim }}>{disk.drive}</span>
      </div>
      <div style={{ fontSize: '0.74rem', color: TONE[f.tone], lineHeight: 1.6, marginBottom: '0.9rem' }}>{f.text}</div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: '1rem 1.6rem' }}>
        <div>
          <div style={{ fontFamily: FONT.mono, fontSize: '0.6rem', letterSpacing: '0.14em', color: COLOR.steelDim, marginBottom: '0.4rem' }}>已用空間（每日）</div>
          <UsedChart points={chartPoints} />
        </div>
        <div>
          <div style={{ fontFamily: FONT.mono, fontSize: '0.6rem', letterSpacing: '0.14em', color: COLOR.steelDim, marginBottom: '0.4rem' }}>
            佔用分項{baselineDays !== null ? `（與 ${baselineDays} 天前比）` : ''}
          </div>
          {shares.length === 0 ? (
            <div style={{ fontSize: '0.7rem', color: COLOR.steelDim, lineHeight: 1.6 }}>尚無分項資料（需 status pusher 量測 vault／資料庫／docker 等大戶後上報）</div>
          ) : (
            shares.map(s => (
              <div key={s.label} style={{ marginBottom: '0.45rem' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: '8px', fontFamily: FONT.mono, fontSize: '0.68rem' }}>
                  <span style={{ color: COLOR.ink, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{s.label}</span>
                  <span style={{ color: COLOR.steel, flexShrink: 0 }}>
                    {formatBytes(s.bytes)}
                    {s.delta !== null && (
                      <span style={{ marginLeft: '8px', color: s.delta > 1e8 ? COLOR.warn : COLOR.steelDim }}>{formatSignedBytes(s.delta)}</span>
                    )}
                  </span>
                </div>
                {s.note && <div style={{ fontFamily: FONT.mono, fontSize: '0.62rem', color: COLOR.amber, marginTop: '1px' }}>{s.note}</div>}
                <div style={{ height: '4px', background: COLOR.line, borderRadius: '2px', marginTop: '3px' }}>
                  <div style={{ width: `${Math.min(100, Math.max(1, s.share * 100))}%`, height: '100%', background: s.label.startsWith('其他') ? COLOR.steelDim : COLOR.amber, borderRadius: '2px' }} />
                </div>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  )
}
