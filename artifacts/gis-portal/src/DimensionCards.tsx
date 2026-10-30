// 六個面向的摘要內容與卡片（財務／身體／從容／旅遊的 *SummaryBody，心智、社交的明細與卡片）。#dim/<key> 面向頁也用這裡的明細元件。
import { useState } from 'react'
import { COLOR, FONT } from './theme'
import { DIMENSIONS, dimensionOf, type DimensionDef } from './dimensions'
import { Gauge } from './Gauge'
import { rawToScoreText } from './dimensionPage'
import { MIND_SCORE_BANDS, SOCIAL_SCORE_BANDS, bandTone, formatMinutesAgo, formatPct, formatTWD, heroTone } from './format'
import { FormulaPanel, FormulaToggle, LabeledRadarChart, LockedGaugeCard, SupportStats } from './panelUi'
import { type DashboardSummary, type SiteData } from './portalApi'

// ─────────────────────────────────────────────
// Six-dimension summary bodies — one per HHI-contributing subsystem with a
// /api/public/summary source. Each returns just SupportStats + FormulaPanel
// now (the big number moved to the Gauge above it, replacing the old
// HeroIndex text). `expanded`/`onToggleExpand` were dead props left over
// from before formulas started showing unconditionally — dropped here.
// ─────────────────────────────────────────────
function PfCwhSummaryBody({ data }: { data: Record<string, unknown> }) {
  const totalAssetsTWD = typeof data['totalAssetsTWD'] === 'number' ? data['totalAssetsTWD'] : null
  const twrr = typeof data['twrr'] === 'number' ? data['twrr'] : null
  const mwrr = typeof data['mwrr'] === 'number' ? data['mwrr'] : null
  const pacingIndex = typeof data['pacingIndex'] === 'number' ? data['pacingIndex'] : null

  const items = [
    { label: '總資產', value: totalAssetsTWD !== null ? formatTWD(totalAssetsTWD) : '—', formula: '目前資產總市值（最新一筆快照）' },
    { label: 'TWRR', value: formatPct(twrr), color: twrr === null ? undefined : (twrr >= 0 ? COLOR.ok : COLOR.crit), formula: '時間加權報酬率——排除加減碼時機影響，純看資產本身的報酬表現' },
    { label: 'MWRR', value: formatPct(mwrr), color: mwrr === null ? undefined : (mwrr >= 0 ? COLOR.ok : COLOR.crit), formula: '金額加權報酬率——考慮加減碼金額與時機，反映實際到手的報酬' },
    { label: '休假配速', value: pacingIndex !== null ? `${Math.round(pacingIndex * 100)}%` : '—', formula: '休假進度 ÷ 年度時間進度，100% = 剛好照今年時間進度休假' },
  ]

  return (
    <>
      <SupportStats items={items} />
      <FormulaPanel rows={[
        { label: '財務自由（來源：人生自由指數）', formula: '資產分／報酬分／休假配速分，各自正規化到 0-100 後取平均（缺項就用剩下的取平均，不會整個是 0）' },
        ...items,
      ]} />
    </>
  )
}

const MUSCLE_GROUP_AXES = ['胸', '背', '腿', '肩', '二头肌', '核心', '臀', '三头肌', '有氧']

