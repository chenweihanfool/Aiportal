// 面向頁（#dim/<key>）的「分數怎麼來」內容與相關連結。
import { type DimLink } from './DimensionPage'
import { COLOR, FONT } from './theme'
import { MindDetailBody, SUMMARY_BODIES, SocialDetailBody } from './DimensionCards'
import { dimensionOf } from './dimensions'
import { rawToScoreText } from './dimensionPage'
import { formatMinutesAgo } from './format'
import { type DashboardSummary, type SiteData } from './portalApi'

// ─────────────────────────────────────────────
// 面向頁（#dim/<key>）的「分數怎麼來」與相關連結。各面向的原始數據元件沿用首頁卡片展開用的同一批
// （*SummaryBody／MindDetailBody／SocialDetailBody），所以首頁卡片與面向頁不會各說各話。
// ─────────────────────────────────────────────
export function DimensionDetail({ dimKey, dashboard }: { dimKey: string; dashboard: DashboardSummary[] }) {
  const hhiSummary = dashboard.find(d => d.subsystemId === 'hhi')
  const def = dimensionOf(dimKey)
  if (!def) return null
  if (def.detail === 'subsystem') {
    const subId = def.subsystemId
    const summary = dashboard.find(d => d.subsystemId === subId)
    const Body = SUMMARY_BODIES[subId]
    const data = summary?.data
    if (!summary || !data || !Body) return null
    const raw = def.rawField && typeof data[def.rawField] === 'number' ? data[def.rawField] as number : null
    const normalized = typeof hhiSummary?.data?.[def.scoreKey] === 'number' ? hhiSummary.data[def.scoreKey] as number : null
    return (
      <div>
        <div style={{ fontFamily: FONT.mono, fontSize: '0.64rem', color: COLOR.steelDim, marginBottom: '0.6rem', lineHeight: 1.6 }}>
          {rawToScoreText(raw, normalized, def.absolute)}
        </div>
        {data['stale'] === true && <div style={{ fontSize: '0.68rem', color: COLOR.warn, marginBottom: '0.5rem' }}>資料已超過 36 小時未更新</div>}
        <Body data={data} />
        <div style={{ fontFamily: FONT.mono, fontSize: '0.6rem', color: COLOR.steelDim, marginTop: '0.6rem' }}>{formatMinutesAgo(summary.fetchedAt)}</div>
      </div>
    )
  }
  if (def.detail === 'mind') {
    return (
      <div>
        <MindDetailBody hhiSummary={hhiSummary} />
        <div style={{ fontFamily: FONT.mono, fontSize: '0.6rem', color: COLOR.steelDim, marginTop: '0.6rem' }}>{formatMinutesAgo(hhiSummary?.fetchedAt ?? null)}</div>
      </div>
    )
  }
  if (def.detail === 'social') {
    const summary = dashboard.find(d => d.subsystemId === 'social-index')
    const data = summary?.data
    if (!summary || !data) return null
    const observed = typeof data['observedDayCount'] === 'number' ? data['observedDayCount'] as number : null
    const names = Array.isArray(data['personNames']) ? (data['personNames'] as unknown[]).filter((v): v is string => typeof v === 'string') : []
    if (observed === null || observed === 0) return <p className="hm-note">近 14 天沒有日記可供觀測，所以還算不出社交分數。</p>
    return (
      <div>
        {data['stale'] === true && <div style={{ fontSize: '0.68rem', color: COLOR.warn, marginBottom: '0.5rem' }}>資料已超過 36 小時未更新</div>}
        {names.length > 0 && (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px', marginBottom: '0.7rem' }} aria-label="近 14 天互動的家人朋友">
            {names.map(n => <span key={n} style={{ fontSize: '0.68rem', color: COLOR.steel, background: COLOR.panelDeep, border: `1px solid ${COLOR.line}`, borderRadius: '999px', padding: '2px 9px' }}>{n}</span>)}
          </div>
        )}
        <SocialDetailBody summary={summary} hhiSummary={hhiSummary} />
        <div style={{ fontFamily: FONT.mono, fontSize: '0.6rem', color: COLOR.steelDim, marginTop: '0.6rem' }}>{formatMinutesAgo(summary.fetchedAt)}</div>
      </div>
    )
  }
  return null
}

export function dimensionLinks(dimKey: string, sites: SiteData[], open: (s: SiteData) => void): DimLink[] {
  const out: DimLink[] = []
  const def = dimensionOf(dimKey)
  const site = def?.detail === 'subsystem' ? sites.find(s => s.subsystemId === def.subsystemId) : undefined
  if (site && site.links[0]?.url) out.push({ label: `前往 ${site.name} ↗`, onClick: () => open(site) })
  if (dimKey === 'travel') out.push({ label: '遊記 →', hash: 'trips' }, { label: '美食及旅遊地圖 →', hash: 'food' })
  if (dimKey === 'mind') out.push({ label: '時間軸（日報分數）→', hash: 'graph/timeline' })
  if (dimKey === 'social') out.push({ label: '關係宇宙 →', hash: 'graph' })
  return out
}
