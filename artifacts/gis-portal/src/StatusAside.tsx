import { useMemo } from 'react'
import type { HhiBreakdown } from './boardView'
import type { IdeaItem } from './boardApi'
import type { AsyncState } from './homeHooks'
import { DIMENSION_FALLBACK_COLOR, dimensionOf } from './dimensions'
import { dimHash } from './dimensionPage'
import { KIND_ICON } from './foodMap'
import { HOME_SHORTCUTS } from './homeNav'
import { formatDuration, type BlockStatus, type LatestTrip, type SystemLight } from './homeView'
import type { TopicsData } from './knowledgeView'
import { Skeleton, StateFrame } from './StateFrame'
import type { Maybe } from './statsApi'
import {
  deltaText, dimCell, knowledgeWeek, knowledgeWeekText, pctText, userCorrections, type PushStats, type SearchStats, type ServiceSummary,
} from './statusAside'
import type { FoodPlace } from './foodMap'

// 首頁右欄 STATUS（2.88.0）：六個面向、成長與系統、最近搜尋、好玩的小盒、捷徑。
// 資料與狀態判定由 HomeBoard 傳進來，純計算在 statusAside.ts；樣式 st- 前綴在 portal.css。

type WantLine = { name: string; kind: FoodPlace['kind']; area: string | null; days: number } | null

// ── 一列「名稱｜數字」：可點（連結或 button），依資料狀態顯示原因；錯誤只影響這一列 ──
function StRow({ id, label, st, value, emptyText = '—', errorText = '暫時無法取得', href, onClick, onRequestUnlock, dot, warn = false, title }: {
  id: string
  label: string
  st: BlockStatus
  value: string
  emptyText?: string
  errorText?: string
  href?: string
  onClick?: () => void
  onRequestUnlock: () => void
  dot?: 'ok' | 'warn' | 'crit' | 'unknown'
  warn?: boolean
  title?: string
}) {
  let text = value
  let muted = false
  let usable = true
  switch (st.state) {
    case 'locked': text = '🔒 解鎖後顯示'; muted = true; usable = false; break
    case 'loading': text = '載入中…'; muted = true; usable = false; break
    case 'error': if (!st.keepLastValue) { text = errorText; muted = true; usable = false } break
    case 'dead': text = `已 ${formatDuration(st.ageMin ?? 0)}沒有更新`; muted = true; break
    case 'empty': case 'pending': text = emptyText; muted = true; break
    default: break
  }
  const cls = `st-row${warn ? ' st-warn' : ''}${muted ? ' st-muted' : ''}`
  const inner = (
    <>
      <span className="st-row-k">{dot && <i className="st-lamp" data-level={dot} aria-hidden />}{label}</span>
      <span className="st-row-v">{text}</span>
    </>
  )
  const stale = st.state === 'stale' ? `（資料 ${formatDuration(st.ageMin ?? 0)}前）` : st.state === 'error' && st.keepLastValue ? '（更新失敗，顯示上次的值）' : ''
  const tip = `${title ?? label}${stale}`
  if (st.state === 'locked') return <button type="button" className={cls} data-testid={id} title="解鎖後顯示" onClick={onRequestUnlock}>{inner}</button>
  if (usable && href) return <a className={cls} data-testid={id} href={href} title={tip}>{inner}</a>
  if (usable && onClick) return <button type="button" className={cls} data-testid={id} title={tip} aria-haspopup="dialog" onClick={onClick}>{inner}</button>
  return <div className={cls} data-testid={id} title={tip}>{inner}</div>
}

const sysDot = (l: SystemLight['level']): 'ok' | 'warn' | 'crit' | 'unknown' => l

export interface StatusAsideProps {
  on: boolean
  now: Date
  todayIso: string
  onRequestUnlock: () => void
  // 六個面向
  hhiSt: BlockStatus
  breakdown: HhiBreakdown | null
  /** 面向每日分數（含 components）：用 30 天那份，沒有就退回 365 天那份 */
  dimHistory: ReadonlyArray<{ date: string; components?: Record<string, number | null> | null }> | null
  onOpenHhi: () => void
  // 成長與系統
  topics: AsyncState<Maybe<TopicsData>>
  searchStats: AsyncState<Maybe<SearchStats>>
  pushStats: AsyncState<Maybe<PushStats>>
  onOpenSearchStats: () => void
  onOpenPushStats: () => void
  sysSt: BlockStatus
  light: SystemLight
  onOpenOps: () => void
  svcSt: BlockStatus
  svc: ServiceSummary
  onOpenSvc: () => void
  // 最近搜尋
  recent: string[]
  onPickRecent: (q: string) => void
  // 好玩的小盒
  ideasSt: BlockStatus
  topIdea: IdeaItem | null
  foodSt: BlockStatus
  wantEat: WantLine
  wantGo: WantLine
  tripsSt: BlockStatus
  trip: LatestTrip | null
  onOpenIdeas: () => void
}