function FitnessForgeSummaryBody({ data }: { data: Record<string, unknown> }) {
  const weeklyScore = typeof data['weeklyScore'] === 'number' ? data['weeklyScore'] : null
  const trendPct = typeof data['trendPct'] === 'number' ? data['trendPct'] : null
  const balanceScore = typeof data['balanceScore'] === 'number' ? data['balanceScore'] : null
  const coverageScore = typeof data['coverageScore'] === 'number' ? data['coverageScore'] : null
  const activityBonusPoints = typeof data['activityBonusPoints'] === 'number' ? data['activityBonusPoints'] : 0
  const muscleComposites = Array.isArray(data['muscleComposites'])
    ? data['muscleComposites'] as Array<{ name: string; composite: number }>
    : []
  const radarAxes = MUSCLE_GROUP_AXES.map(name => ({
    label: name,
    value: muscleComposites.find(m => m.name === name)?.composite ?? null,
  }))

  const items = [
    { label: '本週積分', value: weeklyScore !== null ? weeklyScore.toLocaleString('zh-TW') : '—', formula: '本週各筆訓練紀錄的加權分數總和（原始累積量，未經配速調整）' },
    { label: '趨勢', value: trendPct !== null ? `${trendPct >= 0 ? '+' : ''}${trendPct.toFixed(1)}%` : '—', color: trendPct === null ? undefined : (trendPct >= 0 ? COLOR.ok : COLOR.crit), formula: '本週至今 vs 近 4 週同一段時間平均；平均基準太小或缺資料時，改比「目前配速 vs 個人平均配速」' },
    {
      label: '覆蓋率',
      value: coverageScore !== null ? `${coverageScore}%${activityBonusPoints > 0 ? `（含活動量 +${activityBonusPoints}%）` : ''}` : '—',
      formula: '本週肌群雷達圖多邊形面積 ÷ 每軸都達 100% 維持量時的面積，越高代表整體訓練量越飽滿；活動量（例如步數）另外加成，封頂 +10%',
    },
    { label: '均衡度', value: balanceScore !== null ? `${balanceScore}%` : '—', formula: '最弱肌群複合分 ÷ 最強肌群複合分（複合分 = 組數 40% + 容量 60%），數字越低代表落差越大' },
  ]

  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '1.6rem', alignItems: 'center' }}>
      <div style={{ flex: '1 1 260px', minWidth: 0 }}>
        <SupportStats items={items} />
        <FormulaPanel rows={[
          { label: '身體（來源：運動習慣指數）', formula: '訓練量分／覆蓋分／均衡分／趨勢分，各自正規化到 0-100 後取平均（缺項就用剩下的取平均）' },
          ...items,
        ]} />
      </div>
      <LabeledRadarChart axes={radarAxes} maxValue={150} baselineFraction={100 / 150} size={220} color={COLOR.amber} />
    </div>
  )
}

function VikunjaSummaryBody({ data }: { data: Record<string, unknown> }) {
  const overdueScore = typeof data['overdueScore'] === 'number' ? data['overdueScore'] : null
  const loadScore = typeof data['loadScore'] === 'number' ? data['loadScore'] : null
  const stagnationScore = typeof data['stagnationScore'] === 'number' ? data['stagnationScore'] : null
  const completionScore = typeof data['completionScore'] === 'number' ? data['completionScore'] : null

  const diagItem = (label: string, score: number | null, formula: string) => {
    const tone = heroTone(score, true)
    return { label, value: score !== null ? String(score) : '—', formula, color: score !== null ? tone.color : undefined, tier: score !== null ? tone.label : undefined }
  }

  const items = [
    diagItem('逾期壓力', overdueScore, '目前逾期任務的嚴重程度（數量、逾期天數），對比近三個月基準'),
    diagItem('近期負荷', loadScore, '近期任務負荷 ÷ 長期平均負荷（ACWR 概念），比值越高代表最近突然變忙'),
    diagItem('停滯程度', stagnationScore, '任務長期沒有進展、卡住不動的程度'),
    diagItem('拖延程度', completionScore, '過去 90 天準時完成率的反向指標（指數衰減加權，越近期權重越高），數字越高代表越常拖延'),
  ]

  // 可行動數字（P2-6）：主機端每天算好；舊資料列或還沒部署就沒有這個欄位，不顯示
  const ta = data['taskActions']
  const actions = ta && typeof ta === 'object' ? ta as Record<string, unknown> : null
  const actionNum = (k: string) => (actions && typeof actions[k] === 'number' ? actions[k] as number : null)
  const overdue = actionNum('overdue'), dueToday = actionNum('dueToday'), dueNext7 = actionNum('dueNext7'), doneWeek = actionNum('doneWeek')
  const actionItems = overdue !== null && dueToday !== null && dueNext7 !== null && doneWeek !== null ? [
    { label: '已逾期', value: String(overdue), color: overdue > 0 ? COLOR.crit : undefined, formula: '未完成、到期日早於今天的任務數' },
    { label: '今天到期', value: String(dueToday), formula: '未完成、到期日是今天（台北時間）的任務數' },
    { label: '7 天內到期', value: String(dueNext7), formula: '未完成、到期日在明天到 7 天後的任務數' },
    { label: '近 7 天完成', value: String(doneWeek), formula: '近 7 天（含今天）標記完成的任務數；沒有完成時間的不計' },
  ] : null

  return (
    <>
      {actionItems && (
        <>
          <div style={{ fontSize: '0.7rem', color: COLOR.steelDim, letterSpacing: '0.05em', marginBottom: '6px' }}>今天要做什麼</div>
          <SupportStats items={actionItems} />
          <div style={{ height: '1rem' }} />
        </>
      )}
      <SupportStats items={items} />
      <FormulaPanel rows={[
        ...(actionItems ?? []),
        { label: '從容（來源：從容指數）', formula: '100 － 忙碌指數（忙碌指數 = 逾期壓力／近期負荷／停滯程度／拖延程度四項加權平均，每天由 Python 服務算一次）。數字越高代表越從容' },
        ...items,
      ]} />
    </>
  )
}

