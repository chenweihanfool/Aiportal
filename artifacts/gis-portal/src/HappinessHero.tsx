// 翰翰仔幸福指數主卡（舊版首頁與幸福指數抽屜用）。
import { useEffect, useState } from 'react'
import { COLOR, FONT } from './theme'
import { DIMENSIONS } from './dimensions'
import { Gauge } from './Gauge'
import { formatMinutesAgo, hhiTone } from './format'
import { computeHappinessInsights } from './happinessInsights'
import { LabeledRadarChart, LockedGaugeCard, SubLabel, TrendLineChart } from './panelUi'
import { apiFetchHappinessHistory, type DashboardSummary, type HappinessHistoryPoint } from './portalApi'

// ─────────────────────────────────────────────
// 翰翰仔幸福指數 (Hanhan Happiness Index) — the primary instrument.
// ─────────────────────────────────────────────
export function HappinessHeroCard({
  summary,
  unlocked,
  unlockedPassword,
  onRequestUnlock,
}: {
  summary: DashboardSummary | undefined
  unlocked: boolean
  unlockedPassword: string | null
  onRequestUnlock: () => void
}) {
  const [expanded, setExpanded] = useState(false)
  const [history, setHistory] = useState<HappinessHistoryPoint[] | null>(null)
  const [historyError, setHistoryError] = useState(false)
  const isLocked = !unlocked

  useEffect(() => {
    if (!unlockedPassword || history !== null) return
    let cancelled = false
    apiFetchHappinessHistory(unlockedPassword)
      .then(rows => { if (!cancelled) setHistory(rows) })
      .catch(() => { if (!cancelled) setHistoryError(true) })
    return () => { cancelled = true }
  }, [unlockedPassword, history])

  const data = summary?.data
  const displayedScore = typeof data?.['displayedScore'] === 'number' ? data['displayedScore'] as number : null
  const baseScore = typeof data?.['baseScore'] === 'number' ? data['baseScore'] as number : null
  const weakestScore = typeof data?.['weakestScore'] === 'number' ? data['weakestScore'] as number : null
  const finalScore = typeof data?.['finalScore'] === 'number' ? data['finalScore'] as number : null
  const weakestComponent = typeof data?.['weakestComponent'] === 'string' ? data['weakestComponent'] as string : null
  const usingStaleData = data?.['usingStaleData'] === true
  const isSnapshotFinal = data?.['isSnapshotFinal'] === true
  const weights = data?.['weights'] as Record<string, number | undefined> | undefined

  if (isLocked) {
    return <LockedGaugeCard size="primary" label="翰翰仔幸福指數" sub="Hanhan Happiness Index" onRequestUnlock={onRequestUnlock} />
  }

  if (!data || displayedScore === null) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '0.5rem' }}>
        <Gauge value={null} size="primary" />
        <div style={{ fontSize: '0.85rem', color: COLOR.steelDim }}>資料準備中…</div>
      </div>
    )
  }

  const tone = hhiTone(displayedScore)
  // 六列由面向註冊表（dimensions.ts）推導：名稱、分數欄位、權重欄位與預設值只寫在那一處
  const contributions: Array<{ label: string; value: number | null; weightPct: number }> = DIMENSIONS.map(d => {
    const v = data[d.scoreKey]
    return { label: d.label, value: typeof v === 'number' ? v : null, weightPct: Math.round((weights?.[d.weightKey] ?? d.defaultWeight) * 100) }
  })
  const radarAxes = contributions.map(c => ({ label: c.label, value: c.value }))

  return (
    <div>
      <div style={{ display: 'grid', gridTemplateColumns: 'auto 1fr', gap: '2rem', alignItems: 'center' }} className="ip-primary-grid">
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '0.3rem' }}>
          <Gauge value={displayedScore} size="primary" color={tone.color} />
          <div style={{ fontSize: '0.95rem', fontWeight: 600, color: tone.color }}>{tone.label}</div>
          {!isSnapshotFinal && (
            <span style={{ fontFamily: FONT.mono, fontSize: '0.62rem', color: COLOR.warn, border: `1px solid ${COLOR.warn}`, borderRadius: '999px', padding: '1px 8px' }}>今日暫定</span>
          )}
        </div>
        <LabeledRadarChart axes={radarAxes} maxValue={100} size={230} color={tone.color} />
      </div>

      {/* 權重佔比——雷達圖只畫得出分數，這行補上每個維度實際佔幸福指數的
          百分比，雷達圖看不出來的資訊。 */}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.6rem 1.2rem', justifyContent: 'center', marginTop: '1rem', fontFamily: FONT.mono, fontSize: '0.66rem', color: COLOR.steelDim }}>
        {contributions.map(c => (
          <span key={c.label}>{c.label} <span style={{ color: COLOR.steel }}>{c.weightPct}%</span></span>
        ))}
      </div>

      {weakestComponent && (
        <div style={{ fontSize: '0.78rem', color: COLOR.steel, marginTop: '1rem' }}>
          目前最需要照顧：<span style={{ color: COLOR.warn, fontWeight: 600 }}>{weakestComponent}</span>
        </div>
      )}

      {history !== null && history.length > 0 && (() => {
        const insights = computeHappinessInsights(history)
        const rows: string[] = []
        if (insights.weakestFrequency) {
          rows.push(`最常見短板：${insights.weakestFrequency.label}（${insights.weakestFrequency.count}/${insights.weakestFrequency.total} 天）`)
        }
        if (insights.bestDay && insights.worstDay && insights.bestDay.date !== insights.worstDay.date) {
          rows.push(`最高 ${insights.bestDay.date}（${insights.bestDay.score} 分）· 最低 ${insights.worstDay.date}（${insights.worstDay.score} 分）`)
        }
        if (insights.streak && insights.streak.days >= 2) {
          rows.push(`連續 ${insights.streak.days} 天${insights.streak.direction === 'up' ? '上升' : '下降'}`)
        }
        if (insights.weekdayPattern) {
          rows.push(`${insights.weekdayPattern.bestWeekday}通常最高（${insights.weekdayPattern.bestAvg} 分）· ${insights.weekdayPattern.worstWeekday}通常最低（${insights.weekdayPattern.worstAvg} 分）`)
        }
        if (insights.volatility) {
          rows.push(`波動度：${insights.volatility.label}（標準差 ${insights.volatility.stdDev}）`)
        }
        if (rows.length === 0) return null
        return (
          <div style={{ marginTop: '1rem', paddingTop: '0.9rem', borderTop: `1px solid ${COLOR.line}` }}>
            <SubLabel>近 30 天洞察</SubLabel>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
              {rows.map(r => <div key={r} style={{ fontSize: '0.76rem', color: COLOR.steel, lineHeight: 1.6 }}>{r}</div>)}
            </div>
          </div>
        )
      })()}

      <div style={{ marginTop: '1rem', paddingTop: '1rem', borderTop: `1px dashed ${COLOR.line}`, display: 'flex', flexDirection: 'column', gap: '6px' }}>
        {[
          ['基礎分（加權平均）', baseScore !== null ? baseScore.toFixed(2) : '—'],
          ['最弱項分數', weakestScore !== null ? weakestScore.toFixed(2) : '—'],
          ['短板修正後（平滑前）', finalScore !== null ? String(finalScore) : '—'],
          ['平滑後（目前顯示值）', String(displayedScore)],
        ].map(([label, value]) => (
          <div key={label} style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.72rem' }}>
            <span style={{ color: COLOR.steelDim }}>{label}</span>
            <span style={{ color: COLOR.steel, fontWeight: 500, fontFamily: FONT.mono }}>{value}</span>
          </div>
        ))}
      </div>

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', paddingTop: '0.7rem', marginTop: '0.8rem', borderTop: `1px solid ${COLOR.line}` }}>
        <span style={{ fontFamily: FONT.mono, fontSize: '0.66rem', color: COLOR.steelDim }}>
          {formatMinutesAgo(summary?.fetchedAt ?? null)}
          {usingStaleData ? <span style={{ color: COLOR.warn, marginLeft: '8px' }}>· 部分資料為最近可用值</span> : null}
        </span>
        <span onClick={() => setExpanded(x => !x)} style={{ fontFamily: FONT.mono, fontSize: '0.66rem', color: COLOR.amberDim, cursor: 'pointer' }}>
          {expanded ? '收起趨勢圖 ▲' : '歷史趨勢圖 ▼'}
        </span>
      </div>

      {expanded && (
        <div style={{ marginTop: '0.6rem', paddingTop: '0.8rem', borderTop: `1px dashed ${COLOR.line}` }}>
          <SubLabel>近 30 天趨勢（每日顯示值）</SubLabel>
          {historyError ? (
            <div style={{ fontSize: '0.72rem', color: COLOR.steelDim }}>趨勢資料讀取失敗</div>
          ) : history === null ? (
            <div style={{ fontSize: '0.72rem', color: COLOR.steelDim }}>載入中…</div>
          ) : (
            <TrendLineChart points={history.map(h => ({ date: h.date, value: h.displayedScore }))} color={tone.color} />
          )}
        </div>
      )}
    </div>
  )
}