export function StatusAside(p: StatusAsideProps) {
  const { on, now, todayIso, onRequestUnlock } = p
  const cells = useMemo(
    () => (p.breakdown?.rows ?? []).map((r) => ({ row: r, cell: dimCell(p.dimHistory, r.key, r.value, todayIso) })),
    [p.breakdown, p.dimHistory, todayIso],
  )
  const topicsData = p.topics.data?.value ?? null
  const topicsSt: BlockStatus = useMemo(() => {
    if (!on) return { state: 'locked', ageMin: null, keepLastValue: false }
    if (p.topics.error) return { state: 'error', ageMin: null, keepLastValue: p.topics.data !== null }
    if (p.topics.data === null) return { state: 'loading', ageMin: null, keepLastValue: false }
    return { state: topicsData ? 'fresh' : 'empty', ageMin: null, keepLastValue: false }
  }, [on, p.topics.error, p.topics.data, topicsData])
  const week = useMemo(() => (topicsData ? knowledgeWeek(topicsData.topics, now) : null), [topicsData, now])
  const fixes = useMemo(() => (topicsData ? userCorrections(topicsData.topics) : 0), [topicsData])

  const statSt = (a: AsyncState<unknown>): BlockStatus => {
    if (!on) return { state: 'locked', ageMin: null, keepLastValue: false }
    if (a.error) return { state: 'error', ageMin: null, keepLastValue: a.data !== null }
    if (a.data === null) return { state: 'loading', ageMin: null, keepLastValue: false }
    return { state: (a.data as Maybe<unknown>).value ? 'fresh' : 'empty', ageMin: null, keepLastValue: false }
  }
  const ss = p.searchStats.data?.value ?? null
  const ps = p.pushStats.data?.value ?? null
  const searchSt = statSt(p.searchStats)
  const pushSt = statSt(p.pushStats)
  const sysOk = on && p.sysSt.state === 'fresh'

  const dimsGhost = <div className="st-dimgrid">{Array.from({ length: 6 }, (_, i) => <div key={i} className="st-dim st-dim--ghost"><Skeleton lines={2} /></div>)}</div>

  const funLine = (id: string, icon: string, label: string, st: BlockStatus, text: string | null, href?: string, onClick?: () => void) => (
    <StRow key={id} id={id} label={`${icon} ${label}`} st={st} value={text ?? '—'} emptyText="還沒有" errorText="暫時無法取得" href={href} onClick={onClick} onRequestUnlock={onRequestUnlock} />
  )

  return (
    <aside className="st-aside" aria-label="狀態" data-testid="st-aside">
      <section className="st-box st-dimsbox" data-testid="st-dims" aria-label="六個面向">
        {p.breakdown && (p.hhiSt.state === 'fresh' || p.hhiSt.state === 'stale') ? (
          <button type="button" className="st-boxhead st-boxhead--btn" onClick={p.onOpenHhi} aria-haspopup="dialog" aria-label={`STATUS，幸福指數 ${p.breakdown.displayed}，點開看詳情`}>
            <span className="st-lb">STATUS</span><span className="st-hhi" data-testid="st-hhi">{p.breakdown.displayed}</span><span className="st-hhi-of">/100</span>
          </button>
        ) : (
          <div className="st-boxhead"><span className="st-lb">STATUS</span></div>
        )}
        <StateFrame status={p.hhiSt} source="幸福指數" skeleton={dimsGhost} onRequestUnlock={onRequestUnlock} empty="六個面向還沒有資料。" className="st-frame">
          <div className="st-dimgrid">
            {cells.map(({ row, cell }) => {
              const meta = dimensionOf(row.key)
              const label = meta?.label ?? row.label
              const d = cell.delta
              return (
                <button key={row.key} type="button" className="st-dim" data-testid="st-dim" data-dim={row.key} style={{ ['--dim' as string]: meta?.color ?? DIMENSION_FALLBACK_COLOR }}
                  onClick={() => { window.location.hash = dimHash(row.key) }}
                  aria-label={`${label} ${row.value ?? '沒有資料'}，與 7 天平均${d === null || d === 0 ? '差不多或資料不足' : d > 0 ? `高 ${d}` : `低 ${-d}`}，點開看面向頁`}>
                  <span className="st-dim-k">{label}</span>
                  <span className="st-dim-n">{row.value ?? '—'}</span>
                  <span className="st-dim-d" data-dir={d === null || d === 0 ? 'flat' : d > 0 ? 'up' : 'down'} title="與最近 7 個有值日子的平均相比">{deltaText(d)}</span>
                  {cell.spark && (
                    <svg className="st-spark" viewBox="0 0 60 16" preserveAspectRatio="none" aria-hidden focusable="false" data-testid="st-spark">
                      <polyline points={cell.spark} fill="none" vectorEffect="non-scaling-stroke" />
                    </svg>
                  )}
                </button>
              )
            })}
          </div>
        </StateFrame>
      </section>

      <section className="st-box st-rows" data-testid="st-growth" aria-label="成長與系統">
        <StRow id="st-kb" label="知識庫這週" st={topicsSt} value={week ? knowledgeWeekText(week) : '—'} emptyText="尚未收到" href="#knowledge" onRequestUnlock={onRequestUnlock} />
        <StRow id="st-fixes" label="你的更正" st={topicsSt} value={`${fixes} 筆已生效`} emptyText="尚未收到" href="#knowledge" onRequestUnlock={onRequestUnlock} />
        <StRow id="st-search" label="搜尋查無結果率" st={searchSt} emptyText="統計尚未上線" onClick={p.onOpenSearchStats} onRequestUnlock={onRequestUnlock}
          value={ss ? `${ss.searches > 0 ? pctText(ss.zeroRate) : '—'}・本週 ${ss.searches} 次` : '—'} title="搜尋查無結果率（近 7 天），點開看 14 天統計" />
        <StRow id="st-push" label="推送被點開" st={pushSt} emptyText="統計尚未上線" onClick={p.onOpenPushStats} onRequestUnlock={onRequestUnlock}
          value={ps ? `${ps.shown > 0 ? pctText(ps.openRate) : '—'}・沒用 ${ps.useless} 則` : '—'} title="推送被點開比例（近 14 天），點開看統計" />
        <StRow id="st-sys" label="系統" st={p.sysSt} value={p.light.headline} dot={sysOk ? sysDot(p.light.level) : undefined} warn={sysOk && p.light.level !== 'ok' && p.light.level !== 'unknown'}
          onClick={p.onOpenOps} onRequestUnlock={onRequestUnlock} title={`系統：${p.light.headline}，點開看戰情室`} />
        <StRow id="st-svc" label="付費服務" st={p.svcSt} value={p.svc.text} warn={p.svc.abnormal} onClick={p.onOpenSvc} onRequestUnlock={onRequestUnlock}
          dot={p.svcSt.state === 'fresh' ? (p.svc.abnormal ? 'warn' : 'ok') : undefined} title="付費服務：用量與連結" />
      </section>

      {on && p.recent.length > 0 && (
        <section className="st-box st-recentbox" data-testid="st-recent" aria-label="最近搜尋">
          <div className="st-lb">最近</div>
          <div className="st-chips">
            {p.recent.map((q) => <button key={q} type="button" className="st-chip" data-testid="st-recent-chip" onClick={() => p.onPickRecent(q)} title={`再搜一次：${q}`}>{q}</button>)}
          </div>
        </section>
      )}

      <section className="st-box st-rows st-funbox" data-testid="st-fun" aria-label="好玩的">
        {funLine('st-fun-idea', '💡', '想法', p.ideasSt, p.topIdea ? p.topIdea.title : null, undefined, p.onOpenIdeas)}
        {funLine('st-fun-eat', KIND_ICON.food, '想吃', p.foodSt, p.wantEat ? `${p.wantEat.name}・${p.wantEat.days} 天了` : null, '#food')}
        {funLine('st-fun-go', '📍', '想去', p.foodSt, p.wantGo ? `${p.wantGo.name}・${p.wantGo.days} 天了` : null, '#food')}
        {funLine('st-fun-trip', '🧳', '最近遊記', p.tripsSt, p.trip ? p.trip.trip.name : null, p.trip ? `#trips/${encodeURIComponent(p.trip.trip.id)}` : '#trips')}
      </section>

      <nav className="st-shortcuts" data-testid="st-shortcuts" aria-label="常用入口">
        {HOME_SHORTCUTS.map((s) => 'href' in s
          ? <a key={s.id} href={s.href} className="st-chip st-chip--short"><span aria-hidden>{s.icon}</span>{s.label}</a>
          : <button key={s.id} type="button" className="st-chip st-chip--short" aria-haspopup="dialog" onClick={p.onOpenIdeas}><span aria-hidden>{s.icon}</span>{s.label}</button>)}
      </nav>
    </aside>
  )
}