function TravelSummaryBody({ data }: { data: Record<string, unknown> }) {
  const daysSinceLastTrip = typeof data['daysSinceLastTrip'] === 'number' ? data['daysSinceLastTrip'] : null
  const lastTripEndDate = typeof data['lastTripEndDate'] === 'string' ? data['lastTripEndDate'] : null
  const recencyScore = typeof data['recencyScore'] === 'number' ? data['recencyScore'] : null
  const frequencyScore = typeof data['frequencyScore'] === 'number' ? data['frequencyScore'] : null
  const tripDaysLast180 = typeof data['tripDaysLast180'] === 'number' ? data['tripDaysLast180'] : null
  const anticipationBonus = typeof data['anticipationBonus'] === 'number' ? data['anticipationBonus'] : 0
  const hasUpcomingTrip = data['hasUpcomingTrip'] === true
  // 美食項（遊記＋美食地圖的來源才有；後端還沒更新前沒有這兩個欄位就不顯示）
  const foodScore = typeof data['foodScore'] === 'number' ? data['foodScore'] : null
  const foodVisits = typeof data['foodVisitsLast90'] === 'number' ? data['foodVisitsLast90'] : null
  const hasFood = foodVisits !== null

  const items = [
    { label: '距上次旅行', value: daysSinceLastTrip !== null ? `${daysSinceLastTrip} 天` : '尚無紀錄', formula: '距離最近一次已結束行程的天數（還沒發生的計畫中行程不算）——換算成 recency 子分數' },
    { label: '最近一次行程結束', value: lastTripEndDate ? new Date(lastTripEndDate).toLocaleDateString('zh-TW') : '—', formula: '旅遊紀錄裡最近一筆已結束行程的結束日期' },
    { label: 'Recency 子分數', value: recencyScore !== null ? String(recencyScore) : '—', formula: '3 天內剛玩回來 = 100 分，之後線性遞減，約 93 天沒出去玩 = 0 分' },
    { label: 'Frequency 子分數', value: frequencyScore !== null ? String(frequencyScore) : '—', formula: `min(100, round(近 180 天累積行程天數 ÷ 20 × 100))${tripDaysLast180 !== null ? `（目前近 180 天累積 ${tripDaysLast180} 天）` : ''}` },
    ...(hasFood ? [{ label: '美食子分數', value: foodScore !== null ? String(foodScore) : '—', formula: `近 90 天吃過的美食地點 ÷ 6 × 100，上限 100（目前 ${foodVisits} 間；來源：美食地圖，狀態為去過／愛店）` }] : []),
    { label: '期待加分', value: hasUpcomingTrip ? `+${anticipationBonus}` : '無', formula: '有已排定但還沒發生的行程 +5 分（開關預設開啟）' },
  ]

  return (
    <>
      <SupportStats items={items} />
      <FormulaPanel rows={[
        { label: '旅遊（來源：旅遊生活）', formula: hasFood ? 'travelScore = clamp(round(0.4 × Recency + 0.4 × Frequency + 0.2 × 美食) + 期待加分, 0, 100)——旅行（遊記）與吃好料（美食地圖）一起算' : 'travelScore = clamp(round(0.5 × Recency + 0.5 × Frequency) + 期待加分, 0, 100)——要維持一定的整體旅遊頻率，不是只看距上次旅行天數' },
        ...items,
      ]} />
    </>
  )
}

export const SUMMARY_BODIES: Record<string, (props: { data: Record<string, unknown> }) => React.ReactElement> = {
  'pf-cwh': PfCwhSummaryBody,
  'fitnessforge': FitnessForgeSummaryBody,
  'travel': TravelSummaryBody,
  'vikunja': VikunjaSummaryBody,
}

// 以下三張對照表都由面向註冊表（dimensions.ts）推導，key 是來源子系統 id；只含「detail === 'subsystem'」的四個面向。
const subsystemMap = (pick: (d: DimensionDef) => string | null): Record<string, string> =>
  Object.fromEntries(DIMENSIONS.filter(d => d.detail === 'subsystem' && pick(d) !== null).map(d => [d.subsystemId, pick(d)!]))

/** 子系統原始值欄位（只在詳細數據裡對照顯示；vikunja 的 busyIndex 是「越高越忙」） */
export const DIMENSION_HERO_FIELD: Record<string, string> = subsystemMap(d => d.rawField)

// HHI v3 (2026-09-01) — the six dimensions come from four independently
// designed formulas with wildly different shapes (see happinessIndex.ts's
// percentile normalization comment), so "80" meant something different in
// every dial. The gauges now show each dimension's percentile rank against
// its own trailing 90-day history (from the "hhi" summary, already
// normalized server-side), not the raw formula output — the raw number
// moves to the "詳細數據" panel below instead.
const DIMENSION_NORMALIZED_FIELD: Record<string, string> = subsystemMap(d => d.scoreKey)

const DIMENSION_SUB: Record<string, string> = subsystemMap(d => d.label)

// Replaces GlassSummaryCard — one gauge tile per HHI-contributing subsystem
// that has a portal_sites row (pf-cwh/fitnessforge/vikunja/travel). Vikunja
// is special-cased: the API's busyIndex is "higher = busier", displayed
// inverted as a calm index so all six dials share "higher = better".
export function DimensionGauge({
  site,
  summary,
  hhiSummary,
  unlocked,
  onSelect,
}: {
  site: SiteData
  summary: DashboardSummary
  hhiSummary: DashboardSummary | undefined
  unlocked: boolean
  onSelect: (site: SiteData) => void
}) {
  const isLocked = site.isPrivate && !unlocked
  const [expanded, setExpanded] = useState(false)
  const Body = SUMMARY_BODIES[summary.subsystemId]
  const data = summary.data
  const rawHero = data && typeof data[DIMENSION_HERO_FIELD[summary.subsystemId] ?? ''] === 'number'
    ? data[DIMENSION_HERO_FIELD[summary.subsystemId]!] as number
    : null
  const hhiData = hhiSummary?.data
  const normalizedScore = hhiData && typeof hhiData[DIMENSION_NORMALIZED_FIELD[summary.subsystemId] ?? ''] === 'number'
    ? hhiData[DIMENSION_NORMALIZED_FIELD[summary.subsystemId]!] as number
    : null
  const tone = normalizedScore !== null ? heroTone(normalizedScore, false) : { color: COLOR.steelDim, label: '資料不足' }

  if (isLocked) {
    return <LockedGaugeCard label={site.name} sub={site.subtitle || DIMENSION_SUB[summary.subsystemId] || ''} onRequestUnlock={() => onSelect(site)} />
  }

  return (
    <div
      onClick={() => onSelect(site)}
      style={{
        display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '0.5rem', cursor: 'pointer',
        padding: '1rem 0.9rem 0.9rem', background: COLOR.panelRaised, border: `1px solid ${COLOR.line}`, borderRadius: '5px',
      }}
    >
      <Gauge value={normalizedScore} color={tone.color} />
      <div style={{ fontSize: '0.82rem', fontWeight: 600, color: COLOR.ink, textAlign: 'center' }}>{site.name}</div>
      <div style={{ fontFamily: FONT.mono, fontSize: '0.62rem', color: COLOR.steelDim, letterSpacing: '0.04em' }}>
        {normalizedScore !== null ? tone.label : (summary.status === 'pending' ? '資料準備中' : '暫時無法取得資料')}
      </div>
      {/* 目前只有 vikunja（從容指數）的資料會帶 stale 欄位——其餘三個維度
          每次開頁面都即時打原站 API，沒有「上次成功計算是多久以前」這個概
          念可言。跟 MindIndexCard／SocialIndexCard 同一套文案/樣式，通用寫
          在這裡而不是只寫在 VikunjaSummaryBody 裡，以後哪個維度也需要就不
          用再抄一次。 */}
      {data?.['stale'] === true && <div style={{ fontSize: '0.62rem', color: COLOR.warn }}>資料已超過 36 小時未更新</div>}
      {Body && data && (
        <div style={{ width: '100%', marginTop: '0.3rem' }} onClick={e => e.stopPropagation()}>
          <FormulaToggle expanded={expanded} onToggle={() => setExpanded(x => !x)} labelCollapsed="詳細數據 ▼" labelExpanded="收起 ▲" />
          {expanded && (
            <div style={{ marginTop: '0.5rem' }}>
              <div style={{ fontFamily: FONT.mono, fontSize: '0.6rem', color: COLOR.steelDim, marginBottom: '0.5rem', lineHeight: 1.5 }}>
                {rawToScoreText(rawHero, normalizedScore)}
              </div>
              <Body data={data} />
            </div>
          )}
        </div>
      )}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', width: '100%', paddingTop: '0.5rem', marginTop: '0.2rem', borderTop: `1px solid ${COLOR.line}`, fontFamily: FONT.mono, fontSize: '0.6rem' }}>
        <span style={{ color: COLOR.steelDim }}>{formatMinutesAgo(summary.fetchedAt)}</span>
        <span style={{ color: COLOR.amberDim, letterSpacing: '0.03em' }}>前往系統 ↗</span>
      </div>
    </div>
  )
}

// ─────────────────────────────────────────────
// 心智指標（計入 HHI）— 2026-10-10 起＝0.8 × 想法分數 ＋ 0.2 × 最新一份日報 📊 分數
// （後端 lib/mindCombined.ts；資料在幸福指數摘要的 mindCombined）。取代原本的近 3 天日記篇數。
// 知識庫健康度另在 HERMES 戰情室當獨立面板，見 HermesKnowledgeHealthPanel。
// ─────────────────────────────────────────────
interface MindCombinedData {
  score: number | null
  ideas: number | null
  report: { date: string; total: number; parts: Array<{ label: string; value: number; note: string }> } | null
}
// 心智面向的明細（首頁卡片展開與 #dim/mind 頁共用）：想法分數、日報分數、算法
export function MindDetailBody({ hhiSummary }: { hhiSummary: DashboardSummary | undefined }) {
  const mc = (hhiSummary?.data?.['mindCombined'] ?? null) as MindCombinedData | null
  const normalizedScore = typeof hhiSummary?.data?.['mindScore'] === 'number' ? hhiSummary.data['mindScore'] as number : null
  const rep = mc?.report ?? null
  const items = [
    { label: '想法分數（80%）', value: mc?.ideas != null ? mc.ideas.toFixed(1) : '—', formula: '產生 40%（近 7 天新想法，6 個＝50 分）＋ 實行 60%（近 28 天實行，8 個＝50 分），都是遞減曲線；回補的舊想法不算；明細見 HERMES 戰情室想法庫' },
    { label: rep ? `日報分數（20%，${rep.date.slice(5)}）` : '日報分數（20%）', value: rep ? String(rep.total) : '—', formula: '日報最後的 📊 評分段：推進／決策／卡點／覺察／能量 各 0–4，加總 × 5；取今天或昨天最新的一份（日報每晚 22:00 產出、約 10 分鐘內推上來，所以 22:10 以前用的是昨天那份）' },
  ]

  return (
    <>
            <div style={{ fontFamily: FONT.mono, fontSize: '0.6rem', color: COLOR.steelDim, marginBottom: '0.5rem', lineHeight: 1.5 }}>
              面向分數 = {normalizedScore ?? '—'}（公式分 {mc?.score != null ? mc.score.toFixed(1) : '—'}）
            </div>
            <SupportStats items={items} />
            {rep && (
              <div style={{ fontSize: '0.64rem', color: COLOR.steelDim, marginTop: '0.5rem', lineHeight: 1.6 }}>
                {rep.parts.map(p => `${p.label} ${p.value}`).join('・')}
              </div>
            )}
            <FormulaPanel rows={[
              { label: '心智指標（計入幸福指數）', formula: '想法分數 × 80% ＋ 最新日報分數 × 20%（沒有日報分數就只用想法分數）' },
              ...items,
            ]} />
    </>
  )
}

export function MindIndexCard({
  summary,
  hhiSummary,
  unlocked,
  onSelect,
}: {
  summary: DashboardSummary | undefined
  hhiSummary: DashboardSummary | undefined
  unlocked: boolean
  onSelect: () => void
}) {
  const isLocked = !unlocked
  const mc = (hhiSummary?.data?.['mindCombined'] ?? null) as MindCombinedData | null
  const [expanded, setExpanded] = useState(false)
  const normalizedScore = typeof hhiSummary?.data?.['mindScore'] === 'number' ? hhiSummary.data['mindScore'] as number : null
  const tone = bandTone(normalizedScore, MIND_SCORE_BANDS)

  if (isLocked) {
    return <LockedGaugeCard label={dimensionOf('mind')!.label} sub="想法＋日報" onRequestUnlock={onSelect} />
  }

  return (
    <div style={{
      display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '0.5rem',
      padding: '1rem 0.9rem 0.9rem', background: COLOR.panelRaised, border: `1px solid ${COLOR.line}`, borderRadius: '5px',
    }}>
      <Gauge value={normalizedScore} color={tone.color} />
      <div style={{ fontSize: '0.82rem', fontWeight: 600, color: COLOR.ink }}>{dimensionOf('mind')!.label}</div>
      <div style={{ fontFamily: FONT.mono, fontSize: '0.62rem', color: COLOR.steelDim }}>
        {normalizedScore !== null ? tone.label : (hhiSummary?.status === 'error' ? '暫時無法取得資料' : '資料準備中')}
      </div>
      <div style={{ width: '100%', marginTop: '0.3rem' }}>
        <FormulaToggle expanded={expanded} onToggle={() => setExpanded(x => !x)} labelCollapsed="詳細數據 ▼" labelExpanded="收起 ▲" />
        {expanded && (
          <div style={{ marginTop: '0.5rem' }} data-testid="mind-card-detail">
            <MindDetailBody hhiSummary={hhiSummary} />
          </div>
        )}
      </div>
      <div style={{ fontFamily: FONT.mono, fontSize: '0.6rem', color: COLOR.steelDim, marginTop: '0.2rem' }}>
        {formatMinutesAgo(hhiSummary?.fetchedAt ?? summary?.fetchedAt ?? null)}
      </div>
    </div>
  )
}

// ─────────────────────────────────────────────
// 社交指標 (HHI v2) — 全被動日記萃取，資料來源是 social_interactions.jsonl。
// ─────────────────────────────────────────────
// 社交面向的明細（首頁卡片展開與 #dim/social 頁共用）：三個子分數、觀測日、算法
export function SocialDetailBody({ summary, hhiSummary }: { summary: DashboardSummary | undefined; hhiSummary: DashboardSummary | undefined }) {
  const data = summary?.data
  const observedDayCount = typeof data?.['observedDayCount'] === 'number' ? data['observedDayCount'] as number : null
  const distinctPersonCount = typeof data?.['distinctPersonCount'] === 'number' ? data['distinctPersonCount'] as number : null
  const daysWithInteraction = typeof data?.['daysWithInteraction'] === 'number' ? data['daysWithInteraction'] as number : null
  const breadthScore = typeof data?.['breadthScore'] === 'number' ? data['breadthScore'] as number : null
  const intensityScore = typeof data?.['intensityScore'] === 'number' ? data['intensityScore'] as number : null
  const connectionRateScore = typeof data?.['connectionRateScore'] === 'number' ? data['connectionRateScore'] as number : null
  const socialScore = typeof data?.['socialScore'] === 'number' ? data['socialScore'] as number : null
  const personNamesRaw = data?.['personNames']
  const personNames = Array.isArray(personNamesRaw) ? personNamesRaw.filter((v): v is string => typeof v === 'string') : null
  const stale = data?.['stale'] === true
  const normalizedScore = typeof hhiSummary?.data?.['socialScore'] === 'number' ? hhiSummary.data['socialScore'] as number : null
  const socialItems = [
    { label: '廣度', value: breadthScore !== null ? String(breadthScore) : '—', formula: '100 × (1 − e^(−人數/4))：近 14 天互動過的不重複家人朋友（不含同事）；4 人 ≈ 63、8 人 ≈ 86，不封頂' },
    { label: '互動強度', value: intensityScore !== null ? String(intensityScore) : '—', formula: '100 × (1 − e^(−點數/20))：近 14 天見面 3 點／通話 2 點／訊息 1 點，同事與業務往來 × 0.25' },
    { label: '規律', value: connectionRateScore !== null ? String(connectionRateScore) : '—', formula: 'round(近 14 天有和家人朋友互動的觀測日數 ÷ 觀測日數 × 100)' },
    { label: '觀測日／互動天數', value: observedDayCount !== null ? `${daysWithInteraction ?? 0} / ${observedDayCount}` : '—', formula: '觀測日＝近 14 天當天有寫日記（≥1 篇）' },
  ]

  return (
    <>
      <div style={{ fontFamily: FONT.mono, fontSize: '0.6rem', color: COLOR.steelDim, marginBottom: '0.5rem', lineHeight: 1.5 }}>
        {rawToScoreText(socialScore, normalizedScore)}
      </div>
      <SupportStats items={socialItems} />
      <FormulaPanel rows={[
        { label: '社交指標（計入幸福指數）', formula: 'socialScore = round(0.35 × 廣度 + 0.35 × 互動強度 + 0.30 × 規律)' },
        ...socialItems,
      ]} />
    </>
  )
}

export function SocialIndexCard({
  summary,
  hhiSummary,
  unlocked,
  onSelect,
}: {
  summary: DashboardSummary | undefined
  hhiSummary: DashboardSummary | undefined
  unlocked: boolean
  onSelect: () => void
}) {
  const isLocked = !unlocked
  const data = summary?.data
  const observedDayCount = typeof data?.['observedDayCount'] === 'number' ? data['observedDayCount'] as number : null
  const distinctPersonCount = typeof data?.['distinctPersonCount'] === 'number' ? data['distinctPersonCount'] as number : null
  const daysWithInteraction = typeof data?.['daysWithInteraction'] === 'number' ? data['daysWithInteraction'] as number : null
  const breadthScore = typeof data?.['breadthScore'] === 'number' ? data['breadthScore'] as number : null
  const intensityScore = typeof data?.['intensityScore'] === 'number' ? data['intensityScore'] as number : null
  const connectionRateScore = typeof data?.['connectionRateScore'] === 'number' ? data['connectionRateScore'] as number : null
  const socialScore = typeof data?.['socialScore'] === 'number' ? data['socialScore'] as number : null
  const personNamesRaw = data?.['personNames']
  const personNames = Array.isArray(personNamesRaw) ? personNamesRaw.filter((v): v is string => typeof v === 'string') : null
  const stale = data?.['stale'] === true
  const [expanded, setExpanded] = useState(false)
  const normalizedScore = typeof hhiSummary?.data?.['socialScore'] === 'number' ? hhiSummary.data['socialScore'] as number : null
  const tone = bandTone(normalizedScore, SOCIAL_SCORE_BANDS)

  if (isLocked) {
    return <LockedGaugeCard label={dimensionOf('social')!.label} sub="近 14 天社交活動" onRequestUnlock={onSelect} />
  }

  const showEmpty = observedDayCount === null || observedDayCount === 0 || socialScore === null

  return (
    <div style={{
      display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '0.5rem',
      padding: '1rem 0.9rem 0.9rem', background: COLOR.panelRaised, border: `1px solid ${COLOR.line}`, borderRadius: '5px',
    }}>
      <Gauge value={normalizedScore} color={tone.color} />
      <div style={{ fontSize: '0.82rem', fontWeight: 600, color: COLOR.ink }}>{dimensionOf('social')!.label}</div>
      <div style={{ fontFamily: FONT.mono, fontSize: '0.62rem', color: COLOR.steelDim }}>
        {showEmpty ? (summary?.status === 'error' ? '暫時無法取得資料' : '近 14 天沒有日記可供觀測') : tone.label}
      </div>
      {stale && <div style={{ fontSize: '0.62rem', color: COLOR.warn }}>資料已超過 36 小時未更新</div>}
      {distinctPersonCount === 0 && !showEmpty && (
        <div style={{ fontSize: '0.62rem', color: COLOR.steel, textAlign: 'center' }}>這兩週有寫日記，但沒有和家人朋友的互動紀錄——真實的 0 分</div>
      )}
      {personNames && personNames.length > 0 && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px', justifyContent: 'center', marginTop: '0.2rem' }}>
          {personNames.map(name => (
            <span key={name} style={{ fontSize: '0.62rem', color: COLOR.steel, background: COLOR.panelDeep, border: `1px solid ${COLOR.line}`, borderRadius: '999px', padding: '2px 8px' }}>{name}</span>
          ))}
        </div>
      )}
      {!showEmpty && (
        <div style={{ width: '100%', marginTop: '0.3rem' }}>
          <FormulaToggle expanded={expanded} onToggle={() => setExpanded(x => !x)} labelCollapsed="詳細數據 ▼" labelExpanded="收起 ▲" />
          {expanded && (
            <div style={{ marginTop: '0.5rem' }}>
              <SocialDetailBody summary={summary} hhiSummary={hhiSummary} />
            </div>
          )}
        </div>
      )}
      <div style={{ fontFamily: FONT.mono, fontSize: '0.6rem', color: COLOR.steelDim, marginTop: '0.2rem' }}>
        {formatMinutesAgo(summary?.fetchedAt ?? null)}
      </div>
    </div>
  )
}
